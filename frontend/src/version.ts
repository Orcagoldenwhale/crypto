/**
 * Версия приложения — единственный источник правды.
 *
 * Поднимать вручную при значимых изменениях. Версия видна в Header и StatusBar
 * UI, и в console.log при старте — это диагностика «свежий ли фронт у юзера».
 *
 * Время сборки приходит из Vite через `define` в `vite.config.ts`.
 */

export const APP_VERSION = '1.17.13';

/** ISO-8601 timestamp момента запуска dev-сервера (или сборки). */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

/** "13:14:55" — короткий формат для отображения в UI. */
export function buildTimeShort(): string {
  try {
    return new Date(BUILD_TIME).toLocaleTimeString('ru-RU', { hour12: false });
  } catch {
    return BUILD_TIME;
  }
}

// HMR: при любом изменении этого файла принудительный full-reload браузера.
//
// Зачем: Vite пытается hot-replace `APP_VERSION` (это const), но React-
// компоненты не подписаны на изменение этого экспорта и не перерисовываются.
// В UI остаётся старая версия. `invalidate()` форсит браузер сделать
// полный reload — пользователь сразу видит новую версию + время сборки.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
