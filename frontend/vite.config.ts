import fs from 'node:fs';
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
    {
      name: 'bt-log-writer',
      configureServer(server) {
        const logPath = path.resolve(__dirname, 'backtest-log.txt');
        server.middlewares.use((req, res, next) => {
          if (req.method === 'POST' && req.url === '/api/bt-log') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
              fs.writeFileSync(logPath, Buffer.concat(chunks).toString('utf-8'));
              res.writeHead(200);
              res.end('ok');
            });
            return;
          }
          next();
        });
      },
    },
    {
      // Универсальный dev-канал: фронт постит JSON, мы аппендим в файл.
      // Файл `dev-log.txt` нужен для отладки в паре с AI-ассистентом —
      // он читает файл напрямую вместо browser-console copy/paste.
      // POST /api/dev-log     — append одной JSON-строки
      // DELETE /api/dev-log   — очистить файл
      name: 'dev-log-writer',
      configureServer(server) {
        const logPath = path.resolve(__dirname, 'dev-log.txt');
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/api/dev-log') {
            next();
            return;
          }
          if (req.method === 'DELETE') {
            try { fs.writeFileSync(logPath, ''); } catch { /* ignore */ }
            res.writeHead(200);
            res.end('cleared');
            return;
          }
          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf-8');
              // Каждая запись — одна строка JSON (NDJSON-формат).
              fs.appendFileSync(logPath, body.replace(/\n/g, ' ') + '\n');
              res.writeHead(200);
              res.end('ok');
            });
            return;
          }
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
