// ============================================
// INITIALIZATION
// ============================================
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Чтение параметра запуска (startapp) – сохраняем в глобальную переменную
let pendingSymbol = null;
try {
    if (tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        pendingSymbol = tg.initDataUnsafe.start_param;
        console.log('Start param received:', pendingSymbol);
    }
} catch (e) {
    console.warn('Could not read start_param', e);
}
// Состояние
let chart = null;
let candleSeries = null;
let currentData = [];
let isLoading = false;

// Фиксированные настройки индикатора
const FIXED_SETTINGS = {
    trendLength: 34,
    targetMultiplier: 1,
    atrPeriod: 14
};

// Линии индикатора (только SL, ENTRY, TP1, TP2, TP3)
let priceLines = {
    stopLoss: null,
    entry: null,
    tp1: null,
    tp2: null,
    tp3: null
};

// Состояние индикатора
let indicator = {
    trend: 'neutral',
    atr: 0,
    price: 0,
    entryPrice: 0,
    stopLoss: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    isBullish: false,
    stopLossHit: false,
    signal_up: false,
    signal_down: false,
    lastSymbol: '',
    lastTimeframe: '',
    sma_high: 0,
    sma_low: 0,
    hasInitialSignal: false
};
// ============================================
// ЗАГРУЗКА СПИСКА СИМВОЛОВ ИЗ CSV
// ============================================

async function loadSymbolsFromCSV() {
    try {
        const response = await fetch('tickers.csv');
        if (!response.ok) throw new Error('Failed to load tickers.csv');
        const csvText = await response.text();
        
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const headers = lines[0].split(',');
        const binanceColIndex = headers.findIndex(h => h.trim() === 'binance_symbol');
        if (binanceColIndex === -1) throw new Error('Column binance_symbol not found');

        const symbols = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length > binanceColIndex) {
                let sym = cols[binanceColIndex].trim().replace(/^'|'$/g, '');
                if (sym) symbols.push(sym);
            }
        }

        const uniqueSymbols = [...new Set(symbols)].sort();
        return uniqueSymbols;
    } catch (error) {
        console.error('Error loading symbols from CSV:', error);
        // Запасной список
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function initSymbols() {
    const symbolSelect = document.getElementById('symbol');
    if (!symbolSelect) {
        console.error('Symbol select element not found');
        return;
    }
    symbolSelect.innerHTML = '';

    const symbols = await loadSymbolsFromCSV();
    symbols.forEach(sym => {
        const option = document.createElement('option');
        option.value = sym;
        option.textContent = sym.replace('USDT', '/USDT');
        symbolSelect.appendChild(option);
    });

    // Выбираем символ: сначала из параметра, иначе первый в списке
    let selectedSymbol = null;
    if (pendingSymbol) {
        const optionExists = Array.from(symbolSelect.options).some(opt => opt.value === pendingSymbol);
        if (optionExists) {
            selectedSymbol = pendingSymbol;
            console.log(`Selected symbol from start param: ${pendingSymbol}`);
        } else {
            console.warn(`Symbol ${pendingSymbol} not found in list, using default`);
        }
        pendingSymbol = null;
    }
    if (!selectedSymbol && symbolSelect.options.length > 0) {
        selectedSymbol = symbolSelect.options[0].value;
    }
    if (selectedSymbol) {
        symbolSelect.value = selectedSymbol;
    }

loadData();
}
// ============================================
// ПОИСК ПО СИМВОЛАМ
// ============================================

function setupSymbolSearch() {
    const searchInput = document.getElementById('symbolSearch');
    const symbolSelect = document.getElementById('symbol');
    if (!searchInput || !symbolSelect) {
        console.error('Search input or symbol select not found');
        return;
    }
    searchInput.addEventListener('input', function(e) {
        const filter = e.target.value.toLowerCase();
        const options = symbolSelect.options;
        for (let i = 0; i < options.length; i++) {
            const text = options[i].textContent.toLowerCase();
            options[i].style.display = text.includes(filter) ? '' : 'none';
        }
    });
}

// ============================================
// ГРАФИК
// ============================================

function initChart() {
    console.log('Initializing chart...');
    const chartContainer = document.getElementById('chart');
    if (!chartContainer) {
        console.error('Chart container not found');
        return;
    }
    chartContainer.innerHTML = '';
    
    chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: { background: { color: '#000000' }, textColor: '#DDDDDD' },
        grid: { vertLines: { color: '#222222' }, horzLines: { color: '#222222' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#333333', scaleMargins: { top: 0.05, bottom: 0.05 } },
        timeScale: { borderColor: '#333333', timeVisible: true, secondsVisible: false },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });
    
    candleSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 }
    });
    
    resetPriceLines();
    
    window.addEventListener('resize', () => {
        if (chart && chartContainer) {
            chart.applyOptions({
                width: chartContainer.clientWidth,
                height: chartContainer.clientHeight,
            });
        }
    });
}

// ============================================
// ИНДИКАТОР
// ============================================
function getConditionsForIndex(data, idx) {
    if (idx < 34) return { bullish: false, bearish: false }; // недостаточно данных

    const slice = data.slice(0, idx + 1); // данные до idx включительно
    const length = FIXED_SETTINGS.trendLength;
    const atrPeriod = FIXED_SETTINGS.atrPeriod;

    // Расчёт ATR для среза
    let atrSum = 0;
    for (let i = 1; i < Math.min(slice.length, atrPeriod + 1); i++) {
        const tr = Math.max(
            slice[i].high - slice[i].low,
            Math.abs(slice[i].high - slice[i - 1].close),
            Math.abs(slice[i].low - slice[i - 1].close)
        );
        atrSum += tr;
    }
    const atr = (atrSum / Math.min(atrPeriod, slice.length - 1)) * 0.3;

    // SMA для high и low
    let sumHigh = 0, sumLow = 0;
    const startIdx = Math.max(0, slice.length - length);
    for (let i = startIdx; i < slice.length; i++) {
        sumHigh += slice[i].high;
        sumLow += slice[i].low;
    }
    const count = slice.length - startIdx;
    const smaHigh = sumHigh / count + atr;
    const smaLow = sumLow / count - atr;

    const close = slice[idx].close;

    return {
        bullish: close > smaHigh,
        bearish: close < smaLow
    };
}
// ============================================
function calculatePineIndicator(forceRecalculate = false) {
    if (currentData.length < 35) {
        console.log('Not enough data for indicator calculation');
        return;
    }

    const lastIdx = currentData.length - 1;
    const prevIdx = lastIdx - 1;
    const symbol = document.getElementById('symbol').value; // для логов

    // Текущие условия на последней свече
    const curr = getConditionsForIndex(currentData, lastIdx);
    // Условия на предыдущей свече
    const prev = getConditionsForIndex(currentData, prevIdx);

    const newBullishSignal = curr.bullish && !prev.bullish;
    const newBearishSignal = curr.bearish && !prev.bearish;

    // Если новый сигнал или принудительный пересчёт (смена символа/таймфрейма)
    if (newBullishSignal || newBearishSignal || forceRecalculate || indicator.entryPrice === 0) {
        console.log('New signal detected:', newBullishSignal ? 'BULLISH' : 'BEARISH');

        // Определяем направление
        const isBullish = newBullishSignal || (newBearishSignal ? false : indicator.isBullish);
        const close = currentData[lastIdx].close;

        // Пересчитываем ATR и SMA для последней свечи
        const lastSlice = currentData.slice(0, lastIdx + 1);
        if (lastSlice.length < FIXED_SETTINGS.atrPeriod + 1) {
            console.warn('Not enough data for ATR calculation');
            return;
        }

        // ATR
        let atrSum = 0;
        const atrPeriod = FIXED_SETTINGS.atrPeriod;
        for (let i = 1; i < Math.min(lastSlice.length, atrPeriod + 1); i++) {
            const tr = Math.max(
                lastSlice[i].high - lastSlice[i].low,
                Math.abs(lastSlice[i].high - lastSlice[i - 1].close),
                Math.abs(lastSlice[i].low - lastSlice[i - 1].close)
            );
            atrSum += tr;
        }
        const atr = (atrSum / Math.min(atrPeriod, lastSlice.length - 1)) * 0.3;

        // Отладочные логи
        console.log(`[DEBUG] ${symbol} ATR calc: atrSum=${atrSum}, divisor=${Math.min(atrPeriod, lastSlice.length - 1)}, atr=${atr}`);
        console.log(`[DEBUG] first 3 closes:`, currentData.slice(0,3).map(d => d.close));

        // SMA
        const length = FIXED_SETTINGS.trendLength;
        let sumHigh = 0, sumLow = 0;
        const startIdx = Math.max(0, lastSlice.length - length);
        for (let i = startIdx; i < lastSlice.length; i++) {
            sumHigh += lastSlice[i].high;
            sumLow += lastSlice[i].low;
        }
        const count = lastSlice.length - startIdx;
        const smaHigh = sumHigh / count + atr;
        const smaLow = sumLow / count - atr;

        // Расчёт уровней
        indicator.entryPrice = close;
        if (isBullish) {
            indicator.stopLoss = smaLow;
            indicator.tp1 = close + atr * 5;
            indicator.tp2 = close + atr * 10;
            indicator.tp3 = close + atr * 15;
        } else {
            indicator.stopLoss = smaHigh;
            indicator.tp1 = close - atr * 5;
            indicator.tp2 = close - atr * 10;
            indicator.tp3 = close - atr * 15;
        }

        indicator.isBullish = isBullish;
        indicator.trend = isBullish ? 'up' : 'down';
        indicator.hasInitialSignal = true;
        indicator.atr = atr; // ← сохраняем для отображения
    }

    // Обновляем последние значения для отображения
    indicator.price = currentData[lastIdx].close;
}
// ============================================
// ОТРИСОВКА ЛИНИЙ
// ============================================

function drawIndicatorLines() {
    if (!chart || !candleSeries) return;
    
    resetPriceLines();
    
    if (indicator.entryPrice === 0 || isNaN(indicator.entryPrice)) return;
    
    const color = indicator.stopLossHit ? '#ff0000' : null;
    
    try {
        priceLines.stopLoss = candleSeries.createPriceLine({
            price: indicator.stopLoss,
            color: color || '#ff0000',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'SL'
        });
        
        priceLines.entry = candleSeries.createPriceLine({
            price: indicator.entryPrice,
            color: color || '#0066cc',
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: 'ENTRY'
        });
        
        priceLines.tp1 = candleSeries.createPriceLine({
            price: indicator.tp1,
            color: color || '#00ff00',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP1'
        });
        
        priceLines.tp2 = candleSeries.createPriceLine({
            price: indicator.tp2,
            color: color || '#00ff00',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP2'
        });
        
        priceLines.tp3 = candleSeries.createPriceLine({
            price: indicator.tp3,
            color: color || '#00ff00',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP3'
        });
        
    } catch (error) {
        console.error('Error drawing lines:', error);
    }
}

function resetPriceLines() {
    if (!candleSeries) return;
    Object.values(priceLines).forEach(line => {
        if (line) {
            try { candleSeries.removePriceLine(line); } catch (e) {}
        }
    });
    priceLines = { stopLoss: null, entry: null, tp1: null, tp2: null, tp3: null };
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================
let lastLoadedSymbol = '';
let lastLoadedTimeframe = '';

async function loadData() {
    if (isLoading) return;
    console.trace('loadData called');
    const symbolSelect = document.getElementById('symbol');
    const timeframeSelect = document.getElementById('timeframe');

    if (!symbolSelect || symbolSelect.options.length === 0) {
        console.log('Symbol select not ready, retrying...');
        setTimeout(loadData, 200);
        return;
    }

    let symbol = symbolSelect.value;
    if (!symbol) {
        if (symbolSelect.options.length > 0) {
            symbol = symbolSelect.options[0].value;
            symbolSelect.value = symbol;
        } else {
            console.error('No symbols available');
            return;
        }
    }

    const timeframe = timeframeSelect.value;

    // Если уже загружали этот же символ и таймфрейм, не грузим повторно
    if (symbol === lastLoadedSymbol && timeframe === lastLoadedTimeframe && currentData.length > 0) {
        console.log('Already loaded, skipping');
        return;
    }

    console.log(`Loading ${symbol} ${timeframe}...`);

    try {
        isLoading = true;
        showLoading();

        const data = await getChartData(symbol, timeframe);
        if (!data || data.length === 0) throw new Error('No data');

        currentData = formatData(data);
        if (currentData.length < 30) throw new Error('Not enough data');

        if (!chart) initChart();

        candleSeries.setData(currentData);
        calculatePineIndicator();
        drawIndicatorLines();
        updateUI();
        autoZoomToLatest();

        // Запоминаем успешно загруженный символ
        lastLoadedSymbol = symbol;
        lastLoadedTimeframe = timeframe;

    } catch (error) {
        console.error('Error loading data:', error);
        loadTestData();
        // При тестовых данных тоже запоминаем, чтобы не перезагружать
        lastLoadedSymbol = symbol;
        lastLoadedTimeframe = timeframe;
    } finally {
        isLoading = false;
        hideLoading();
    }
}
async function getChartData(symbol, interval) {
    try {
        let limit = 100;
        if (interval === '1m' || interval === '5m') limit = 150;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API error:', error);
        return null;
    }
}

function formatData(rawData) {
    return rawData.map(item => ({
        time: item[0] / 1000,
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5])
    })).filter(item => !isNaN(item.open));
}

function autoZoomToLatest() {
    if (!chart || currentData.length < 10) return;
    try {
        const visibleBars = 50;
        const lastBarIndex = currentData.length - 1;
        const firstVisibleIndex = Math.max(0, lastBarIndex - visibleBars);
        chart.timeScale().setVisibleRange({
            from: currentData[firstVisibleIndex].time,
            to: currentData[lastBarIndex].time
        });
    } catch (error) {
        setTimeout(() => chart.timeScale().fitContent(), 100);
    }
}

// ============================================
// ОБНОВЛЕНИЕ UI
// ============================================

function updateUI() {
    const formatPrice = (price) => {
        if (!price || isNaN(price)) return '0.0000';
        if (price >= 1000) return price.toFixed(2);
        if (price >= 100) return price.toFixed(2);
        if (price >= 10) return price.toFixed(3);
        if (price >= 1) return price.toFixed(4);
        if (price >= 0.1) return price.toFixed(5);
        if (price >= 0.01) return price.toFixed(6);
        if (price >= 0.001) return price.toFixed(6);
        return price.toFixed(8);
    };
    
    const trendElement = document.getElementById('trendValue');
    if (trendElement) {
        if (indicator.stopLossHit) {
            trendElement.textContent = 'STOP HIT';
            trendElement.style.color = '#ff0000';
        } else {
            trendElement.textContent = indicator.trend.toUpperCase();
            trendElement.style.color = indicator.trend === 'up' ? '#00ff00' : '#ff0000';
        }
    }
    
    const priceEl = document.getElementById('priceValue');
    if (priceEl) priceEl.textContent = formatPrice(indicator.price);
    
    const atrEl = document.getElementById('atrValue');
    if (atrEl) atrEl.textContent = formatPrice(indicator.atr);
    
    const entryEl = document.getElementById('entryValue');
    if (entryEl) entryEl.textContent = formatPrice(indicator.entryPrice);
    
    const container = document.getElementById('targetsContainer');
    if (!container) return;
    container.innerHTML = '';
    
    const targets = [
        { name: 'STOP LOSS', value: indicator.stopLoss, type: 'stop' },
        { name: 'ENTRY', value: indicator.entryPrice, type: 'entry' },
        { name: 'TP1', value: indicator.tp1, type: 'profit' },
        { name: 'TP2', value: indicator.tp2, type: 'profit' },
        { name: 'TP3', value: indicator.tp3, type: 'profit' }
    ];
    
    targets.forEach(target => {
        if (!target.value || isNaN(target.value)) return;
        const div = document.createElement('div');
        div.className = `target ${target.type}`;
        let borderColor = '#333';
        let textColor = '#fff';
        if (!indicator.stopLossHit) {
            if (target.type === 'stop') { borderColor = '#ff0000'; textColor = '#ff0000'; }
            else if (target.type === 'entry') { borderColor = '#0066cc'; textColor = '#0066cc'; }
            else if (target.type === 'profit') { borderColor = '#00ff00'; textColor = '#00ff00'; }
        } else {
            borderColor = '#ff0000';
            textColor = '#ff0000';
        }
        div.style.borderLeftColor = borderColor;
        div.innerHTML = `<div class="target-name">${target.name}</div>
                         <div class="target-value" style="color: ${textColor}">${formatPrice(target.value)}</div>`;
        container.appendChild(div);
    });
}

// ============================================
// ТЕСТОВЫЕ ДАННЫЕ
// ============================================

function loadTestData() {
    console.log('Loading test data...');
    const symbol = document.getElementById('symbol').value;
    const timeframe = document.getElementById('timeframe').value;
    
    if (!chart) initChart();
    
    const data = generateTestData(symbol, timeframe);
    currentData = formatData(data);
    candleSeries.setData(currentData);
    
    // Сброс индикатора
    indicator = {
        trend: 'neutral',
        atr: 0,
        price: 0,
        entryPrice: 0,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        isBullish: false,
        stopLossHit: false,
        signal_up: false,
        signal_down: false,
        lastSymbol: symbol,
        lastTimeframe: timeframe,
        sma_high: 0,
        sma_low: 0,
        hasInitialSignal: false
    };
    
    calculatePineIndicator(true);
    drawIndicatorLines();
    updateUI();
    autoZoomToLatest();
}
function generateTestData(symbol, timeframe) {
    const data = [];
    let basePrice = getTestPrice(symbol);
    let price = basePrice;
    let trend = Math.random() > 0.5;
    
    let bars = 100;
    if (timeframe === '1m' || timeframe === '5m') bars = 150;
    
    for (let i = 0; i < bars; i++) {
        const timeOffset = (bars - 1 - i) * getIntervalMs(timeframe);
        const time = Date.now() - timeOffset;
        
        const volatility = basePrice * 0.01;
        const randomMove = (Math.random() - 0.5) * 2 * volatility;
        
        const open = price;
        const close = open + randomMove;
        const high = Math.max(open, close) + Math.random() * volatility * 0.5;
        const low = Math.min(open, close) - Math.random() * volatility * 0.5;
        
        data.push([
            time,
            open.toFixed(8),
            high.toFixed(8),
            low.toFixed(8),
            close.toFixed(8),
            (Math.random() * 1000).toFixed(2)
        ]);
        
        price = close;
    }
    return data;
}

function getTestPrice(symbol) {
    const prices = {
        'BTCUSDT': 65000,
        'ETHUSDT': 3500,
        'BNBUSDT': 600,
        'SOLUSDT': 150,
        'XRPUSDT': 0.6,
        'ADAUSDT': 0.45,
        'DOGEUSDT': 0.14926,
        'SHIBUSDT': 0.000025
    };
    return prices[symbol] || 100;
}

function getIntervalMs(timeframe) {
    const intervals = {
        '1m': 60000,
        '5m': 300000,
        '15m': 900000,
        '30m': 1800000,
        '1h': 3600000,
        '4h': 14400000
    };
    return intervals[timeframe] || 60000;
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function showLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.remove('hidden');
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function resetAll() {
    console.log('Resetting indicator...');
    const symbol = document.getElementById('symbol').value;
    const timeframe = document.getElementById('timeframe').value;
    
    indicator = {
        trend: 'neutral',
        atr: 0,
        price: 0,
        entryPrice: 0,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        isBullish: false,
        stopLossHit: false,
        signal_up: false,
        signal_down: false,
        lastSymbol: symbol,
        lastTimeframe: timeframe,
        sma_high: 0,
        sma_low: 0,
        hasInitialSignal: false
    };
    
    resetPriceLines();
    if (currentData.length > 0) {
        calculatePineIndicator(true);
        drawIndicatorLines();
        updateUI();
    }
    alert('Индикатор сброшен!');
}

function shareSignal() {
    const signal = `
ANOMAL SIGNAL
════════════════════════
Symbol: ${document.getElementById('symbol').value}
Timeframe: ${document.getElementById('timeframe').value}
Trend: ${indicator.trend.toUpperCase()} ${indicator.stopLossHit ? '(STOP HIT)' : ''}
Price: ${document.getElementById('priceValue').textContent}
Entry: ${document.getElementById('entryValue').textContent}
Stop Loss: ${indicator.stopLoss.toFixed(4)}
TP1: ${indicator.tp1.toFixed(4)}
TP2: ${indicator.tp2.toFixed(4)}
TP3: ${indicator.tp3.toFixed(4)}
════════════════════════
Time: ${new Date().toLocaleString()}
    `;
    tg.sendData(JSON.stringify({ signal }));
    tg.showAlert('Signal shared!');
}

// ============================================
// ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================

function setupEventListeners() {
    const updateBtn = document.getElementById('updateBtn');
    if (updateBtn) updateBtn.addEventListener('click', loadData);
    else console.error('updateBtn not found');

    const symbolSelect = document.getElementById('symbol');
    if (symbolSelect) symbolSelect.addEventListener('change', loadData);
    else console.error('symbol select not found');

    const timeframeSelect = document.getElementById('timeframe');
    if (timeframeSelect) timeframeSelect.addEventListener('change', loadData);
    else console.error('timeframe select not found');

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetAll);
    else console.error('resetBtn not found');

    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) shareBtn.addEventListener('click', shareSignal);
    else console.error('shareBtn not found');

    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
    else console.error('fullscreenBtn not found');

    setupSymbolSearch();
}

// ============================================
// ЗАПУСК ПРИЛОЖЕНИЯ
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('App starting...');
    try {
        await initSymbols();          // ждём загрузки символов
        setupEventListeners();
        initChart();
        setInterval(() => {
            if (!document.hidden && !isLoading) loadData();
        }, 3600000);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) setTimeout(() => loadData(), 1000);
        });

    } catch (error) {
        console.error('Fatal error during initialization:', error);
        alert(`Ошибка инициализации: ${error.message}`);
    }
});
