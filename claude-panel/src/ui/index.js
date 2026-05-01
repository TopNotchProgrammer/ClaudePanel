const styles = require("./styles");
const body = require("./body");
const client = require("./client");
const { LANG } = require("../config");
const { pick } = require("./i18n");

const t = pick(LANG);

const INDEX_HTML = `<!doctype html>
<html lang="${t.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>${t.appTitle}</title>
<style>${styles(t)}</style>
</head>
<body>${body(t)}<script>window.T=${JSON.stringify(t)};</script><script>${client}</script>
</body>
</html>`;

module.exports = INDEX_HTML;
