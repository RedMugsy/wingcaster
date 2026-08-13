import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    const proxy = http.request({ hostname: 'localhost', port: 3001, path: req.url, method: req.method, headers: req.headers }, (pres) => {
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
    });
    req.pipe(proxy);
    return;
  }
  let url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, 'dist', url.split('?')[0]);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const ct = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'dist', 'index.html')));
  }
});

server.listen(7100, () => console.log('Preview:7100'));
