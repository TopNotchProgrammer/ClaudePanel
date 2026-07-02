FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip3 install --no-cache-dir \
    faster-whisper \
    fastapi \
    uvicorn \
    python-multipart

COPY server.py .

ENV WHISPER_MODEL=large-v3
ENV WHISPER_DEVICE=cuda
ENV WHISPER_COMPUTE=float16

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
