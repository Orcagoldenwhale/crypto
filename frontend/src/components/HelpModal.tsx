/**
 * Полное руководство пользователя — большая модалка с боковым оглавлением
 * и подробным описанием всех принципов работы терминала.
 *
 * Структура:
 *   - sticky-заголовок с версией и кнопкой «×»;
 *   - слева — TOC (table of contents) с anchor-ссылками, scroll-spy подсветка
 *     активного раздела на основе IntersectionObserver;
 *   - справа — контент с разделами (`<section id=...>`).
 *
 * Закрытие: backdrop / Esc / крестик.
 *
 * Текст пишется ИЗ КОДА: каждое утверждение синхронизировано с реальной
 * реализацией (`scanner/checkSignal.ts`, `engine/smc/detect*.ts`,
 * `engine/footprint.ts`, `engine/regroupClusters.ts`, `data/aggregator.ts`).
 * Если меняется логика — этот файл нужно править зеркально.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { APP_VERSION } from '@/version';

interface HelpModalProps {
  onClose: () => void;
}

interface Section {
  id: string;
  title: string;
}

const SECTIONS: readonly Section[] = [
  { id: 'overview', title: '1. О системе' },
  { id: 'workflow', title: '2. Парадигма работы' },
  { id: 'tfpairs', title: '3. Таймфреймы и пары' },
  { id: 'poi', title: '4. POI-зоны (разметка)' },
  { id: 'footprint', title: '5. Кластерный анализ' },
  { id: 'scanner', title: '6. Сканер · 4 правила' },
  { id: 'smc', title: '7. SMC-индикатор' },
  { id: 'practice', title: '8. Практический сценарий' },
  { id: 'hotkeys', title: '9. Горячие клавиши' },
];

export function HelpModal({ onClose }: HelpModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string>(SECTIONS[0]!.id);

  // Esc → закрыть.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Scroll-spy: подсвечиваем в TOC раздел, который сейчас в видимой области
  // контента. IntersectionObserver — самый дешёвый способ, без слушателя scroll.
  // rootMargin вверху -20% — раздел считается «активным», когда его заголовок
  // прошёл выше 20% верха контейнера; снизу -60% — чтобы сразу же не активировать
  // следующий, едва он появился внизу.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const targets = SECTIONS.map((s) => root.querySelector(`#${s.id}`)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (targets.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        // Берём самый верхний из видимых.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId((visible[0].target as HTMLElement).id);
      },
      { root, rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, []);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const scrollTo = (id: string) => {
    const root = contentRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (!el) return;
    root.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdropClick}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-[min(960px,94vw)] flex-col overflow-hidden rounded-lg border border-tv-border bg-tv-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Полное руководство"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-tv-border px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-tv-text">
              Полное руководство
            </span>
            <span className="font-mono text-[10px] text-tv-text-muted">
              v{APP_VERSION}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-tv-text-muted hover:text-tv-text"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: TOC + content */}
        <div className="flex min-h-0 flex-1">
          {/* TOC */}
          <nav
            className="hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-tv-border bg-tv-bg-deep/50 p-2 sm:flex"
            aria-label="Оглавление"
          >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className={
                  'rounded px-2 py-1.5 text-left text-[12px] transition-colors ' +
                  (activeId === s.id
                    ? 'bg-tv-accent/15 text-tv-accent'
                    : 'text-tv-text-dim hover:bg-tv-panel-hover hover:text-tv-text')
                }
              >
                {s.title}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-tv-text"
          >
            <Overview />
            <Workflow />
            <TfPairs />
            <Poi />
            <Footprint />
            <Scanner />
            <Smc />
            <Practice />
            <Hotkeys />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Контент. Каждая секция — отдельная функция-компонент, чтобы редактировать
// независимо без скролла по тысячам строк.
// ============================================================================

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="mb-2 mt-6 scroll-mt-2 border-b border-tv-border pb-1 text-[15px] font-semibold text-tv-text first:mt-0"
    >
      {children}
    </h3>
  );
}

function H4({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 mt-4 text-[13px] font-semibold text-tv-text">
      {children}
    </h4>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-tv-text-dim">{children}</p>;
}

function L({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mb-2 ml-4 list-disc space-y-1 text-tv-text-dim marker:text-tv-text-muted">
      {children}
    </ul>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-tv-bg-deep px-1 py-px font-mono text-[12px] text-tv-accent">
      {children}
    </code>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-2 overflow-x-auto rounded border border-tv-border bg-tv-bg-deep p-2 font-mono text-[11px] leading-snug text-tv-text">
      {children}
    </pre>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 rounded border-l-2 border-tv-accent/60 bg-tv-accent/5 px-3 py-2 text-[12px] text-tv-text-dim">
      {children}
    </div>
  );
}

// 1. Overview ----------------------------------------------------------------

function Overview() {
  return (
    <>
      <H id="overview">1. О системе</H>
      <P>
        Это полуавтоматический терминал для бэктеста торговых стратегий, который
        объединяет два уровня анализа:
      </P>
      <L>
        <li>
          <b>Макро (Smart Money Concepts):</b> выявление структурных зон —
          POI/Order Blocks/FVG/Liquidity/BOS-CHoCH — на старшем таймфрейме.
          Здесь определяется «куда смотрит крупный капитал».
        </li>
        <li>
          <b>Микро (Footprint / Order Flow):</b> кластерный анализ ордерфлоу на
          младшем ТФ — Bid×Ask на каждом ценовом уровне, дельта, VPOC,
          имбалансы, поглощения. Здесь подтверждается реальная сила движения
          в моменте.
        </li>
      </L>
      <P>
        Источник данных — Binance Vision (бесплатные daily-архивы AggTrades).
        Из них собираются 5-минутные свечи с полной кластерной разбивкой.
        Старшие таймфреймы (15m / 1h) строятся терминалом автоматически из
        тех же 5m: дополнительных загрузок не требуется.
      </P>
    </>
  );
}

// 2. Workflow ---------------------------------------------------------------

function Workflow() {
  return (
    <>
      <H id="workflow">2. Парадигма работы</H>
      <P>
        Один экран, всё пространство отдано графику. Парадигма: <b>макро-контекст
        → автоматический сканер → микро-зум по клику</b>.
      </P>
      <L>
        <li>
          <b>1) Разметка на HTF.</b> Загрузил историю → на старшем ТФ
          инструментом <Code>R</Code> (или иконкой квадрата) выделил
          прямоугольником зоны интереса. Зоны хранятся per-symbol в IndexedDB
          и переживают перезагрузку.
        </li>
        <li>
          <b>2) Сканер.</b> Кнопка <Code>S</Code> (или иконка лупы) запускает
          поиск 5-минутных свечей внутри зон, удовлетворяющих 4 строгим правилам
          (см. раздел 6). Сканер крутится в Web Worker — UI не блокируется.
        </li>
        <li>
          <b>3) Подсветка.</b> Зоны с найденными сигналами загораются плотной
          зелёной рамкой. В правом нижнем углу появляется отчёт: всего
          зон / со сигналом / LONG / SHORT / время выполнения.
        </li>
        <li>
          <b>4) Микро-зум.</b> Клик по зелёной зоне → меню «Перейти на LTF».
          График переключается на младший ТФ, авто-зум на ±9 свечей вокруг
          зоны, мгновенно виден footprint и точка входа.
        </li>
        <li>
          <b>5) Разбор сделки.</b> Клик по маркеру сигнала (▲ зелёный для LONG,
          ▼ красный для SHORT) → внизу-слева открывается карточка с разбором
          всех 4 правил по конкретным цифрам + бонус-индикаторы (имбалансы,
          «нуль на экстремуме»). Соседние сигналы — стрелки <Code>←</Code> /
          <Code>→</Code>.
        </li>
      </L>
    </>
  );
}

// 3. TfPairs ----------------------------------------------------------------

function TfPairs() {
  return (
    <>
      <H id="tfpairs">3. Таймфреймы и пары</H>
      <P>
        Терминал умеет работать с парами «старший→младший» (HTF→LTF) и в
        одно-таймфреймовом режиме (single). Переключатель — справа сверху.
      </P>
      <H4>Двухуровневые пары (HTF + LTF)</H4>
      <L>
        <li>
          <Code>1h → 15m</Code> — крупный контекст на часе, точка входа на 15m.
        </li>
        <li>
          <Code>1h → 5m</Code> — крупный контекст, вход на 5m с полным
          footprint'ом.
        </li>
        <li>
          <Code>15m → 5m</Code> — классический сетап для интрадей-скальпинга.
        </li>
      </L>
      <P>
        В двухуровневом режиме <b>зоны и SMC-индикатор живут только на HTF</b>,
        а сканер, маркеры сигналов и кластеры — на LTF. Между экранами
        переключаемся кнопками <Code>HTF</Code> / <Code>LTF</Code> в правом
        верхнем углу.
      </P>
      <H4>Single-режим (один ТФ)</H4>
      <L>
        <li>
          <Code>1h-1h</Code>, <Code>15m-15m</Code>, <Code>5m-5m</Code> — HTF и
          LTF совпадают.
        </li>
        <li>
          На одном экране одновременно видны: зоны, маркеры сигналов,
          SMC-оверлей и (где влезает по ширине свечи) footprint.
        </li>
        <li>Не нужно переключать экран — удобно для быстрых ревью истории.</li>
      </L>
      <Note>
        Footprint включается автоматически, когда ширина свечи на экране ≥ 50px
        (свечи нужно «зумнуть»). На 1h-1h большинство свечей уже достаточно
        широкие при умеренном зуме.
      </Note>
    </>
  );
}

// 4. POI --------------------------------------------------------------------

function Poi() {
  return (
    <>
      <H id="poi">4. POI-зоны (ручная разметка)</H>
      <H4>Создание</H4>
      <L>
        <li>
          Активируй инструмент «Прямоугольник» (<Code>R</Code> или иконка
          квадрата в Toolbox). Доступен только на HTF / в single-режиме.
        </li>
        <li>
          Зажми ЛКМ и протяни — появится draft-прямоугольник. Отпускание
          фиксирует зону. Случайные клики (&lt;6 px) игнорируются.
        </li>
        <li>
          Координаты нормализуются: <Code>min/max</Code> по времени и цене —
          неважно, в какую сторону тянул.
        </li>
      </L>
      <H4>Действия с зоной</H4>
      <L>
        <li>
          <b>Выбор:</b> клик по зоне в режиме Pointer — выделится жёлтой
          рамкой, появится контекстное меню.
        </li>
        <li>
          <b>Перейти на LTF:</b> в меню — нажми «Перейти на LTF». График
          переключится и сделает zoom на ±9 LTF-свечей вокруг зоны.
        </li>
        <li>
          <b>Удалить:</b> кнопка в меню или <Code>Delete</Code> /
          <Code>Backspace</Code> при выделении.
        </li>
        <li>
          <b>Очистить все:</b> иконка корзины в Toolbox с подтверждением.
        </li>
        <li>
          <b>Undo / Redo:</b> <Code>Cmd/Ctrl + Z</Code> и
          <Code>Cmd/Ctrl + Shift + Z</Code> (или <Code>Ctrl + Y</Code>). Стек
          до 50 операций. Покрывает create / delete / clear-all.
        </li>
      </L>
      <H4>Hit-test и приоритеты</H4>
      <P>
        Когда зоны перекрываются, клик ловит ту, что нарисована позже. Так не
        мешают «материнские» крупные зоны при работе с уточнёнными.
      </P>
      <H4>Хранение</H4>
      <P>
        Зоны хранятся в IndexedDB по ключу-символу. У каждого тикера —
        собственная разметка. При смене символа разметка переключается
        автоматически. Дубликаты (по совпадающим временным+ценовым границам)
        дедуплицируются на загрузке.
      </P>
    </>
  );
}

// 5. Footprint --------------------------------------------------------------

function Footprint() {
  return (
    <>
      <H id="footprint">5. Кластерный анализ (Footprint)</H>
      <P>
        Footprint — это «рентген» свечи. Каждая 5-минутная свеча хранит набор
        кластеров — по одному на каждый ценовой уровень. Кластер — это пара
        чисел: сколько объёма прошло в Bid (рыночные продажи) и в Ask
        (рыночные покупки). Из них выводятся все остальные метрики.
      </P>

      <H4>Когда включается footprint-рендер</H4>
      <L>
        <li>
          Ширина свечи на экране ≥ 50px (приближаемся колесом).
        </li>
        <li>
          У свечи есть полноценные кластеры (минимум 2 уровня). Иначе fallback
          на классический OHLC.
        </li>
      </L>

      <H4>Что мы видим в ячейке кластера</H4>
      <L>
        <li>
          <b>Heatmap дельты (фон ячейки).</b> Зелёный — преобладают покупки
          (<Code>delta &gt; 0</Code>), красный — продажи. Интенсивность =
          <Code>min(|delta| / max_vol, 0.5)</Code>: нормировка к самой
          объёмной ячейке свечи, а не к абсолюту — даёт стабильную картину
          независимо от инструмента.
        </li>
        <li>
          <b>Гистограмма объёма.</b> Полупрозрачная белая заливка слева —
          доля от <Code>max_vol</Code> свечи. Образует визуальный «колокол»
          распределения.
        </li>
        <li>
          <b>VPOC (Volume Point of Control).</b> Ячейка с максимальным объёмом
          обведена белой жирной (1.5px) рамкой. Это точка, где аукцион
          задержался дольше всего — основной интерес обеих сторон.
        </li>
        <li>
          <b>Текст <Code>Bid × Ask</Code>.</b> По центру ячейки. Скрыт, если
          ячейка слишком узкая (&lt;48 px) или низкая (&lt;12 px). Числа
          форматируются адаптивно: 0 → «0», &lt;1 → «0.42», &lt;10 → «3.5»,
          &lt;1000 → целое, ≥1000 → «1.2k».
        </li>
        <li>
          <b>Имбалансы 2×.</b> Если <Code>ask ≥ 2·bid</Code> и <Code>bid &gt; 0</Code>{' '}
          — Ask становится зелёным жирным (бычий имбаланс). Если{' '}
          <Code>bid ≥ 2·ask</Code> и <Code>ask &gt; 0</Code> — Bid становится
          красным жирным (медвежий). На графике эти точки также подсвечиваются
          точками-маркерами на свече выбранного сигнала.
        </li>
      </L>

      <H4>Регулятор размера ячейки (TickPicker)</H4>
      <P>
        Вверху-справа есть селектор tick × N. Он укрупняет вертикальную сетку
        кластеров: <Code>×1</Code> — нативный шаг, <Code>×2/×5/×10</Code> —
        объединяет соседние уровни. Полезно для инструментов с очень мелким
        шагом (BTC ×0.1, SOL ×0.01) — иначе ячейки вырождаются в пиксельную
        пыль. Режим <b>«авто»</b> подбирает множитель по средней плотности
        кластеров: ≤25 → ×1, ≤60 → ×2, ≤150 → ×5, иначе ×10.
      </P>
      <Note>
        VPOC, max_vol и delta_at_low/high пересчитываются под укрупнённую
        сетку — сканер всегда читает <i>актуальные</i> метрики, рассогласования
        с UI быть не может.
      </Note>

      <H4>Тултип под курсором</H4>
      <P>
        В footprint-режиме hover по ячейке — голубая обводка + всплывающий
        тултип: price / Bid / Ask / Vol / Delta. Если на ячейке имбаланс 2× —
        в тултипе бэйдж <Code>⚡ imb 2×</Code>.
      </P>
    </>
  );
}

// 6. Scanner ----------------------------------------------------------------

function Scanner() {
  return (
    <>
      <H id="scanner">6. Сканер · 4 правила входа</H>
      <P>
        Сканер обходит каждую 5-минутную свечу <i>внутри</i> размеченных зон и
        проверяет 4 жёстких правила. Свеча считается входом только если все 4
        выполнены одновременно. Любое нарушение — пропуск.
      </P>
      <P>
        Свеча считается «попадающей в зону», если её timestamp лежит в
        [<Code>startTime, endTime</Code>] зоны и ценовой интервал
        <Code> [low, high] </Code> пересекается с
        <Code> [minPrice, maxPrice] </Code>.
      </P>

      <H4>LONG — все 4 правила должны быть true</H4>
      <Pre>
        {`R1  polarity     close  >  (high + low) / 2     // закрытие в верхней половине
R2  totalDelta   delta  >  0                       // суммарный поток покупок
R3  closeVsVpoc  close  >  vpoc_price              // закрытие выше точки макс. объёма
R4  absorption   delta_at_low  <  0                // на минимуме били в продажу,
                                                   //   а покупатель «съел» удар`}
      </Pre>

      <H4>SHORT — зеркальная картина</H4>
      <Pre>
        {`R1  close  <  (high + low) / 2
R2  delta  <  0
R3  close  <  vpoc_price
R4  delta_at_high  >  0`}
      </Pre>

      <H4>Что значит каждое правило</H4>
      <L>
        <li>
          <b>R1 — Polarity (полярность).</b> Свеча должна закрыться <i>в
          сторону сделки</i>. Закрытие выше середины диапазона — покупатель
          победил в этой пятиминутке; ниже — продавец.
        </li>
        <li>
          <b>R2 — Total delta (суммарный поток).</b> Сумма дельт всех
          кластеров строго в нужную сторону. Подтверждает, что движение шло
          именно по рынку, а не «нарисовано» лимитами.
        </li>
        <li>
          <b>R3 — Close vs VPOC.</b> VPOC — это «магнит» интереса в свече.
          Если LONG-свеча закрылась выше VPOC, значит цена пробила центр масс
          объёма и удержалась — крупный игрок согласен с движением.
        </li>
        <li>
          <b>R4 — Absorption (поглощение на экстремуме).</b> Самое тонкое
          правило. Для LONG требуем, чтобы на самом нижнем уровне свечи
          <Code>delta &lt; 0</Code>: розница вваливала продажами, но цена
          оттуда ушла наверх → продавец был «съеден» лимитным покупателем.
          Это и есть отпечаток крупного покупателя в основании.
        </li>
      </L>

      <H4>Бонус-индикаторы (необязательные)</H4>
      <P>
        Не влияют на наличие сигнала — только показывают, насколько он
        «жирный». Видны в карточке сделки и точечными маркерами на свече.
      </P>
      <L>
        <li>
          <b>Имбалансы потока.</b> Сколько в свече одноцветных кластеров с
          диагональным сдвигом ≥2× в сторону сделки. Для LONG считаем зелёные
          (<Code>ask ≥ 2·bid</Code>), для SHORT — красные.
        </li>
        <li>
          <b>«Нуль на экстремуме».</b> LONG: на самом нижнем кластере
          <Code>ask == 0</Code> (последние агрессивные покупки иссякли —
          аукцион вниз исчерпан). SHORT: на самом верхнем
          <Code>bid == 0</Code>. Очень сильный признак разворота, когда есть.
        </li>
      </L>

      <H4>Explore-режим</H4>
      <P>
        Если зон не нарисовано, кнопка <Code>S</Code> запускает сканер по
        ВСЕМУ датасету (виртуальная зона). Удобно, чтобы быстро увидеть, где
        в истории вообще есть сетапы — дальше нарисовать настоящие зоны.
      </P>
      <Note>
        Сканер выполняется в Web Worker — UI не «замерзает» даже на больших
        датасетах. Если воркер не ответил за 5 сек, автоматический fallback
        на синхронный прогон в основном потоке.
      </Note>
    </>
  );
}

// 7. SMC --------------------------------------------------------------------

function Smc() {
  return (
    <>
      <H id="smc">7. SMC-индикатор</H>
      <P>
        SMC-оверлей рисуется на HTF (или на single-экране) и состоит из 4
        независимых слоёв. Каждый можно включить/выключить иконкой в Toolbox.
        Параметры детекторов и фильтры — в шестерёнке настроек.
      </P>

      <H4>Параметры (общие)</H4>
      <L>
        <li>
          <b>Lookback</b> (2..50 свечей) — окно «слева/справа» для определения
          swing-point. Свинг — это локальный максимум/минимум, который выше
          (ниже) ближайших <i>lookback</i> свечей с обеих сторон. Чем больше
          lookback, тем «крупнее» структура и реже срабатывания.
        </li>
        <li>
          <b>Допуск equal-highs/lows</b> (% от цены, по умолчанию 0.05%). Два
          свинга считаются «равными», если разница их цен меньше этого
          допуска. Используется в Liquidity-детекторе.
        </li>
        <li>
          <b>Прятать отработанные</b> — четыре независимых тоггла: можно
          отдельно скрыть mitigated FVG, swept Liquidity, ретестнутую
          Structure, mitigated Order Blocks. Чистит график на длинной
          истории, оставляя только «живые» сетапы.
        </li>
      </L>

      <H4>FVG — Fair Value Gap</H4>
      <P>
        Трёхсвечный ценовой разрыв (impulsive displacement). Между свечой №1 и
        свечой №3 есть пустота, которую цена «перепрыгнула». Это область
        неэффективности — рынок часто возвращается её протестировать.
      </P>
      <Pre>
        {`Bull FVG (gap up):    low[i+1]  >  high[i-1]   →  зона = [high[i-1] .. low[i+1]]
Bear FVG (gap down):  high[i+1] <  low[i-1]    →  зона = [high[i+1] .. low[i-1]]`}
      </Pre>
      <L>
        <li>
          <b>Mitigation:</b> зона считается отработанной, как только
          какая-нибудь свеча после displacement-тройки коснулась её
          mitigation-уровня. Bull — <Code>low ≤ maxPrice</Code>, bear —
          <Code>high ≥ minPrice</Code>. Mitigation ищем НАЧИНАЯ со свечи №4 —
          задержка в одну свечу после displacement.
        </li>
        <li>
          Активные (<i>unmitigated</i>) рисуются ярко, отработанные —
          приглушённо. Можно полностью спрятать через настройку.
        </li>
      </L>

      <H4>Liquidity — equal highs/lows + sweeps</H4>
      <P>
        Скопление ликвидности — два или более свинг-points с близкими ценами.
        Это «ловушка»: за этими уровнями скапливаются стоп-лоссы, и крупные
        игроки часто пробивают их, чтобы забрать ликвидность.
      </P>
      <L>
        <li>
          Алгоритм: ищем все локальные максимумы (для high-pool) с окном
          lookback и группируем те, цены которых близки в пределах
          equalityTolerancePct. Линия рисуется по средней цене группы. Точно
          так же — для минимумов (low-pool).
        </li>
        <li>
          <b>Sweep:</b> момент, когда свеча пробила уровень <i>и закрылась
          обратно</i>. Для high-pool: <Code>high &gt; level</Code> и{' '}
          <Code>close &lt; level</Code>. Для low-pool: <Code>low &lt; level</Code>
          и <Code>close &gt; level</Code>. Это и есть «ловушка сработала» —
          часто разворотный паттерн.
        </li>
        <li>
          Метка <Code>EQH×N</Code> / <Code>EQL×N</Code> показывает количество
          касаний. Чем больше N — тем «жирнее» ликвидность.
        </li>
      </L>

      <H4>Structure — BOS / CHoCH + retest</H4>
      <P>
        Рыночная структура определяется последовательностью свингов
        (HH/HL — uptrend, LH/LL — downtrend). Когда close пробивает
        ключевой свинг, фиксируем событие:
      </P>
      <L>
        <li>
          <b>BOS (Break of Structure)</b> — продолжение тренда. Uptrend +
          close выше предыдущего HH → BOS↑. Downtrend + close ниже LL → BOS↓.
        </li>
        <li>
          <b>CHoCH (Change of Character)</b> — разворот. Uptrend + close ниже
          последнего HL → CHoCH↓. Downtrend + close выше последнего LH →
          CHoCH↑. Это первый признак смены настроения рынка.
        </li>
        <li>
          <b>Retest:</b> после break фиксируем первую свечу, которая коснулась
          сломанного уровня. Up-break — <Code>low ≤ level</Code>, down-break —
          <Code>high ≥ level</Code>. Retest — типовая точка входа: цена
          вернулась проверить пробитый уровень и оттолкнулась.
        </li>
      </L>

      <H4>Order Blocks (OB)</H4>
      <P>
        Зона интереса от «институционалов» — последняя противонаправленная
        свеча перед импульсом, который сломал структуру. Логика: крупный
        игрок продал/купил, цена ушла далеко в его сторону → если она
        вернётся в эту свечу, он, скорее всего, защитит позицию повторно.
      </P>
      <L>
        <li>
          <b>Bull OB</b> = последний bearish-бар перед импульсом вверх,
          сломавшим структуру (BOS↑ или CHoCH↑). Зона = [low, high] этой
          свечи. Теперь это потенциальная поддержка.
        </li>
        <li>
          <b>Bear OB</b> = последний bullish-бар перед импульсом вниз. Теперь
          это потенциальное сопротивление.
        </li>
        <li>
          <b>Strong OB</b> (флаг <Code>+FVG</Code>): между OB и break-свечой
          обнаружен Fair Value Gap. Это «сильный» OB — импульс был достаточно
          резким, чтобы оставить разрыв; такие зоны отрабатывают чаще.
        </li>
        <li>
          <b>Mitigation</b> — первая свеча после break, которая коснулась
          [low, high] OB. После этого зона помечается «отработана», можно
          фильтром скрыть.
        </li>
      </L>
      <Note>
        В Toolbox каждый слой — независимая иконка. Можно показать только
        FVG+Liquidity (для скальпинга на запрыгах) или только Structure+OB
        (для свингового интрадей). Любая комбинация валидна.
      </Note>
    </>
  );
}

// 8. Practice ---------------------------------------------------------------

function Practice() {
  return (
    <>
      <H id="practice">8. Практический сценарий</H>
      <P>Типовой рабочий цикл:</P>
      <L>
        <li>
          <b>1) Выбираем инструмент и пару ТФ.</b> В шапке — символ (BTC/ETH/SOL/
          BNB/TON). Справа — пара, например <Code>15m → 5m</Code>. Авто-загрузка
          предзагруженного 5-дневного датасета.
        </li>
        <li>
          <b>2) Включаем SMC на HTF.</b> На графике появляются FVG, ловушки
          ликвидности, структурные пробои и Order Blocks. Они подсказывают,
          где имеет смысл искать вход — обычно на пересечении нескольких
          концепций (например, bull OB совпадает с bull FVG и со sweep'ом
          low-pool снизу).
        </li>
        <li>
          <b>3) Размечаем POI.</b> Прямоугольником обводим самые интересные
          области (свежие unmitigated OB/FVG, equal highs за которыми стоит
          ликвидность). Зон может быть много — сканер пройдётся по всем.
        </li>
        <li>
          <b>4) Запускаем сканер.</b> <Code>S</Code>. Через секунду зоны со
          входами загораются зелёным.
        </li>
        <li>
          <b>5) Смотрим LTF.</b> Клик по зелёной зоне → «Перейти на LTF» →
          график переключается, footprint виден сразу. Маркер сигнала — кликом
          открывает карточку с разбором.
        </li>
        <li>
          <b>6) Анализируем кластеры на сигнале.</b> Смотрим: где VPOC, есть
          ли поглощение на low/high, имбалансы, «нуль на экстремуме». Чем
          больше бонусов — тем сильнее сетап.
        </li>
        <li>
          <b>7) Возврат.</b> «Назад к HTF» в шапке — общий обзор. Стрелками
          <Code>←</Code>/<Code>→</Code> переходим между сигналами без
          перехода в HTF.
        </li>
      </L>
      <H4>Что считается «жирным» сигналом</H4>
      <L>
        <li>Свеча сигнала попала в active (unmitigated) OB или FVG на HTF.</li>
        <li>Перед сигналом был свежий sweep ликвидности.</li>
        <li>На LTF на свече сигнала: ≥2 имбаланса по направлению.</li>
        <li>«Нуль на экстремуме» (ask=0 на low для LONG / bid=0 на high для SHORT).</li>
        <li>Закрытие далеко от VPOC (close − vpoc_price большое по модулю).</li>
      </L>
    </>
  );
}

// 9. Hotkeys ----------------------------------------------------------------

function Hotkeys() {
  return (
    <>
      <H id="hotkeys">9. Горячие клавиши</H>
      <Pre>
        {`V              Pointer (навигация)
R              Прямоугольник (разметка POI, только HTF/single)
S              Запустить сканер
Esc            Снять выделение / закрыть меню / отменить рисование
Delete / ⌫     Удалить выделенную зону
← / →          Предыдущий / следующий сигнал

Cmd/Ctrl + Z         Undo (создание / удаление / clear-all зон)
Cmd/Ctrl + Shift + Z Redo
Ctrl + Y             Redo (Win-конвенция)`}
      </Pre>
    </>
  );
}
