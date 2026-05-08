/**
 * Dev-only watchdog: при изменении `frontend/src/version.ts` принудительный
 * `window.location.reload()`.
 *
 * Зачем: в dev-режиме встречаются ситуации, когда HMR-WS соединение мёртвое
 * (после рестарта Vite, после убийства старых параллельных серверов или
 * когда Cursor Browser кэширует main.tsx + version.ts), и страница продолжает
 * показывать старую версию даже когда Vite уже отдаёт свежую.
 *
 * Watcher:
 *  • запускается только при `import.meta.env.DEV`;
 *  • раз в 3 секунды fetch'ит `/src/version.ts` с `cache: 'no-store'`;
 *  • парсит `APP_VERSION` регулярным выражением;
 *  • если значение отличается от вкомпилированного в текущий бандл —
 *    `window.location.reload()`.
 *
 * Сетевые сбои тихо игнорируются (не перезагружаем страницу при первом 5хх).
 *
 * Никакого кода в production-сборке: код находится за `import.meta.env.DEV`,
 * Vite вырежет всё содержимое при `vite build`.
 */

import { APP_VERSION } from '@/version';

const POLL_MS = 3000;
const VERSION_URL = '/src/version.ts';
const RE = /APP_VERSION\s*=\s*['"]([^'"]+)['"]/;

if (import.meta.env.DEV) {
  let consecutiveFailures = 0;
  const MAX_FAILS = 5;

  const tick = async () => {
    try {
      const resp = await fetch(`${VERSION_URL}?_v=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!resp.ok) {
        consecutiveFailures++;
        return;
      }
      consecutiveFailures = 0;
      const text = await resp.text();
      const match = text.match(RE);
      if (!match) return;
      const remote = match[1];
      if (remote && remote !== APP_VERSION) {
        // eslint-disable-next-line no-console
        console.info(
          `[dev:versionWatcher] APP_VERSION ${APP_VERSION} → ${remote}, reloading…`,
        );
        window.location.reload();
      }
    } catch {
      consecutiveFailures++;
    }
  };

  const id = setInterval(() => {
    if (consecutiveFailures >= MAX_FAILS) {
      // eslint-disable-next-line no-console
      console.warn(
        '[dev:versionWatcher] too many failures, stopping polling. Maybe dev server is down.',
      );
      clearInterval(id);
      return;
    }
    void tick();
  }, POLL_MS);

  // eslint-disable-next-line no-console
  console.info(`[dev:versionWatcher] enabled (${POLL_MS}ms poll)`);
}
