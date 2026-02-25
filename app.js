// ============================================
// INITIALIZATION
// ============================================

// Telegram WebApp
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// State variables
let chart = null;
let candleSeries = null;
let currentData = [];
let isLoading = false;

// Линии индикатора
let priceLines = {
    stopLoss: null,
    entry: null,
    tp1: null,
    tp2: null,
    tp3: null,
    tp4: null
};

// TradingView Pine Script логика
let indicator = {
    trend: 'neutral',
    atr: 0,
    price: 0,
    entryPrice: 0,
    stopLoss: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    tp4: 0,
    isBullish: false,
    stopLossHit: false,
    signal_up: false,
    signal_down: false,
    lastSymbol: '',
    lastTimeframe: '',
    sma_high: 0,
    sma_low: 0,
    hasInitialSignal: false,
    // Сохраняем последние настройки для сравнения
    lastSettings: {
        trendLength: 34,
        targetMultiplier: 0,
        atrPeriod: 20
    }
};

// Top 50 Binance Futures монет
const BINANCE_TOP_50 = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'TRXUSDT', 'UNIUSDT', 'TONUSDT', 'ICPUSDT',
    'SHIBUSDT', 'APTUSDT', 'LTCUSDT', 'BCHUSDT', 'ATOMUSDT',
    'ETCUSDT', 'FILUSDT', 'NEARUSDT', 'ALGOUSDT', 'XLMUSDT',
    'OPUSDT', 'VETUSDT', 'ARBUSDT', 'AAVEUSDT', 'GRTUSDT',
    'EOSUSDT', 'QNTUSDT', 'STXUSDT', 'XTZUSDT', 'SANDUSDT',
    'AXSUSDT', 'THETAUSDT', 'FTMUSDT', 'EGLDUSDT', 'MANAUSDT',
    'IMXUSDT', 'GALAUSDT', 'CRVUSDT', 'KAVAUSDT', 'RUNEUSDT',
    '1INCHUSDT', 'COMPUSDT', 'ZILUSDT', 'IOTAUSDT', 'ENJUSDT'
];

// ============================================
// CHART INITIALIZATION
// ============================================

function initChart() {
    console.log('Initializing chart...');
    
    const chartContainer = document.getElementById('chart');
    chartContainer.innerHTML = '';
    
    chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: { 
            background: { color: '#000000' }, 
            textColor: '#DDDDDD',
            fontFamily: 'Monaco, "Courier New", monospace'
        },
        grid: { 
            vertLines: { color: '#222222', visible: true }, 
            horzLines: { color: '#222222', visible: true } 
        },
        crosshair: { 
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                width: 1,
                color: '#333333',
                style: 2
            },
            horzLine: {
                width: 1,
                color: '#333333',
                style: 2
            }
        },
        rightPriceScale: {
            borderColor: '#333333',
            scaleMargins: {
                top: 0.05,
                bottom: 0.05
            },
            minimumWidth: 80,
            autoScale: true
        },
        timeScale: {
            borderColor: '#333333',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5,
            barSpacing: 6,
            minBarSpacing: 3,
            fixLeftEdge: true,
            fixRightEdge: false,
            borderVisible: false
        },
        handleScroll: { 
            mouseWheel: true, 
            pressedMouseMove: true, 
            horzTouchDrag: true, 
            vertTouchDrag: true 
        },
        handleScale: { 
            axisPressedMouseMove: true, 
            mouseWheel: true, 
            pinch: true 
        },
    });
    
    // Свечной график
    candleSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: {
            type: 'price',
            precision: 4,
            minMove: 0.0001
        }
    });
    
    // Сбрасываем линии индикатора
    resetPriceLines();
    
    window.addEventListener('resize', () => {
        if (chart) {
            chart.applyOptions({
                width: chartContainer.clientWidth,
                height: chartContainer.clientHeight,
            });
        }
    });
    
    console.log('Chart initialized successfully');
    return true;
}

// ============================================
// TOP 50 MONETS INIT
// ============================================

function initSymbols() {
    const symbolSelect = document.getElementById('symbol');
    symbolSelect.innerHTML = '';
    
    BINANCE_TOP_50.forEach(symbol => {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol.replace('USDT', '/USDT');
        symbolSelect.appendChild(option);
    });
}

// ============================================
// PINE SCRIPT LOGIC (С РЕАКЦИЕЙ НА НАСТРОЙКИ)
// ============================================

function calculatePineIndicator(forceRecalculate = false) {
    if (currentData.length < 30) {
        console.log('Not enough data for indicator calculation');
        return;
    }
    
    const length = parseInt(document.getElementById('trendLength').value) || 10;
    const target = parseInt(document.getElementById('targetMultiplier').value) || 0;
    const atrPeriod = parseInt(document.getElementById('atrPeriod').value) || 20;
    
    // Проверяем, изменились ли настройки
    const settingsChanged = 
        length !== indicator.lastSettings.trendLength ||
        target !== indicator.lastSettings.targetMultiplier ||
        atrPeriod !== indicator.lastSettings.atrPeriod;
    
    console.log('Calculating indicator with:', { 
        length, 
        target, 
        atrPeriod,
        settingsChanged,
        forceRecalculate
    });
    
    // Calculate ATR
    let atrSum = 0;
    
    for (let i = 1; i < Math.min(currentData.length, atrPeriod + 1); i++) {
        const high = currentData[i].high;
        const low = currentData[i].low;
        const prevClose = currentData[i-1].close;
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        
        atrSum += tr;
    }
    
    const atr_value = (atrSum / Math.min(atrPeriod, currentData.length - 1)) * 0.3;
    
    // Calculate SMA
    let smaHighSum = 0;
    let smaLowSum = 0;
    
    const startIdx = Math.max(0, currentData.length - length);
    for (let i = startIdx; i < currentData.length; i++) {
        smaHighSum += currentData[i].high;
        smaLowSum += currentData[i].low;
    }
    
    const smaCount = currentData.length - startIdx;
    const sma_high = (smaHighSum / smaCount) + atr_value;
    const sma_low = (smaLowSum / smaCount) - atr_value;
    
    const close = currentData[currentData.length - 1].close;
    const prevClose = currentData.length > 1 ? currentData[currentData.length - 2].close : close;
    
    console.log('Calculated:', { sma_high, sma_low, close, prevClose, atr_value });
    
    // Проверяем смену символа или таймфрейма
    const currentSymbol = document.getElementById('symbol').value;
    const currentTimeframe = document.getElementById('timeframe').value;
    const symbolChanged = indicator.lastSymbol !== currentSymbol;
    const timeframeChanged = indicator.lastTimeframe !== currentTimeframe;
    
    if (symbolChanged || timeframeChanged || forceRecalculate) {
        console.log('Symbol/timeframe changed or force recalculate, resetting indicator');
        // Полный сброс при смене
        indicator = {
            trend: 'neutral',
            atr: 0,
            price: 0,
            entryPrice: 0,
            stopLoss: 0,
            tp1: 0,
            tp2: 0,
            tp3: 0,
            tp4: 0,
            isBullish: false,
            stopLossHit: false,
            signal_up: false,
            signal_down: false,
            lastSymbol: currentSymbol,
            lastTimeframe: currentTimeframe,
            sma_high: 0,
            sma_low: 0,
            hasInitialSignal: false,
            lastSettings: {
                trendLength: length,
                targetMultiplier: target,
                atrPeriod: atrPeriod
            }
        };
        
        // Сбрасываем линии
        resetPriceLines();
    }
    
    // Сохраняем текущие SMA
    indicator.sma_high = sma_high;
    indicator.sma_low = sma_low;
    
    let trend = indicator.isBullish;
    let signal_up = false;
    let signal_down = false;
    let trendChanged = false;
    
    // ПРОСТАЯ И НАДЕЖНАЯ ЛОГИКА СИГНАЛОВ
    // Если цена выше SMA HIGH - бычий тренд
    // Если цена ниже SMA LOW - медвежий тренд
    
    if (close > sma_high) {
        if (!indicator.hasInitialSignal || !trend || settingsChanged) {
            trend = true;
            signal_up = true;
            trendChanged = true;
            console.log('UP trend signal');
        }
    } else if (close < sma_low) {
        if (!indicator.hasInitialSignal || trend || settingsChanged) {
            trend = false;
            signal_down = true;
            trendChanged = true;
            console.log('DOWN trend signal');
        }
    }
    
    // Пересчитываем цели при:
    // 1. Смене тренда
    // 2. Если целей еще нет
    // 3. Если изменились настройки (важно!)
    if (trendChanged || indicator.entryPrice === 0 || settingsChanged) {
        console.log('Calculating new targets (reason:', {
            trendChanged,
            noEntry: indicator.entryPrice === 0,
            settingsChanged
        }, ')');
        
        const base = trend ? sma_low : sma_high;
        const atr_multiplier = atr_value * (trend ? 1 : -1);
        
        indicator.entryPrice = close;
        indicator.stopLoss = base;
        indicator.tp1 = close + atr_multiplier * (5 + target);
        indicator.tp2 = close + atr_multiplier * (10 + target * 2);
        indicator.tp3 = close + atr_multiplier * (15 + target * 4);
        indicator.tp4 = close + atr_multiplier * (20 + target * 6);
        indicator.hasInitialSignal = true;
        
        console.log('New targets calculated:', {
            entry: indicator.entryPrice,
            stop: indicator.stopLoss,
            tp1: indicator.tp1,
            tp2: indicator.tp2
        });
    }
    
    // Проверка стоп лосса
    if (!indicator.stopLossHit && indicator.stopLoss !== 0) {
        if ((trend && close <= indicator.stopLoss) || 
            (!trend && close >= indicator.stopLoss)) {
            indicator.stopLossHit = true;
            console.log('STOP LOSS HIT!');
        }
    }
    
    // Обновляем индикатор
    indicator.trend = trend ? 'up' : 'down';
    indicator.atr = atr_value;
    indicator.price = close;
    indicator.isBullish = trend;
    indicator.signal_up = signal_up;
    indicator.signal_down = signal_down;
    
    // Сохраняем последние настройки
    indicator.lastSymbol = currentSymbol;
    indicator.lastTimeframe = currentTimeframe;
    indicator.lastSettings = {
        trendLength: length,
        targetMultiplier: target,
        atrPeriod: atrPeriod
    };
}

// ============================================
// DRAW INDICATOR LINES
// ============================================

function drawIndicatorLines() {
    if (!chart || !candleSeries) {
        console.log('Chart or candle series not available');
        return;
    }
    
    console.log('Drawing indicator lines...');
    
    // Удаляем старые линии
    resetPriceLines();
    
    if (indicator.entryPrice === 0 || isNaN(indicator.entryPrice)) {
        console.log('No entry price available, skipping line drawing');
        return;
    }
    
    const color = indicator.stopLossHit ? '#ff0000' : null;
    
    try {
        // STOP LOSS
        priceLines.stopLoss = candleSeries.createPriceLine({
            price: indicator.stopLoss,
            color: color || '#ff0000',
            lineWidth: 2,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'SL'
        });
        
        // ENTRY
        priceLines.entry = candleSeries.createPriceLine({
            price: indicator.entryPrice,
            color: color || '#0066cc',
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: 'ENTRY'
        });
        
        // TAKE PROFITS
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
        
        priceLines.tp4 = candleSeries.createPriceLine({
            price: indicator.tp4,
            color: color || '#00ff00',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP4'
        });
        
        console.log('Lines drawn successfully');
        
    } catch (error) {
        console.error('Error drawing lines:', error);
    }
}

function resetPriceLines() {
    if (!candleSeries) return;
    
    Object.values(priceLines).forEach(line => {
        if (line) {
            try {
                candleSeries.removePriceLine(line);
            } catch (e) {
                console.log('Error removing price line:', e);
            }
        }
    });
    
    priceLines = {
        stopLoss: null,
        entry: null,
        tp1: null,
        tp2: null,
        tp3: null,
        tp4: null
    };
}

// ============================================
// DATA LOADING
// ============================================

async function loadData() {
    if (isLoading) {
        console.log('Already loading, skipping');
        return;
    }
    
    try {
        isLoading = true;
        showLoading();
        
        const symbol = document.getElementById('symbol').value;
        const timeframe = document.getElementById('timeframe').value;
        
        console.log(`Loading ${symbol} ${timeframe}...`);
        
        // Загружаем данные
        const data = await getChartData(symbol, timeframe);
        
        if (!data || data.length === 0) {
            throw new Error('No data received from API');
        }
        
        currentData = formatData(data);
        
        // Проверяем данные
        if (currentData.length < 30) {
            throw new Error(`Not enough data: ${currentData.length} bars`);
        }
        
        // Инициализируем график если нужно
        if (!chart) {
            initChart();
        }
        
        // Обновляем данные на графике
        candleSeries.setData(currentData);
        
        // Рассчитываем индикаторы
        calculatePineIndicator();
        
        // Рисуем линии
        drawIndicatorLines();
        
        // Обновляем UI
        updateUI();
        
        // Центрируем график
        autoZoomToLatest();
        
        console.log('Data loaded successfully');
        
    } catch (error) {
        console.error('Error loading data:', error);
        loadTestData();
    } finally {
        isLoading = false;
        hideLoading();
    }
}

async function getChartData(symbol, interval) {
    try {
        // Определяем лимит в зависимости от таймфрейма
        let limit = 100;
        if (interval === '1m' || interval === '5m') limit = 150;
        if (interval === '15m' || interval === '30m') limit = 100;
        if (interval === '1h' || interval === '4h') limit = 100;
        
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        console.log(`Fetching from: ${url}`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data || data.length === 0) {
            throw new Error('Empty response from API');
        }
        
        console.log(`Received ${data.length} bars`);
        return data;
        
    } catch (error) {
        console.error('API error:', error);
        return null;
    }
}

function formatData(rawData) {
    return rawData.map(item => {
        // Проверяем данные
        const time = item[0] / 1000;
        const open = parseFloat(item[1]);
        const high = parseFloat(item[2]);
        const low = parseFloat(item[3]);
        const close = parseFloat(item[4]);
        const volume = parseFloat(item[5]);
        
        // Проверяем на корректность
        if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
            console.warn('Invalid data point:', item);
            return null;
        }
        
        return {
            time,
            open,
            high,
            low,
            close,
            volume
        };
    }).filter(item => item !== null); // Убираем некорректные данные
}

function autoZoomToLatest() {
    if (!chart || currentData.length < 10) return;
    
    try {
        const visibleBars = 50;
        const lastBarIndex = currentData.length - 1;
        const firstVisibleIndex = Math.max(0, lastBarIndex - visibleBars);
        
        const firstTime = currentData[firstVisibleIndex].time;
        const lastTime = currentData[lastBarIndex].time;
        
        chart.timeScale().setVisibleRange({
            from: firstTime,
            to: lastTime
        });
        
    } catch (error) {
        console.warn('Auto zoom error:', error);
        // Пробуем просто подогнать
        setTimeout(() => {
            chart.timeScale().fitContent();
        }, 100);
    }
}

// ============================================
// UI UPDATES
// ============================================

function updateUI() {
    // Форматируем цены до 4 знаков после запятой
    const formatPrice = (price) => {
        if (!price || isNaN(price)) return '0.0000';
        
        // Всегда показываем минимум 2, максимум 4 знака после запятой
        if (price >= 1000) return price.toFixed(2);
        if (price >= 100) return price.toFixed(2);
        if (price >= 10) return price.toFixed(3);
        if (price >= 1) return price.toFixed(4);
        if (price >= 0.1) return price.toFixed(5);
        if (price >= 0.01) return price.toFixed(6);
        if (price >= 0.001) return price.toFixed(6);
        return price.toFixed(8);
    };
    
    // Update trend
    const trendElement = document.getElementById('trendValue');
    if (indicator.stopLossHit) {
        trendElement.textContent = 'STOP HIT';
        trendElement.style.color = '#ff0000';
    } else {
        trendElement.textContent = indicator.trend.toUpperCase();
        trendElement.style.color = indicator.trend === 'up' ? '#00ff00' : '#ff0000';
    }
    
    // Update values
    document.getElementById('priceValue').textContent = formatPrice(indicator.price);
    document.getElementById('atrValue').textContent = formatPrice(indicator.atr);
    document.getElementById('entryValue').textContent = formatPrice(indicator.entryPrice);
    
    // Update targets
    const container = document.getElementById('targetsContainer');
    container.innerHTML = '';
    
    const targets = [
        { name: 'STOP LOSS', value: indicator.stopLoss, type: 'stop' },
        { name: 'ENTRY', value: indicator.entryPrice, type: 'entry' },
        { name: 'TP1', value: indicator.tp1, type: 'profit' },
        { name: 'TP2', value: indicator.tp2, type: 'profit' },
        { name: 'TP3', value: indicator.tp3, type: 'profit' },
        { name: 'TP4', value: indicator.tp4, type: 'profit' }
    ];
    
    targets.forEach(target => {
        if (!target.value || isNaN(target.value)) return;
        
        const div = document.createElement('div');
        div.className = `target ${target.type}`;
        
        let borderColor = '#333';
        let textColor = '#fff';
        
        if (!indicator.stopLossHit) {
            if (target.type === 'stop') {
                borderColor = '#ff0000';
                textColor = '#ff0000';
            } else if (target.type === 'entry') {
                borderColor = '#0066cc';
                textColor = '#0066cc';
            } else if (target.type === 'profit') {
                borderColor = '#00ff00';
                textColor = '#00ff00';
            }
        } else {
            borderColor = '#ff0000';
            textColor = '#ff0000';
        }
        
        div.style.borderLeftColor = borderColor;
        
        div.innerHTML = `
            <div class="target-name">${target.name}</div>
            <div class="target-value" style="color: ${textColor}">
                ${formatPrice(target.value)}
            </div>
        `;
        
        container.appendChild(div);
    });
}

// ============================================
// UPDATE INDICATOR SETTINGS (ВАЖНАЯ ФУНКЦИЯ)
// ============================================

function updateIndicatorSettings() {
    console.log('Updating indicator settings...');
    
    if (currentData.length < 20) {
        console.log('Not enough data to update settings');
        alert('Недостаточно данных для обновления настроек. Загрузите данные сначала.');
        return;
    }
    
    // Получаем текущие настройки
    const length = parseInt(document.getElementById('trendLength').value) || 10;
    const target = parseInt(document.getElementById('targetMultiplier').value) || 0;
    const atrPeriod = parseInt(document.getElementById('atrPeriod').value) || 20;
    
    console.log('New settings:', { length, target, atrPeriod });
    
    // Пересчитываем индикатор с новыми настройками
    calculatePineIndicator(true); // forceRecalculate = true
    
    // Перерисовываем линии
    drawIndicatorLines();
    
    // Обновляем UI
    updateUI();
    
    // Показываем подтверждение
    alert(`Настройки обновлены!\n\nTrend Length: ${length}\nTarget Multiplier: ${target}\nATR Period: ${atrPeriod}`);
}

// ============================================
// TEST DATA (FALLBACK)
// ============================================

function loadTestData() {
    console.log('Loading test data...');
    
    const symbol = document.getElementById('symbol').value;
    const timeframe = document.getElementById('timeframe').value;
    
    // Инициализируем график если нужно
    if (!chart) {
        initChart();
    }
    
    // Генерируем тестовые данные
    const data = generateTestData(symbol, timeframe);
    currentData = formatData(data);
    
    // Устанавливаем данные
    candleSeries.setData(currentData);
    
    // Сбрасываем индикатор
    indicator = {
        trend: 'neutral',
        atr: 0,
        price: 0,
        entryPrice: 0,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        tp4: 0,
        isBullish: false,
        stopLossHit: false,
        signal_up: false,
        signal_down: false,
        lastSymbol: symbol,
        lastTimeframe: timeframe,
        sma_high: 0,
        sma_low: 0,
        hasInitialSignal: false,
        lastSettings: {
            trendLength: 10,
            targetMultiplier: 0,
            atrPeriod: 20
        }
    };
    
    // Рассчитываем индикаторы
    calculatePineIndicator();
    
    // Рисуем линии
    drawIndicatorLines();
    
    // Обновляем UI
    updateUI();
    
    // Центрируем график
    autoZoomToLatest();
    
    console.log('Test data loaded');
}

function generateTestData(symbol, timeframe) {
    const data = [];
    let basePrice = getTestPrice(symbol);
    let price = basePrice;
    let trend = Math.random() > 0.5;
    
    // Определяем количество баров
    let bars = 100;
    if (timeframe === '1m' || timeframe === '5m') bars = 150;
    
    for (let i = 0; i < bars; i++) {
        const timeOffset = (bars - 1 - i) * getIntervalMs(timeframe);
        const time = Date.now() - timeOffset;
        
        // Создаем реалистичное движение цены
        const volatility = basePrice * 0.01; // 1% волатильность
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
// UTILITY FUNCTIONS
// ============================================

function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
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
    
    // Полный сброс индикатора
    indicator = {
        trend: 'neutral',
        atr: 0,
        price: 0,
        entryPrice: 0,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        tp4: 0,
        isBullish: false,
        stopLossHit: false,
        signal_up: false,
        signal_down: false,
        lastSymbol: symbol,
        lastTimeframe: timeframe,
        sma_high: 0,
        sma_low: 0,
        hasInitialSignal: false,
        lastSettings: {
            trendLength: 10,
            targetMultiplier: 0,
            atrPeriod: 20
        }
    };
    
    // Сбрасываем линии
    resetPriceLines();
    
    // Пересчитываем с текущими данными
    if (currentData.length > 0) {
        calculatePineIndicator(true);
        drawIndicatorLines();
        updateUI();
    }
    
    alert('Индикатор сброшен!');
}

function shareSignal() {
    const signal = `
TREND_1H FUTURES SIGNAL
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
TP4: ${indicator.tp4.toFixed(4)}
════════════════════════
Time: ${new Date().toLocaleString()}
    `;
    
    tg.sendData(JSON.stringify({ signal }));
    tg.showAlert('Signal shared!');
}

// ============================================
// EVENT HANDLERS (С ИСПРАВЛЕННОЙ РЕАКЦИЕЙ НА НАСТРОЙКИ)
// ============================================

function setupEventListeners() {
    // Кнопка обновления
    document.getElementById('updateBtn').addEventListener('click', loadData);
    
    // Смена символа
    document.getElementById('symbol').addEventListener('change', loadData);
    
    // Смена таймфрейма
    document.getElementById('timeframe').addEventListener('change', loadData);
    
    // Изменение настроек индикатора - ТЕПЕРЬ РЕАГИРУЕТ!
    ['trendLength', 'targetMultiplier', 'atrPeriod'].forEach(id => {
        const element = document.getElementById(id);
        
        // Добавляем обработчик для изменения (отпускание клавиши/мыши)
        element.addEventListener('change', function() {
            console.log(`Setting changed via change event: ${id} = ${this.value}`);
            updateIndicatorSettings();
        });
        
        // Также реагируем на input (при вводе с клавиатуры)
        element.addEventListener('input', function() {
            console.log(`Setting input: ${id} = ${this.value}`);
            // Можно добавить debounce если нужно
        });
        
        // Добавляем кнопку Enter для быстрого применения
        element.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                console.log(`Enter pressed for: ${id}`);
                updateIndicatorSettings();
            }
        });
    });
    
    // Кнопка сброса
    document.getElementById('resetBtn').addEventListener('click', resetAll);
    
    // Кнопка шаринга
    document.getElementById('shareBtn').addEventListener('click', shareSignal);
    
    // Кнопка полноэкранного режима
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
    
    // Добавляем отдельную кнопку для применения настроек
    const applySettingsBtn = document.createElement('button');
    applySettingsBtn.className = 'btn';
    applySettingsBtn.innerHTML = '⚙️ APPLY';
    applySettingsBtn.style.marginTop = '10px';
    applySettingsBtn.addEventListener('click', updateIndicatorSettings);
    
    // Вставляем кнопку после настроек
    const controlsDiv = document.querySelector('.controls');
    controlsDiv.appendChild(applySettingsBtn);
}

// ============================================
// MAIN INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('App starting...');
    
    try {
        // Инициализируем список монет
        initSymbols();
        
        // Настройка событий
        setupEventListeners();
        
        // Инициализируем график
        initChart();
        
        // Загружаем данные через 500мс
        setTimeout(() => {
            loadData();
        }, 500);
        
        // Автообновление каждые 30 секунд
        setInterval(() => {
            if (!document.hidden && !isLoading) {
                console.log('Auto-refresh...');
                loadData();
            }
        }, 30000);
        
        // Обновление при возвращении на вкладку
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('Tab became visible, refreshing...');
                setTimeout(() => loadData(), 1000);
            }
        });
        
        console.log('App started successfully');
        
    } catch (error) {
        console.error('Fatal error during initialization:', error);
        alert(`Ошибка инициализации: ${error.message}`);
    }
});

