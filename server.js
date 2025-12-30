const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/octet-stream',
  '.ts': 'application/typescript'
};

const server = http.createServer((req, res) => {
  try {
    let requestPath = decodeURIComponent(req.url.split('?')[0]);
    if (requestPath === '/') requestPath = '/index.html';
    const filePath = path.join(__dirname, requestPath);

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 - Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const type = mime[ext] || 'application/octet-stream';
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 - Server Error');
          return;
        }
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      });
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 - Server Error');
  }
});

server.listen(port, () => {
  console.log(`Local server running at http://localhost:${port}`);
});

module.exports = server;
