import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Запрещаем браузеру кэшировать index.html и любые html-фрагменты в dev.
    // Без этого иногда висит старая версия HTML с устаревшими ссылками на JS.
    {
      name: 'no-cache-html',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          next();
        });
      },
    },
  ],
  define: {
    // ISO-8601 момент старта Vite. Подставляется как литерал в каждом импорте version.ts.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // strictPort: true — НЕ брать другой порт если 5173 занят.
    // Если занят — `npm run dev` упадёт с понятной ошибкой
    // (но через `predev` хук мы зачищаем порт автоматически).
    strictPort: true,
    // Прокси для Binance Vision: data.binance.vision не отдаёт CORS,
    // поэтому фронт не может качать zip напрямую. Vite перенаправляет
    // запросы /vision/* на data.binance.vision/*, а ответ отдаёт со
    // своего origin (CORS-проблема исчезает).
    //
    // Используется только в dev-режиме. В prod-сборке нужен реальный
    // backend-прокси или Cloudflare Worker.
    proxy: {
      '/vision': {
        target: 'https://data.binance.vision',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/vision/, ''),
      },
    },
  },
});
