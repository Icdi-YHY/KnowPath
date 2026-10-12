/* 知径 KnowPath 离线缓存 Service Worker（无构建期依赖）
 * 全部路径基于自身作用域计算，因此根路径部署与子路径部署都能工作。
 */
const SCOPE = self.registration.scope;
const CACHE = 'knowpath-v2';

const toUrl = (p) => new URL(p, SCOPE).toString();
const INDEX = toUrl('index.html');
const PRECACHE = ['index.html', 'manifest.webmanifest', 'favicon.svg', 'pwa-192.png', 'pwa-512.png'].map(toUrl);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只处理同源静态资源；AI 接口等跨域请求一律直连，绝不缓存
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，失败回退到缓存的应用外壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(INDEX, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(INDEX)),
    );
    return;
  }

  // 其它静态资源：缓存优先
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((res) => {
            // 注意：Vite 会给 script/link 加 crossorigin，这类请求是 CORS 模式，
            // 响应 type 为 'cors' 而不是 'basic'，两者都要缓存。
            if (res && res.ok && res.type !== 'opaque') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached),
    ),
  );
});
