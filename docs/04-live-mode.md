# Live-режим (real-time графики)

> Документ-журнал фичи Live (v1.17.0+). Здесь же — **открытые todo**,
> к которым нужно вернуться после следующих итераций.
>
> **v1.17.1** — fix склейки истории и live (`mergeRaw5mWithLive`).
>
> **v1.17.2** — throttle снапшотов (250 мс по умолчанию, close-of-5m
> форсирует мгновенный emit) + pre-load 24 часов свежих klines при
> старте Live, чтобы пользователь сразу видел актуальную цену.

---

## Что входит в первую версию (v1.17.0)

### 1. WebSocket-стрим Binance aggTrade
- Endpoint: `wss://stream.binance.com:9443/ws/{symbol}@aggTrade`
- Каждое сообщение — одна агрегированная сделка (price, qty, isBuyerMaker, T, a=aggTradeId).
- Auto-reconnect с exponential backoff (1s → 2s → 5s → 15s → 30s, max 30s, неограниченное число попыток).
- Onboard статусы: `idle | connecting | live | reconnecting | error | gap-filling`.

### 2. Live-builder свечей (чистые функции)
- `applyTickToCandle(candle, tick, tickSize) → Candle5m` — добавляет тик в кластер на bucket-цене.
- `openNewCandle(timestamp, tickSize) → Candle5m` — пустая свеча на границе 5m (`floor(T / 300_000) * 300_000`).
- `finalizeCandle(candle) → Candle5m` — нормализация перед попаданием в массив (sort кластеров, корректные `delta_at_low/high`).
- Все агрегаты пересчитываются: `delta`, `vpoc_price`, `max_vol`, `delta_at_low/high`, `high/low/close`.

### 3. Throttling
- Тики копятся в очереди; на каждом `requestAnimationFrame` применяется батч одной операцией → не больше 60 setState/sec вне зависимости от плотности тиков.
- При close 5m — отдельный setState (триггер SMC + сканера).

### 4. Persistence (IndexedDB)
- Stores:
  - `liveCandles[symbol]` — закрытые live-свечи (Candle5m[]).
  - `liveMeta[symbol]` — `{ lastAggTradeId, lastTimestamp }` для gap recovery после reload.
- При старте: читаем хвост → склеиваем с историей → подключаемся к WS.
- Cleanup: свечи старше 48 часов или с timestamp <= max(history.timestamp) удаляются (история их перекрывает).

### 5. Gap recovery через REST
- При connect / reconnect: `GET /api/v3/aggTrades?symbol={S}&fromId={lastId+1}&limit=1000`.
- Пагинация до догона.
- Дедупликация по `aggTradeId` (если первый WS-тик уже среди backfill — пропускаем).

### 6. Сканер и SMC в live
- **Только Confirm-режим:** правила 4 проверяются ТОЛЬКО на закрытой свече.
- На close 5m триггерим:
  - `runSmcAnalysis(rawData5m, layers, opts)` — пересчёт SMC,
  - `runScanner({ candles, zones })` — поиск новых сигналов.
- Никаких маркеров на незакрытой свече (см. отложенное #1 ниже).

### 7. UI
- **Кнопка `Live`** в шапке рядом с «Демо» (зелёный glow когда подключено).
- **Бэйдж статуса** справа в шапке: `🟢 LIVE` / `🟡 reconnecting` / `🔴 error` / `🔵 gap-filling`.
- При активном live-режиме — кнопки «Загрузить историю» / «Демо» / «Открыть JSON» приглушены (нельзя одновременно).

---

## Отложено — TODO

### #1 Pre-signal на незакрытой свече (Live-overlay)
**Зачем:** дать алерт за секунды до закрытия свечи.
**Почему отложено:** UX-риск. Пре-сигнал «фантомен» — 5–15% таких алертов отменяются в последние секунды. Хочется сначала отладить Confirm-режим, потом добавить pre-signal как **опциональный** чекбокс в настройках с явной пометкой «не закрыто».
**Как делать:**
- На каждом тике (или RAF) — `checkSignal(currentOpenCandle)`.
- Если все 4 правила true → маркер с флагом `isLive: true` (полупрозрачный, пунктир).
- При close: правила удержались → маркер становится постоянным; нет — маркер удаляется.
- В `SmcSettingsPopover` или отдельной секции настроек — чекбокс «Live pre-signals».

### #2 SMC живые зоны (incremental update)
**Зачем:** на больших датасетах (50k+ свечей) полный re-detect на каждом close становится дороже 100мс.
**Почему отложено:** на 2k свечах (наша история сейчас) re-detect = ~50мс, не оптимизировать преждевременно.
**Как делать:**
- В `runSmcAnalysis` принимать `opts.incremental: { fromIndex, prevOverlay }`.
- Перепроверять только зоны, конец которых после `fromIndex` (mitigation, sweep, retest могут случиться).
- Новые зоны искать только в окне `[fromIndex - lookback, end]`.

### #3 Звуковые алерты
**Зачем:** трейдер не смотрит на экран постоянно.
**Почему отложено:** мелочь, легко добавить.
**Как делать:**
- `useEffect` на изменение `signals.length`. Если +1 → играем `new Audio('/alert.wav').play()`.
- В `SmcSettingsPopover` — чекбокс «Звуковые алерты» + выбор звука.
- Ассеты в `frontend/public/sounds/`.

### #4 Live tick-rate индикатор
**Зачем:** видеть «здоровье» стрима — 0 t/s = стоп, 100 t/s = шторм.
**Почему отложено:** удобство, не критично.
**Как делать:**
- В `liveCandleManager` считать тики в скользящем окне 5 секунд → `tickRateHz`.
- В `LiveStatusBadge` показывать: `🟢 LIVE · 24 t/s`.

### #5 Авто-старт live при загрузке (если был включен)
**Зачем:** пользователь закрыл вкладку → открыл → live должен сам подняться, если был активен.
**Почему отложено:** сначала убедимся, что live работает руками.
**Как делать:**
- В localStorage сохранять `liveModeEnabled: bool` при изменении.
- На старте App: если true → автоматически вызвать `enableLive()`.
- При ошибке connect — логически прекратить (status='error'), но не падать.

### #6 Multi-symbol параллельные стримы
**Зачем:** sidebar с 5 символами одновременно «жил».
**Почему отложено:** UI ещё не поддерживает мультиграфик. Нужен отдельный этап.
**Как делать:**
- Допустимо несколько `binanceLiveStream` инстансов одновременно (разные WebSocket).
- Binance лимит: 5 streams на одно соединение, или несколько соединений (у нас по одному стриму на ws — не упрёмся).

### #7 SMC pre-signal на незакрытой структуре
**Зачем:** видеть «вот сейчас close сломает HH → BOS↑».
**Почему отложено:** сложно — нужен совсем другой режим детектора, who knows если нужно.
**Как делать:** TBD.

---

## Архитектурный обзор слоёв (для будущей навигации)

```
┌────────────────────────────────────────────────────────────────┐
│  Binance WebSocket: wss://stream.binance.com:9443/ws/.../aggTrade  │
└─────────────────────────────┬──────────────────────────────────┘
                              │ raw aggTrade messages
                              ▼
┌──────────────────────────────────────────────────────┐
│  binanceLiveStream.ts                                │
│  - WebSocket-обёртка                                 │
│  - reconnect+backoff                                 │
│  - parse → AggTradeTick                              │
│  - status callback (idle/connecting/live/reconnect)  │
└─────────────────────────────┬────────────────────────┘
                              │ tick callbacks
                              ▼
┌──────────────────────────────────────────────────────┐
│  liveCandleManager.ts                                │
│  - буферизует тики                                   │
│  - на RAF apply batch через liveCandleBuilder        │
│  - детектит границы 5m → close+open                  │
│  - вызывает onCandleClosed → trigger SMC+Scanner     │
│  - сохраняет в IDB через liveStorage                 │
└─────────────────────────────┬────────────────────────┘
                              │ React state updates
                              ▼
┌──────────────────────────────────────────────────────┐
│  App.tsx                                             │
│  - state liveMode + liveStatus                       │
│  - rawData5m = [...history, ...closedLive, currentOpen?] │
│  - на close 5m: re-run SMC + Scanner                 │
└─────────────────────────────┬────────────────────────┘
                              │ render
                              ▼
                       ChartCanvas (без изменений)
```

---

## Тестовое покрытие

- **liveCandleBuilder.test.ts** — чистые функции (~10 кейсов): bucket, applyTick, openNew, finalize, корректность VPOC и delta_at_low/high.
- **binanceLiveStream.test.ts** — mock WebSocket (~5 кейсов): connect, parse, error, reconnect, disconnect.
- **binanceGapFiller.test.ts** — mock fetch (~3 кейса): page-1, multi-page, dedup.
- **liveStorage.test.ts** — fake-indexeddb (~3 кейса): save+load, cleanup.

При выходе **v1.17.0**: общее покрытие должно остаться ≥ 240/240 тестов зелёным.
