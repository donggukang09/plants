// 푸릇한 하루 Service Worker v2 - 자동 업데이트 지원
// 이 파일을 수정한 뒤 GitHub에 올리면, 사용자의 기기에서 새 버전이
// 자동으로 감지되어 다음 실행 시 적용됩니다.

const VERSION = 'v3-' + '2026-01';   // ← 새 버전 배포할 때마다 숫자만 올리세요 (v3, v4, v5...)
const CACHE_NAME = 'plant-keeper-' + VERSION;

const ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ─────────────────────────────────────────
// 설치: 새 버전이 감지되면 즉시 활성화 대기
// ─────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS).catch(() => {/* tolerate missing assets */})
    )
  );
  // 새 버전 즉시 활성화 (기존 워커 대기 안 하고)
  self.skipWaiting();
});

// ─────────────────────────────────────────
// 활성화: 옛 캐시 모두 삭제 + 모든 탭 즉시 제어
// ─────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
     .then(() => {
       // 활성 클라이언트 전체에 "새 버전 활성화됨" 알림
       return self.clients.matchAll({ type: 'window' }).then((clients) => {
         clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED', version: VERSION }));
       });
     })
  );
});

// ─────────────────────────────────────────
// fetch: HTML은 항상 네트워크 우선 (업데이트 즉시 반영)
//        이미지/JSON 등 정적 자원은 캐시 우선 (빠른 로딩)
// ─────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Google API/Sheets/Drive는 항상 네트워크 (캐싱 금지)
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('docs.google.com') ||
    url.hostname.includes('drive.google.com')
  ) {
    return; // 브라우저가 직접 처리
  }

  // 다른 출처 (CDN 등)는 캐시 우선
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.match(e.request).then((c) => c || fetch(e.request))
    );
    return;
  }

  // ── HTML(앱 본체)은 "네트워크 우선" 전략 ──
  // 페이지 새로고침 시 항상 최신 버전 시도, 실패하면 캐시 사용
  if (e.request.mode === 'navigate' || e.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // 그 외 정적 자원: 캐시 우선, 백그라운드에서 업데이트
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// ─────────────────────────────────────────
// 메시지: 페이지에서 즉시 업데이트 요청 처리
// ─────────────────────────────────────────
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─────────────────────────────────────────
// 알림 클릭 → 앱 열기
// ─────────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
