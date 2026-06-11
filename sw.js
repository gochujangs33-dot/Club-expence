/**
 * Service Worker — 클럽 비용 정산기
 *
 * ★ 업데이트 방법:
 *   코드를 수정한 후 아래 APP_VERSION 숫자만 올려주세요.
 *   예) '1.0.0' → '1.1.0'
 *   그러면 앱에 자동으로 "업데이트 있음" 알림이 표시됩니다.
 */
const APP_VERSION = '1.6.31';
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
  './lib/employee_directory.json'
];

// ── 설치: 필요한 파일을 캐시에 저장 ──────────────────────────────
// skipWaiting()을 여기서 호출하지 않음 — 사용자가 "지금 업데이트" 버튼을
// 눌렀을 때 message 이벤트로 skipWaiting을 실행해야 배너 흐름이 정상 동작함
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
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

// ── 페이지에서 skipWaiting 요청 수신 ─────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
