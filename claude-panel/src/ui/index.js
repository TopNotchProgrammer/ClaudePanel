const styles = require("./styles");
const body = require("./body");
const client = require("./client");

const INDEX_HTML = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>Claude panel</title>
<style>${styles}</style>
</head>
<body>${body}<script>${client}</script>
</body>
</html>`;

module.exports = INDEX_HTML;
