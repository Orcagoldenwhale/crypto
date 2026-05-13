import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { APP_VERSION, buildTimeShort } from './version';
import './dev/versionWatcher';

// ============================================================================
// Защита от устаревшего фронта
// ============================================================================

// 1. Снимаем service-workers, если кто-то их зарегистрировал ранее
//    (например, на этом же localhost из другого проекта). SW могут перехватывать
//    fetch-запросы и отдавать кэшированные ответы — главный источник «старого фронта».
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const r of regs) {
        console.warn('[startup] Unregistering stale service worker:', r.scope);
        void r.unregister();
      }
    })
    .catch(() => {});
}

// 2. Чистим CacheStorage (Cache API) — то же самое для оффлайн-кэшей PWA.
if ('caches' in window) {
  caches
    .keys()
    .then((keys) => {
      for (const k of keys) {
        console.warn('[startup] Deleting stale cache storage:', k);
        void caches.delete(k);
      }
    })
    .catch(() => {});
}

// 3. Печатаем явный signature в консоль — диагностика «свежий ли фронт».
//    Если в консоли видно старое время, а в терминале Vite свежее — кэш не сбросился.
const buildTime = buildTimeShort();
console.log(
  `%c SMC Terminal %c v${APP_VERSION} %c built ${buildTime} `,
  'background:#2962ff;color:#fff;padding:2px 6px;border-radius:3px 0 0 3px;font-weight:bold;',
  'background:#1c2030;color:#fff;padding:2px 6px;font-weight:bold;',
  'background:#0a0e1a;color:#9ca3af;padding:2px 6px;border-radius:0 3px 3px 0;',
);

// 4. Версия в заголовке окна — видно прямо во вкладке браузера.
document.title = `SMC Terminal v${APP_VERSION}`;

// ============================================================================
// Старт приложения
// ============================================================================

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
