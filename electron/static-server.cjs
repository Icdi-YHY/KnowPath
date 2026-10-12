/**
 * 本地静态资源服务器：把打包后的 dist/ 以 http 源提供给渲染进程。
 * 抽成独立模块，便于单独用 Node 直接测试（不依赖 Electron）。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * 在 127.0.0.1 的随机空闲端口上托管 rootDir。
 * @returns {Promise<{ port: number, close: () => void }>}
 */
function serveStatic(rootDir) {
  const ROOT = path.resolve(rootDir);
  return new Promise((resolvePort, rejectPort) => {
    const server = http.createServer((req, res) => {
      let pathname = '/';
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      } catch {
        pathname = '/';
      }

      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.resolve(ROOT, relative);

      // 防目录穿越
      if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        send(res, 403, { 'Content-Type': MIME['.txt'] }, 'Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (!err) {
          send(
            res,
            200,
            {
              'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
              'Cache-Control': 'no-cache',
            },
            data,
          );
          return;
        }
        // SPA 回退
        fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
          if (e2) {
            send(res, 404, { 'Content-Type': MIME['.txt'] }, 'Not Found');
            return;
          }
          send(res, 200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }, html);
        });
      });
    });

    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      resolvePort({ port: server.address().port, close: () => server.close() });
    });
  });
}

module.exports = { serveStatic, MIME };
