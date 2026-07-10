/**
 * Service Worker — 클럽 비용 정산기
 *
 * ★ 업데이트 방법:
 *   코드를 수정한 후 아래 APP_VERSION 숫자만 올려주세요.
 *   예) '1.0.0' → '1.1.0'
 *   그러면 앱에 자동으로 "업데이트 있음" 알림이 표시됩니다.
 */
const APP_VERSION = '1.6.207';
const CACHE_NAME  = `club-expense-v${APP_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './lib/xlsx.mini.min.js',
  './lib/jszip.min.js',
  './lib/chart.min.js',
  './lib/template.xlsx',
  './lib/employee_directory.json',
  './lib/i18n.js'
];

// ── 설치: 필요한 파일을 캐시에 저장 ──────────────────────────────
// skipWaiting()을 설치 시 즉시 호출 — 새 버전 배포 시 대기 없이 바로 활성화
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' — 브라우저 HTTP 캐시(GitHub Pages max-age 600초)를 우회하고
      // 항상 서버에서 최신 파일을 받아 캐시 (구버전 app.js가 새 캐시에 들어가는 것 방지)
      .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
  );
});

// ── 활성화: 이전 버전 캐시 삭제 ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
      .then(() => {
        // claim() 완료 후 모든 탭에 새 버전 알림
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client =>
            client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })
          );
        });
      })
  );
});

// ── 요청 처리: 네트워크 우선, 실패 시 캐시 ────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 성공하면 캐시도 최신으로 갱신
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── 페이지에서 skipWaiting / 버전 질의 요청 수신 ─────────────────
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
  // 페이지 로드 시 버전 질의 — activate 시점 SW_UPDATED 메시지가
  // controllerchange 자동 리로드와 경쟁해 유실돼도 라벨이 항상 동기화되도록 함
  if (event.data?.action === 'getVersion' && event.source) {
    event.source.postMessage({ type: 'SW_VERSION', version: APP_VERSION });
  }
});
