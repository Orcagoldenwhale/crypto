/**
 * ============================================================================
 * SMC Footprint Backtester — REFERENCE PROTOTYPE
 * ============================================================================
 * Источник: «Новый документ.docx» из исходного наброска проекта.
 * Это монолитный React + SVG прототип (~720 строк), который содержит:
 *   - generateMockData(numCandles): мок-генератор 5m свечей с кластерами
 *   - checkSignal(candle): чистая функция-сканер с 4 правилами
 *   - InteractiveChart: SVG-рендер свечей / футпринта / POI / crosshair
 *   - App: главный компонент с header / toolbox / scanner-report / zone menu
 *
 * НАЗНАЧЕНИЕ В НАШЕМ ПРОЕКТЕ:
 *   Этот файл НЕ компилируется и НЕ импортируется в production-код.
 *   Используется как РЕФЕРЕНС для:
 *     - сверки бизнес-логики сканера (Этап 6)
 *     - сверки UI/UX поведения (Этапы 4-5)
 *     - генерации мок-данных (Этап 2 — портируем в data/mockGenerator.ts)
 *
 * ОТЛИЧИЯ ОТ ЦЕЛЕВОЙ РЕАЛИЗАЦИИ:
 *   - SVG → Canvas (для 60 FPS на 100k+ свечей)
 *   - JSX → TypeScript strict
 *   - Один файл → модульная архитектура (engine / data / scanner / components)
 *   - Без тестов → vitest для сканера и агрегатора
 *   - Без IndexedDB → автосохранение POI и кэш парсинга
 *   - Без Web Worker → сканер в отдельном потоке
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Search, FileText, CheckCircle2, Hand, MousePointer2, Settings2, ArrowLeft, Maximize2, Trash2 } from 'lucide-react';

// --- ГЕНЕРАТОР МОК-ДАННЫХ С ФУТПРИНТОМ ---
const TICK_SIZE = 5;

const generateMockData = (numCandles) => {
    let currentPrice = 40000;
    let currentTime = new Date('2023-10-01T00:00:00Z').getTime();
    const data_5m = [];

    for (let i = 0; i < numCandles; i++) {
        let trend = Math.sin(i / 20); 
        let volatility = 30 + Math.random() * 40;
        
        let open = currentPrice;
        let close = open + (Math.random() * volatility * 2 - volatility) + (trend * 15);
        let high = Math.max(open, close) + Math.random() * 20;
        let low = Math.min(open, close) - Math.random() * 20;
        
        high = Math.ceil(high / TICK_SIZE) * TICK_SIZE;
        low = Math.floor(low / TICK_SIZE) * TICK_SIZE;
        
        let isPerfectLong = (i === 95);   
        let isPerfectShort = (i === 160); 

        if (isPerfectLong) {
            close = low + (high - low) * 0.75; 
        } else if (isPerfectShort) {
            close = low + (high - low) * 0.25; 
        }

        const clusters = [];
        let totalVol = 0;
        let totalDelta = 0;
        let maxClusterVol = 0;
        let vpocPrice = low;

        for (let p = low; p <= high; p += TICK_SIZE) {
            let bid = Math.floor(Math.random() * 100) + 20;
            let ask = Math.floor(Math.random() * 100) + 20;

            if (isPerfectLong) {
                if (p === low) {
                    bid = 350; ask = 50; 
                } else if (p === Math.floor((low + (high - low) * 0.3) / TICK_SIZE) * TICK_SIZE) {
                    bid = 300; ask = 900; 
                } else {
                    bid = Math.floor(Math.random() * 50) + 10;
                    ask = bid + Math.floor(Math.random() * 100) + 20; 
                }
            } 
            else if (isPerfectShort) {
                if (p === high) {
                    bid = 50; ask = 350; 
                } else if (p === Math.floor((low + (high - low) * 0.7) / TICK_SIZE) * TICK_SIZE) {
                    bid = 900; ask = 300; 
                } else {
                    ask = Math.floor(Math.random() * 50) + 10;
                    bid = ask + Math.floor(Math.random() * 100) + 20; 
                }
            } 
            else {
                if (p > low + (high-low)*0.3 && p < low + (high-low)*0.7) {
                    bid += 150; 
                    ask += 150;
                }
            }

            let vol = bid + ask;
            let cDelta = ask - bid;

            clusters.push({ price: p, vol, delta: cDelta, bid, ask });
            totalVol += vol;
            totalDelta += cDelta;

            if (vol > maxClusterVol) {
                maxClusterVol = vol;
                vpocPrice = p;
            }
        }

        data_5m.push({
            id: i,
            timestamp: currentTime,
            open, high, low, close,
            volume: totalVol,
            delta: totalDelta,
            max_vol: maxClusterVol, 
            vpoc_price: vpocPrice,
            delta_at_low: clusters.find(c => c.price === low)?.delta || 0,
            delta_at_high: clusters.find(c => c.price === high)?.delta || 0,
            clusters,
            isPerfectLong,
            isPerfectShort
        });

        currentPrice = close;
        currentTime += 5 * 60 * 1000;
    }
    return data_5m;
};

const checkSignal = (candle) => {
    if (!candle) return null;
    const range = candle.high - candle.low;
    const midpoint = candle.low + (range * 0.5);

    const isCloseAbove50 = candle.close > midpoint;
    const isCloseBelow50 = candle.close < midpoint;

    const isLong = isCloseAbove50 && candle.delta > 0 && candle.close > candle.vpoc_price && candle.delta_at_low < 0;
    const isShort = isCloseBelow50 && candle.delta < 0 && candle.close < candle.vpoc_price && candle.delta_at_high > 0;

    if (isLong) return 'LONG';
    if (isShort) return 'SHORT';
    return null;
};

// --- КОМПОНЕНТ ИНТЕРАКТИВНОГО ГРАФИКА ---
const InteractiveChart = ({ data, timeframe, domainX, setDomainX, poiZones, setPoiZones, isDrawingMode, signals, onZoneClick, onClearMenu }) => {
    const svgRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [tempZone, setTempZone] = useState(null);
    const [crosshair, setCrosshair] = useState(null); // Состояние для перекрестия

    const visibleData = useMemo(() => {
        if (!data.length) return [];
        return data.filter(d => d.timestamp >= domainX[0] && d.timestamp <= domainX[1]);
    }, [data, domainX]);

    const minPrice = Math.min(...visibleData.map(d => d.low)) - 50;
    const maxPrice = Math.max(...visibleData.map(d => d.high)) + 50;
    const priceRange = maxPrice - minPrice || 1;
    const timeRange = domainX[1] - domainX[0] || 1;

    const getTimeFromX = (x, width) => domainX[0] + (x / width) * timeRange;
    const getPriceFromY = (y, height) => minPrice + ((height - y) / height) * priceRange;

    const handleWheel = (e) => {
        e.preventDefault();
        onClearMenu();
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const width = svgRef.current.clientWidth;
        const mouseX = e.nativeEvent.offsetX;
        
        const pivotTime = getTimeFromX(mouseX, width);
        
        const newStart = pivotTime - (pivotTime - domainX[0]) * zoomFactor;
        const newEnd = pivotTime + (domainX[1] - pivotTime) * zoomFactor;
        
        const minTimeRange = 10 * 5 * 60 * 1000; 
        if (newEnd - newStart > minTimeRange) {
            setDomainX([newStart, newEnd]);
        }
    };

    const handleMouseDown = (e) => {
        onClearMenu();
        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setIsDragging(true);
        setDragStart({ x, y, time: getTimeFromX(x, rect.width), price: getPriceFromY(y, rect.height) });

        if (isDrawingMode && timeframe === '15m') {
            setTempZone({
                startTime: getTimeFromX(x, rect.width),
                endTime: getTimeFromX(x, rect.width),
                topPrice: getPriceFromY(y, rect.height),
                bottomPrice: getPriceFromY(y, rect.height)
            });
        }
    };

    const handleMouseMove = (e) => {
        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Обновляем перекрестие
        setCrosshair({ x: (x / rect.width) * 100, y: (y / rect.height) * 100 });

        if (!isDragging) return;

        if (isDrawingMode && timeframe === '15m') {
            setTempZone(prev => ({
                ...prev,
                endTime: getTimeFromX(x, rect.width),
                bottomPrice: getPriceFromY(y, rect.height)
            }));
        } else {
            const dx = x - dragStart.x;
            const timeShift = (dx / rect.width) * timeRange;
            setDomainX([domainX[0] - timeShift, domainX[1] - timeShift]);
            setDragStart({ ...dragStart, x, y });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        if (isDrawingMode && tempZone && timeframe === '15m') {
            const finalZone = {
                id: Date.now(),
                startTime: Math.min(tempZone.startTime, tempZone.endTime),
                endTime: Math.max(tempZone.startTime, tempZone.endTime),
                minPrice: Math.min(tempZone.topPrice, tempZone.bottomPrice),
                maxPrice: Math.max(tempZone.topPrice, tempZone.bottomPrice),
                hasSignal: false 
            };
            if (finalZone.maxPrice - finalZone.minPrice > 5) {
                setPoiZones([...poiZones, finalZone]);
            }
            setTempZone(null);
        }
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
        setCrosshair(null);
    };

    return (
        <div 
            className={`relative w-full h-full bg-[#0a0e17] overflow-hidden ${isDrawingMode ? 'cursor-crosshair' : 'cursor-crosshair active:cursor-grabbing'}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
        >
            <svg ref={svgRef} className="w-full h-full" preserveAspectRatio="none">
                
                {/* Сетка на заднем фоне (TradingView style) */}
                <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                    <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Зоны POI */}
                {poiZones.map((zone) => {
                    const isSuccess = zone.hasSignal;
                    const fill = isSuccess ? "rgba(34, 197, 94, 0.25)" : "rgba(59, 130, 246, 0.15)";
                    const stroke = isSuccess ? "rgba(34, 197, 94, 0.9)" : "rgba(59, 130, 246, 0.6)";

                    return (
                        <rect
                            key={zone.id}
                            x={`${((zone.startTime - domainX[0]) / timeRange) * 100}%`}
                            y={`${((maxPrice - zone.maxPrice) / priceRange) * 100}%`}
                            width={`${((zone.endTime - zone.startTime) / timeRange) * 100}%`}
                            height={`${((zone.maxPrice - zone.minPrice) / priceRange) * 100}%`}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth="1.5"
                            strokeDasharray={isSuccess ? "none" : "4"}
                            className={!isDrawingMode && timeframe === '15m' ? 'cursor-pointer hover:fill-blue-500/30 transition-all' : ''}
                            onClick={(e) => {
                                if (!isDrawingMode && timeframe === '15m') {
                                    e.stopPropagation();
                                    onZoneClick(zone, e);
                                }
                            }}
                        />
                    );
                })}

                {/* Временная зона при рисовании */}
                {tempZone && (
                    <rect
                        x={`${((Math.min(tempZone.startTime, tempZone.endTime) - domainX[0]) / timeRange) * 100}%`}
                        y={`${((maxPrice - Math.max(tempZone.topPrice, tempZone.bottomPrice)) / priceRange) * 100}%`}
                        width={`${(Math.abs(tempZone.endTime - tempZone.startTime) / timeRange) * 100}%`}
                        height={`${(Math.abs(tempZone.topPrice - tempZone.bottomPrice) / priceRange) * 100}%`}
                        fill="rgba(234, 179, 8, 0.2)"
                        stroke="rgba(234, 179, 8, 0.8)"
                        strokeWidth="1"
                    />
                )}

                {/* Свечи / Футпринт */}
                {visibleData.map((candle) => {
                    const isGreen = candle.close >= candle.open;
                    const color = isGreen ? '#089981' : '#f23645'; // Цвета TradingView
                    
                    const candleWidthPct = ((timeframe === '15m' ? 15*60*1000 : 5*60*1000) / timeRange) * 100;
                    const xCenterPct = ((candle.timestamp - domainX[0]) / timeRange) * 100 + (candleWidthPct/2);
                    
                    const isZoomedIn = candleWidthPct > 1.5; 
                    
                    if (timeframe === '5m' && isZoomedIn && candle.clusters) {
                        return (
                            <g key={`footprint-${candle.id}`}>
                                <line 
                                    x1={`${xCenterPct}%`} y1={`${((maxPrice - candle.high) / priceRange) * 100}%`} 
                                    x2={`${xCenterPct}%`} y2={`${((maxPrice - candle.low) / priceRange) * 100}%`} 
                                    stroke={color} strokeWidth="1" opacity="0.3"
                                />
                                
                                {candle.clusters.map((cluster, i) => {
                                    const yTop = ((maxPrice - (cluster.price + TICK_SIZE)) / priceRange) * 100;
                                    const yBottom = ((maxPrice - cluster.price) / priceRange) * 100;
                                    const cHeight = Math.abs(yBottom - yTop);
                                    
                                    const isVpoc = cluster.price === candle.vpoc_price;
                                    const bgFill = cluster.delta > 0 ? `rgba(8, 153, 129, ${Math.min(cluster.delta/300, 0.4)})` : 
                                                   cluster.delta < 0 ? `rgba(242, 54, 69, ${Math.min(Math.abs(cluster.delta)/300, 0.4)})` : 
                                                   'transparent';
                                    const profileBarWidthPct = (cluster.vol / candle.max_vol) * 100;

                                    return (
                                        <g key={i}>
                                            <rect 
                                                x={`${xCenterPct - candleWidthPct*0.45}%`} y={`${yTop}%`} 
                                                width={`${candleWidthPct*0.9}%`} height={`${cHeight}%`} 
                                                fill={bgFill}
                                                stroke={isVpoc ? '#ffffff' : 'rgba(255,255,255,0.05)'} strokeWidth={isVpoc ? '1.5' : '0.5'}
                                            />
                                            <rect 
                                                x={`${xCenterPct - candleWidthPct*0.45}%`} y={`${yTop}%`} 
                                                width={`${(candleWidthPct*0.9) * (profileBarWidthPct / 100)}%`} height={`${cHeight}%`} 
                                                fill="rgba(255, 255, 255, 0.3)" 
                                            />
                                            {cHeight > 0.5 && (
                                                <text 
                                                    x={`${xCenterPct}%`} y={`${yTop + cHeight/2}%`} 
                                                    fontSize="10" fontFamily="monospace" textAnchor="middle" dominantBaseline="central"
                                                    style={{ pointerEvents: 'none' }}
                                                >
                                                    <tspan fill={cluster.bid > cluster.ask * 2 ? '#ff6b6b' : '#cbd5e1'} fontWeight={cluster.bid > cluster.ask * 2 ? '900' : 'normal'}>{cluster.bid}</tspan>
                                                    <tspan fill="#475569"> x </tspan>
                                                    <tspan fill={cluster.ask > cluster.bid * 2 ? '#4ade80' : '#cbd5e1'} fontWeight={cluster.ask > cluster.bid * 2 ? '900' : 'normal'}>{cluster.ask}</tspan>
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                        );
                    } else {
                        return (
                            <g key={`candle-${candle.id}`}>
                                <line 
                                    x1={`${xCenterPct}%`} y1={`${((maxPrice - candle.high) / priceRange) * 100}%`} 
                                    x2={`${xCenterPct}%`} y2={`${((maxPrice - candle.low) / priceRange) * 100}%`} 
                                    stroke={color} strokeWidth="2" 
                                />
                                <rect 
                                    x={`${xCenterPct - candleWidthPct*0.35}%`} 
                                    y={`${((maxPrice - Math.max(candle.open, candle.close)) / priceRange) * 100}%`} 
                                    width={`${candleWidthPct*0.7}%`} 
                                    height={`${Math.max(0.5, (Math.abs(candle.open - candle.close) / priceRange) * 100)}%`} 
                                    fill={color} 
                                />
                            </g>
                        );
                    }
                })}

                {/* Сигналы */}
                {signals && signals.map((sig, idx) => {
                    if (sig.time < domainX[0] || sig.time > domainX[1]) return null;
                    const xCenterPct = ((sig.time - domainX[0]) / timeRange) * 100;
                    const yPos = sig.type === 'LONG' ? ((maxPrice - sig.price) / priceRange) * 100 + 5 : ((maxPrice - sig.price) / priceRange) * 100 - 5;
                    return (
                        <g key={`sig-${idx}`}>
                            <circle cx={`${xCenterPct}%`} cy={`${yPos}%`} r={timeframe==='15m'? "4" : "6"} fill={sig.type === 'LONG' ? '#22c55e' : '#ef4444'} className="animate-pulse" />
                            {timeframe === '5m' && (
                                <text x={`${xCenterPct}%`} y={`${sig.type === 'LONG' ? yPos+4 : yPos-2}%`} fontSize="10" fill="white" textAnchor="middle" fontWeight="bold">
                                    {sig.type}
                                </text>
                            )}
                        </g>
                    );
                })}

                {/* Перекрестие (Crosshair) */}
                {crosshair && !isDragging && (
                    <g className="pointer-events-none opacity-50">
                        <line x1="0" y1={`${crosshair.y}%`} x2="100%" y2={`${crosshair.y}%`} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4"/>
                        <line x1={`${crosshair.x}%`} y1="0" x2={`${crosshair.x}%`} y2="100%" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4"/>
                    </g>
                )}
            </svg>
        </div>
    );
};


export default function App() {
    const [data5m, setData5m] = useState([]);
    const [data15m, setData15m] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    
    const [activeView, setActiveView] = useState('15m'); 
    
    const [domainHTF, setDomainHTF] = useState([0, 0]);
    const [domainLTF, setDomainLTF] = useState([0, 0]);

    const [zoneMenu, setZoneMenu] = useState(null);

    const [poiZones, setPoiZones] = useState([]);
    const [isDrawingMode, setIsDrawingMode] = useState(false);
    const [signals, setSignals] = useState([]);
    const [scannerActive, setScannerActive] = useState(false);

    const currentDomain = activeView === '15m' ? domainHTF : domainLTF;
    const setCurrentDomain = activeView === '15m' ? setDomainHTF : setDomainLTF;

    const handleZoomIn = () => {
        if (currentDomain[0] === 0 && currentDomain[1] === 0) return;
        const range = currentDomain[1] - currentDomain[0];
        const center = currentDomain[0] + range / 2;
        const newRange = range * 0.7; 
        if (newRange < 10 * 5 * 60 * 1000) return;
        setCurrentDomain([center - newRange / 2, center + newRange / 2]);
    };

    const handleZoomOut = () => {
        if (currentDomain[0] === 0 && currentDomain[1] === 0) return;
        const range = currentDomain[1] - currentDomain[0];
        const center = currentDomain[0] + range / 2;
        const newRange = range * 1.3; 
        setCurrentDomain([center - newRange / 2, center + newRange / 2]);
    };

    const handlePanLeft = () => {
        if (currentDomain[0] === 0 && currentDomain[1] === 0) return;
        const range = currentDomain[1] - currentDomain[0];
        const shift = range * 0.2; 
        setCurrentDomain([currentDomain[0] - shift, currentDomain[1] - shift]);
    };

    const handlePanRight = () => {
        if (currentDomain[0] === 0 && currentDomain[1] === 0) return;
        const range = currentDomain[1] - currentDomain[0];
        const shift = range * 0.2; 
        setCurrentDomain([currentDomain[0] + shift, currentDomain[1] + shift]);
    };

    // Компонент навигации перенесен внутрь шапки графика
    const ChartNavControls = () => (
        <div className="flex items-center gap-0.5 bg-[#1e222d] p-1 rounded border border-[#2a2e39] shadow-sm pointer-events-auto">
            <button onClick={handlePanLeft} disabled={data15m.length === 0} className="p-1 hover:bg-[#2a2e39] rounded text-slate-400 hover:text-white transition-colors" title="Сдвинуть влево"><ChevronLeft className="w-4 h-4"/></button>
            <button onClick={handlePanRight} disabled={data15m.length === 0} className="p-1 hover:bg-[#2a2e39] rounded text-slate-400 hover:text-white transition-colors" title="Сдвинуть вправо"><ChevronRight className="w-4 h-4"/></button>
            <div className="w-px h-4 bg-[#2a2e39] mx-1"></div>
            <button onClick={handleZoomIn} disabled={data15m.length === 0} className="p-1 hover:bg-[#2a2e39] rounded text-slate-400 hover:text-white transition-colors" title="Приблизить"><ZoomIn className="w-4 h-4"/></button>
            <button onClick={handleZoomOut} disabled={data15m.length === 0} className="p-1 hover:bg-[#2a2e39] rounded text-slate-400 hover:text-white transition-colors" title="Отдалить"><ZoomOut className="w-4 h-4"/></button>
        </div>
    );

    const handleLoadData = () => {
        setIsLoading(true);
        setTimeout(() => {
            const raw5m = generateMockData(300);
            setData5m(raw5m);
            
            const agg15m = [];
            for (let i = 0; i < raw5m.length; i += 3) {
                const chunk = raw5m.slice(i, i + 3);
                if (chunk.length > 0) {
                    agg15m.push({
                        id: i/3,
                        timestamp: chunk[0].timestamp,
                        open: chunk[0].open,
                        high: Math.max(...chunk.map(c => c.high)),
                        low: Math.min(...chunk.map(c => c.low)),
                        close: chunk[chunk.length-1].close,
                    });
                }
            }
            setData15m(agg15m);
            
            const endTime = raw5m[raw5m.length - 1].timestamp;
            const startTime = endTime - (12 * 60 * 60 * 1000); 
            setDomainHTF([startTime, endTime + (30*60*1000)]);
            
            setPoiZones([]);
            setSignals([]);
            setScannerActive(false);
            setActiveView('15m');
            setIsLoading(false);
        }, 800);
    };

    const runScanner = () => {
        if (poiZones.length === 0) return;
        setScannerActive(true);
        const foundSignals = [];
        const updatedZones = [];

        poiZones.forEach(zone => {
            const candlesInZone = data5m.filter(c => c.timestamp >= zone.startTime && c.timestamp <= zone.endTime);
            let hasSignalInZone = false;

            candlesInZone.forEach(candle5m => {
                const inPriceZone = (candle5m.low <= zone.maxPrice && candle5m.high >= zone.minPrice);
                if (inPriceZone) {
                    const signalType = checkSignal(candle5m);
                    if (signalType) {
                        hasSignalInZone = true;
                        foundSignals.push({ time: candle5m.timestamp, type: signalType, price: signalType === 'LONG' ? candle5m.low : candle5m.high });
                    }
                }
            });

            updatedZones.push({ ...zone, hasSignal: hasSignalInZone });
        });

        setPoiZones(updatedZones);
        setSignals(foundSignals);
    };

    const jumpToLTF = (zone) => {
        setZoneMenu(null);
        const padding = 45 * 60 * 1000; 
        setDomainLTF([zone.startTime - padding, zone.endTime + padding]);
        setActiveView('5m');
    };

    return (
        // Макет на весь экран: 100vh и 100vw, без отступов снаружи
        <div className="h-screen w-full bg-[#131722] text-slate-200 font-sans flex flex-col overflow-hidden selection:bg-blue-500/30">
            
            {/* ВЕРХНЯЯ ПАНЕЛЬ (HEADER) */}
            <header className="flex-shrink-0 h-14 bg-[#1e222d] border-b border-[#2a2e39] flex justify-between items-center px-4">
                <div className="flex items-center gap-3">
                    <Maximize2 className="text-blue-500 w-5 h-5" />
                    <h1 className="text-lg font-bold text-white tracking-tight">SMC Terminal <span className="text-xs font-normal text-slate-500 ml-2">v3 Pro Layout</span></h1>
                </div>
                <div className="flex items-center gap-3">
                    {activeView === '5m' && (
                        <button onClick={() => setActiveView('15m')} className="flex items-center gap-2 px-4 py-1.5 bg-[#2a2e39] hover:bg-[#363a45] text-white rounded transition-colors text-sm font-medium">
                            <ArrowLeft className="w-4 h-4" /> Назад к HTF
                        </button>
                    )}
                    <button onClick={handleLoadData} className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors text-sm font-medium">
                        <FileText className="w-4 h-4" /> {isLoading ? 'Загрузка...' : 'Загрузить историю'}
                    </button>
                </div>
            </header>

            {/* ОСНОВНАЯ ОБЛАСТЬ - Только график */}
            <div className="flex-1 flex flex-row min-h-0 overflow-hidden relative bg-[#0a0e17]">
                
                {/* ПЛАВАЮЩЕЕ МЕНЮ ИНСТРУМЕНТОВ (Левый верхний угол) */}
                <div className="absolute top-16 left-4 z-20 flex flex-col gap-1.5 bg-[#1e222d]/95 backdrop-blur-sm border border-[#2a2e39] rounded-lg p-1.5 shadow-2xl">
                    <button 
                        onClick={() => setIsDrawingMode(false)} 
                        title="Навигация (Мышь)"
                        className={`w-10 h-10 flex items-center justify-center rounded-md transition-all ${!isDrawingMode ? 'bg-[#2a2e39] text-blue-400' : 'text-slate-400 hover:text-slate-200 hover:bg-[#2a2e39]/50'}`}
                    >
                        <MousePointer2 className="w-5 h-5" />
                    </button>
                    
                    <button 
                        onClick={() => setIsDrawingMode(true)} 
                        disabled={activeView === '5m'}
                        title={activeView === '5m' ? "Разметка доступна только на 15m" : "Разметка POI"}
                        className={`w-10 h-10 flex items-center justify-center rounded-md transition-all ${isDrawingMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-[#2a2e39]/50'} ${activeView === '5m' ? 'opacity-30 cursor-not-allowed' : ''}`}
                    >
                        <Hand className="w-5 h-5" />
                    </button>
                    
                    <div className="w-6 h-px bg-[#2a2e39] mx-auto my-1"></div>
                    
                    <button 
                        onClick={runScanner} 
                        disabled={poiZones.length === 0}
                        title="Поиск входов в выделенных зонах"
                        className={`w-10 h-10 flex items-center justify-center rounded-md transition-all ${poiZones.length > 0 ? 'bg-[#089981] hover:bg-[#078570] text-white shadow-lg shadow-emerald-900/30' : 'bg-[#2a2e39]/50 text-slate-600 cursor-not-allowed'}`}
                    >
                        <Search className="w-5 h-5" />
                    </button>
                    
                    <button 
                        onClick={() => { setPoiZones([]); setSignals([]); setScannerActive(false); }} 
                        disabled={poiZones.length === 0}
                        title="Очистить всю разметку"
                        className={`w-10 h-10 flex items-center justify-center rounded-md transition-all text-slate-400 hover:text-red-400 hover:bg-red-400/10 ${poiZones.length === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>

                {/* ПЛАВАЮЩИЙ ОТЧЕТ СКАНЕРА (Левый нижний угол) */}
                {scannerActive && (
                    <div className="absolute bottom-6 left-4 z-20 bg-[#1e222d]/95 backdrop-blur-sm border border-[#2a2e39] rounded-lg p-3 shadow-2xl min-w-[180px]">
                        <div className="text-[#089981] font-bold text-xs mb-2 border-b border-[#2a2e39] pb-2 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" /> Отчет сканера
                        </div>
                        <div className="space-y-1.5 text-xs font-medium">
                            <div className="flex justify-between text-slate-400"><span>Зон:</span> <span className="text-white">{poiZones.length}</span></div>
                            <div className="flex justify-between text-slate-400"><span>Успешных:</span> <span className="text-[#089981] font-bold">{poiZones.filter(z=>z.hasSignal).length}</span></div>
                            <div className="flex justify-between text-slate-400"><span>Сигналов:</span> <span className="text-[#089981] font-bold">{signals.length}</span></div>
                        </div>
                    </div>
                )}

                {/* ПРАВАЯ ОБЛАСТЬ - ГРАФИК */}
                <main className="flex-1 flex flex-col relative min-w-0 h-full w-full">
                    
                    {/* Шапка графика (Плавающая панель инструментов) */}
                    <div className="absolute top-0 left-0 w-full h-12 flex items-center justify-between px-4 z-10 bg-gradient-to-b from-[#0a0e17] to-transparent pointer-events-none">
                        <div className="flex items-center gap-3 ml-14"> {/* Отступ из-за меню слева */}
                            <div className="font-mono text-xl font-bold text-slate-200 opacity-80">{activeView === '15m' ? 'BTCUSDT' : 'FOOTPRINT'}</div>
                            <div className="bg-[#1e222d] text-slate-300 px-2 py-0.5 rounded text-sm font-mono border border-[#2a2e39] pointer-events-auto">
                                {activeView}
                            </div>
                            {isDrawingMode && activeView === '15m' && (
                                <div className="bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs px-2 py-1 rounded animate-pulse shadow-lg pointer-events-auto">
                                    Режим рисования
                                </div>
                            )}
                        </div>
                        <ChartNavControls />
                    </div>

                    {/* Меню при клике по зоне */}
                    {zoneMenu && (
                        <div className="absolute z-50 bg-[#1e222d] border border-[#2a2e39] shadow-xl rounded p-2 min-w-[150px]" style={{ left: zoneMenu.x, top: zoneMenu.y }}>
                            <div className="text-[10px] text-slate-400 mb-2 px-1 uppercase font-bold tracking-wider">Зона #{zoneMenu.zone.id.toString().slice(-4)}</div>
                            <button onClick={() => jumpToLTF(zoneMenu.zone)} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors">
                                <ZoomIn className="w-3 h-3" /> Переход на LTF
                            </button>
                        </div>
                    )}

                    {/* Сам График */}
                    <div className="flex-1 relative w-full h-full">
                        {(activeView === '15m' ? data15m : data5m).length > 0 ? (
                            <InteractiveChart 
                                data={activeView === '15m' ? data15m : data5m} 
                                timeframe={activeView} 
                                domainX={currentDomain} 
                                setDomainX={setCurrentDomain}
                                poiZones={poiZones} 
                                setPoiZones={setPoiZones}
                                isDrawingMode={isDrawingMode && activeView === '15m'}
                                signals={signals}
                                onZoneClick={(zone, e) => {
                                    const rect = e.currentTarget.parentElement.getBoundingClientRect();
                                    setZoneMenu({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top + 15, zone: zone });
                                }}
                                onClearMenu={() => setZoneMenu(null)}
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                                Нажмите «Загрузить историю» в правом верхнем углу
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
