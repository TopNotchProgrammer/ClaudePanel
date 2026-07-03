import io
import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel

os.environ["COQUI_TOS_AGREED"] = "1"

app = FastAPI()
model = None
_device_used = "none"
_tts = None
_tts_ref_wav = None


@app.on_event("startup")
def load():
    global model, _tts, _tts_ref_wav, _device_used
    size = os.environ.get("WHISPER_MODEL", "large-v3")
    device = os.environ.get("WHISPER_DEVICE", "cuda")
    compute = os.environ.get("WHISPER_COMPUTE", "float16")
    print(f"[asr] loading {size} on {device} ({compute})")
    try:
        model = WhisperModel(size, device=device, compute_type=compute)
        _device_used = device
    except Exception as e:
        print(f"[asr] {device} failed: {e}")
        if device != "cpu":
            print("[asr] falling back to cpu (int8)")
            model = WhisperModel(size, device="cpu", compute_type="int8")
            _device_used = "cpu"
        else:
            raise
    print(f"[asr] model ready on {_device_used} ({compute if _device_used == device else 'int8'})")

    try:
        from TTS.api import TTS
        _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=(device != "cpu"))
        _tts_ref_wav = os.environ.get("TTS_REF_WAV", "/srv/asr/ref_voice.wav")
        print(f"[tts] XTTS v2 ready (ref: {_tts_ref_wav})")
    except Exception as e:
        print(f"[tts] XTTS failed: {e}")


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("pl"),
):
    if not model:
        raise HTTPException(503, "model not loaded")
    suffix = ".webm"
    if file.content_type:
        if "wav" in file.content_type:
            suffix = ".wav"
        elif "ogg" in file.content_type:
            suffix = ".ogg"
        elif "mp4" in file.content_type or "m4a" in file.content_type:
            suffix = ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        content = await file.read()
        f.write(content)
        path = f.name
    try:
        segs, info = model.transcribe(
            path, language=language, beam_size=5, vad_filter=True
        )
        text = " ".join(s.text for s in segs).strip()
        return {
            "ok": True,
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
        }
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        os.unlink(path)


@app.post("/tts")
async def tts(text: str = Form(...), language: str = Form("pl")):
    if not _tts:
        raise HTTPException(503, "TTS not loaded")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        path = f.name
    try:
        _tts.tts_to_file(
            text, file_path=path, language=language,
            speaker_wav=_tts_ref_wav,
        )
        buf = io.BytesIO(open(path, "rb").read())
    finally:
        os.unlink(path)
    buf.seek(0)
    return StreamingResponse(buf, media_type="audio/wav")


@app.get("/health")
def health():
    return {"ok": model is not None, "device": _device_used, "tts": _tts is not None}
