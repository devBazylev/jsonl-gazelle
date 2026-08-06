// Local static server used only by the screenshot tooling: serves the Monaco
// editor assets (so Pretty Print / Raw views render without any network
// access) and the generated harness HTML files, both over http://127.0.0.1
// so the browser sees a normal same-origin page instead of file://.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8791;
const monacoRoot = path.join(__dirname, 'node_modules', 'monaco-editor', 'min');
const generatedRoot = path.join(__dirname, '.generated');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.html': 'text/html' };

function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const base = url.startsWith('/vs/') ? monacoRoot : generatedRoot;
      const p = path.join(base, url);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start, PORT };

if (require.main === module) {
  start().then(() => console.log(`Screenshot server on http://127.0.0.1:${PORT}`));
}
