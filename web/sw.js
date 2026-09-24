/* 순소비 캘린더 서비스 워커.
   VERSION은 pages.yml이 배포 전에 커밋 해시로 치환한다 → 배포마다 캐시 이름이 바뀐다.
   같은 출처 GET만 캐시한다. API(POST·다른 출처)는 절대 건드리지 않는다.
   skipWaiting을 부르지 않으므로 새 버전은 다음 실행에 반영된다. */
const VERSION = '__BUILD__';
const CACHE = 'sonsobi-' + VERSION;
const PRECACHE = [
  './', './index.html', './styles.css', './app.js', './setup.html', './manifest.webmanifest',
  './core/categories.js', './core/parse.js', './core/classify.js', './core/dedupe.js', './core/aggregate.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('sonsobi-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                          // API POST는 그대로 네트워크로
  if (new URL(req.url).origin !== location.origin) return;   // 같은 출처만 (폰트 CDN 제외)
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
