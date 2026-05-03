#!/usr/bin/env node
/**
 * Жёстко прибивает любой процесс, висящий на указанном порту.
 * Запускается автоматически перед `npm run dev` через хук `predev`,
 * чтобы избежать ситуации с зомби-серверами от прошлых сессий
 * (когда Vite берёт другой случайный порт, а браузер продолжает
 * подключаться к старому и видит закэшированный код).
 *
 * Использование: node scripts/kill-port.mjs 5173
 *
 * Кросс-платформенно: использует встроенный `lsof` (macOS/Linux)
 * или `netstat` + `taskkill` (Windows).
 */

import { execSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(__dirname, '..');

const port = process.argv[2] ?? '5173';

if (!/^\d+$/.test(port)) {
  console.error(`✗ Invalid port: ${port}`);
  process.exit(1);
}

function killOnUnix(p) {
  try {
    const out = execSync(`lsof -ti tcp:${p}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (!out) return [];
    const pids = out.split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      } catch {
        /* уже мёртв — ок */
      }
    }
    return pids;
  } catch {
    return [];
  }
}

function killOnWindows(p) {
  try {
    const out = execSync(`netstat -ano | findstr :${p}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!out) return [];
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/\s(\d+)$/);
      if (m) pids.add(m[1]);
    }
    const list = [...pids];
    for (const pid of list) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        /* уже мёртв */
      }
    }
    return list;
  } catch {
    return [];
  }
}

const isWin = platform() === 'win32';
const killed = isWin ? killOnWindows(port) : killOnUnix(port);

if (killed.length === 0) {
  console.log(`✓ Port ${port} is free`);
} else {
  console.log(`✓ Killed ${killed.length} stale process(es) on port ${port}: ${killed.join(', ')}`);

  // Ждём, пока ОС реально освободит TCP-сокет после SIGKILL.
  // Без этой паузы Vite со `strictPort: true` иногда стартует раньше,
  // чем порт освобождён, и падает с EADDRINUSE.
  const start = Date.now();
  function isPortBusy() {
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      return out.length > 0;
    } catch {
      return false;
    }
  }
  if (!isWin) {
    // Активный поллинг до 1500мс
    while (Date.now() - start < 1500) {
      if (!isPortBusy()) break;
      // busy-wait спать 50мс
      execSync('sleep 0.05');
    }
  }
}

// ============================================================================
// Чистим Vite-кэш зависимостей. Это второй источник «старого фронта»:
// Vite агрессивно кэширует pre-bundled ESM в node_modules/.vite, и иногда
// держит ссылки на удалённые/переименованные модули. Очистка занимает <100мс.
// ============================================================================
const viteCache = resolve(FRONTEND_ROOT, 'node_modules/.vite');
if (existsSync(viteCache)) {
  try {
    rmSync(viteCache, { recursive: true, force: true });
    console.log('✓ Cleared Vite dependency cache (node_modules/.vite)');
  } catch (err) {
    console.warn('⚠ Failed to clear Vite cache:', err?.message ?? err);
  }
}
