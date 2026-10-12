#!/usr/bin/env node
/**
 * 把构建产物 dist/ 部署到自己主机上。
 * 默认监听 0.0.0.0:8080，同一局域网的设备（手机）也能访问。
 *
 *   node scripts/serve.cjs
 *   PORT=9000 node scripts/serve.cjs
 *   HOST=127.0.0.1 node scripts/serve.cjs   # 只允许本机访问
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { serveStatic } = require('../electron/static-server.cjs');

const ROOT = path.join(__dirname, '..', 'dist');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('\n  未找到构建产物 dist/index.html');
  console.error('  请先执行：npm run build\n');
  process.exit(1);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

/** 端口被占用时自动往后找，最多试 10 个 */
async function start(port, attemptsLeft) {
  try {
    return await serveStatic(ROOT, { host: HOST, port });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  端口 ${port} 已被占用，尝试 ${port + 1} …`);
      return start(port + 1, attemptsLeft - 1);
    }
    throw e;
  }
}

start(PORT, 10)
  .then(({ port }) => {
    console.log('\n  知径 KnowPath · 网页版已启动\n');
    console.log(`   本机访问    http://localhost:${port}/`);
    if (HOST === '0.0.0.0') {
      for (const ip of lanAddresses()) {
        console.log(`   局域网访问  http://${ip}:${port}/`);
      }
      console.log('\n   提示：手机的浏览器可以打开上面的局域网地址；');
      console.log('         但只有 localhost 属于安全上下文，可安装为 PWA 并离线使用。');
    }
    console.log('\n   按 Ctrl+C 停止\n');
  })
  .catch((e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`\n  ${PORT} 起的连续 11 个端口都被占用了，请手动指定：PORT=9000 npm run serve\n`);
    } else if (e && e.code === 'EACCES') {
      console.error(`\n  没有权限监听端口 ${PORT}（1024 以下是特权端口），换一个：PORT=9000 npm run serve\n`);
    } else {
      console.error(`\n  启动失败：${e && e.message}\n`);
    }
    process.exit(1);
  });
