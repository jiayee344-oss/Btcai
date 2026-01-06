// ==================== 自动交易系统主类 ====================
class AutoTradingSystem {
    constructor() {
        // 配置
        this.config = {
            // API配置
            apiBase: 'https://www.okx.com/api/v5',
            symbol: 'BTC-USDT',
            
            // 交易参数（优化后）
            accountBalance: 100,       // USDT本金
            riskPerTrade: 0.02,        // 每笔交易风险2%
            tp1Percent: 0.015,         // TP1: 1.5% (微利)
            tp2Percent: 0.03,          // TP2: 3% (中利)
            slPercent: 0.012,          // SL: 1.2% (小损)
            maxPositionPercent: 0.5,   // 最大仓位50%
            
            // 技术指标参数
            rsiOversold: 30,           // RSI超卖阈值
            rsiOverbought: 70,         // RSI超买阈值
            rsiNeutralMin: 40,         // RSI中性区间最小值
            rsiNeutralMax: 60,         // RSI中性区间最大值
            highVolatility: 5,         // 高波动率阈值（%）
            trendThreshold: 0.5,       // 趋势阈值（%）
            
            // 系统参数
            cooldownSeconds: 180,      // 冷却时间3分钟
            priceUpdateInterval: 10000, // 价格更新间隔10秒
            signalCheckInterval: 30000, // 信号检查间隔30秒
            chartUpdateInterval: 60000  // 图表更新间隔60秒
        };
        
        // 状态管理
        this.state = {
            currentPrice: 0,
            indicators: {
                rsi: 50,
                trend: 'neutral',
                volatility: 0,
                support: 0,
                resistance: 0,
                pricePosition: 50
            },
            activeTrade: null,
            signalHistory: [],
            stats: {
                totalTrades: 0,
                winningTrades: 0,
                totalPnL: 0,
                currentStreak: 0,
                bestStreak: 0,
                maxWin: 0,
                maxLoss: 0,
                avgWin: 0,
                avgLoss: 0
            },
            cooldownEnd: null,
            isRunning: false,
            isInitialized: false
        };
        
        // 数据存储
        this.priceData = [];
        this.candles = [];
        this.chart = null;
        
        // 定时器
        this.intervals = {
            price: null,
            signal: null,
            chart: null
        };
        
        console.log('🚀 AutoTradingSystem 初始化');
    }
    
    // ==================== 初始化方法 ====================
    
    async init() {
        try {
            console.log('🔧 系统初始化开始...');
            this.showStatus('系统初始化中...', 'loading');
            
            // 加载保存的数据
            this.loadStoredData();
            
            // 初始化UI
            this.initUI();
            
            // 测试API连接
            await this.testConnection();
            
            // 获取初始数据
            await this.loadInitialData();
            
            // 启动自动模式
            this.startAutoMode();
            
            // 更新标记
            this.state.isInitialized = true;
            this.saveData();
            
            this.showStatus('系统运行正常', 'success');
            console.log('✅ 系统初始化完成');
            
        } catch (error) {
            console.error('初始化失败:', error);
            this.showStatus('初始化失败，使用模拟模式', 'error');
            this.useSimulationMode();
        }
    }
    
    // ==================== 数据获取方法 ====================
    
    async testConnection() {
        try {
            const response = await fetch(`${this.config.apiBase}/public/time`);
            const data = await response.json();
            
            if (data.code === '0') {
                console.log('✅ API连接正常');
                return true;
            } else {
                throw new Error(`API错误: ${data.msg}`);
            }
        } catch (error) {
            console.error('API连接测试失败:', error);
            throw error;
        }
    }
    
    async getTickerData() {
        try {
            const response = await fetch(
                `${this.config.apiBase}/market/ticker?instId=${this.config.symbol}`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.code !== '0' || !data.data || !data.data[0]) {
                throw new Error('API响应格式错误');
            }
            
            return data.data[0];
            
        } catch (error) {
            console.error('获取行情数据失败:', error);
            throw error;
        }
    }
    
    async getCandleData(interval = '15m', limit = 30) {
        try {
            const response = await fetch(
                `${this.config.apiBase}/market/candles?instId=${this.config.symbol}&bar=${interval}&limit=${limit}`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.code !== '0' || !data.data) {
                throw new Error('K线数据格式错误');
            }
            
            return data.data.map(candle => ({
                timestamp: parseInt(candle[0]),
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5])
            })).reverse();
            
        } catch (error) {
            console.error('获取K线数据失败:', error);
            throw error;
        }
    }
    
    async loadInitialData() {
        try {
            // 获取实时行情
            const ticker = await this.getTickerData();
            this.updatePriceData(ticker);
            
            // 获取K线数据
            this.candles = await this.getCandleData('15m', 50);
            this.calculateIndicators();
            
            // 更新图表
            this.updateChart();
            
            console.log('📊 初始数据加载完成');
            
        } catch (error) {
            console.error('加载初始数据失败:', error);
            throw error;
        }
    }
    
    // ==================== 技术分析方法 ====================
    
    calculateIndicators() {
        if (this.candles.length < 20) {
            console.warn('K线数据不足，无法计算指标');
            return;
        }
        
        const closes = this.candles.map(c => c.close);
        const highs = this.candles.map(c => c.high);
        const lows = this.candles.map(c => c.low);
        
        // 计算RSI
        this.state.indicators.rsi = this.calculateRSI(closes);
        
        // 计算支撑阻力位
        const sr = this.calculateSupportResistance(highs, lows, this.state.currentPrice);
        this.state.indicators.support = sr.support;
        this.state.indicators.resistance = sr.resistance;
        this.state.indicators.pricePosition = sr.pricePosition;
        
        // 计算趋势
        this.state.indicators.trend = this.calculateTrend(closes);
        
        // 计算波动率
        this.state.indicators.volatility = this.calculateVolatility(closes);
        
        // 更新UI显示
        this.updateIndicatorsDisplay();
        
        console.log('📈 技术指标计算完成:', {
            rsi: this.state.indicators.rsi.toFixed(2),
            trend: this.state.indicators.trend,
            position: this.state.indicators.pricePosition
        });
    }
    
    calculateRSI(closes) {
        if (closes.length < 14) return 50;
        
        let gains = 0;
        let losses = 0;
        
        // 计算初始平均值
        for (let i = 1; i < 14; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses += Math.abs(change);
            }
        }
        
        let avgGain = gains / 13;
        let avgLoss = losses / 13;
        
        // 计算后续值
        for (let i = 14; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;
            
            avgGain = (avgGain * 13 + gain) / 14;
            avgLoss = (avgLoss * 13 + loss) / 14;
        }
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    
    calculateSupportResistance(highs, lows, currentPrice) {
        const recentHighs = highs.slice(-20);
        const recentLows = lows.slice(-20);
        
        const resistance = Math.max(...recentHighs);
        const support = Math.min(...recentLows);
        
        let pricePosition = 50;
        if (resistance > support) {
            pricePosition = ((currentPrice - support) / (resistance - support) * 100);
        }
        
        return {
            support,
            resistance,
            pricePosition: Math.max(0, Math.min(100, pricePosition))
        };
    }
    
    calculateTrend(closes) {
        if (closes.length < 10) return 'neutral';
        
        const shortTerm = closes.slice(-5);
        const longTerm = closes.slice(-10);
        
        const shortAvg = shortTerm.reduce((a, b) => a + b) / shortTerm.length;
        const longAvg = longTerm.reduce((a, b) => a + b) / longTerm.length;
        
        const change = ((shortAvg - longAvg) / longAvg) * 100;
        
        if (change > this.config.trendThreshold) return 'bullish';
        if (change < -this.config.trendThreshold) return 'bearish';
        return 'neutral';
    }
    
    calculateVolatility(closes) {
        if (closes.length < 10) return 0;
        
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            returns.push((closes[i] - closes[i-1]) / closes[i-1]);
        }
        
        const mean = returns.reduce((a, b) => a + b) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance) * Math.sqrt(252) * 100;
    }
    
    // ==================== 信号生成方法 ====================
    
    async generateSignal() {
        // 检查条件
        if (this.isInCooldown()) {
            console.log('⏳ 冷却期，跳过信号生成');
            this.updateCooldownDisplay();
            return;
        }
        
        if (this.state.activeTrade) {
            console.log('🔄 有活跃交易，等待完成');
            return;
        }
        
        console.log('🔍 开始分析市场，生成信号...');
        this.showStatus('分析市场数据中...', 'loading');
        
        try {
            // 更新数据
            const ticker = await this.getTickerData();
            this.updatePriceData(ticker);
            
            // 重新计算指标
            this.calculateIndicators();
            
            // 分析市场
            const signal = this.analyzeMarket();
            
            // 如果有交易信号
            if (signal.action !== 'HOLD') {
                // 创建交易记录
                const trade = this.createTradeRecord(signal);
                
                // 设置活跃交易
                this.state.activeTrade = trade;
                
                // 添加到历史
                this.addToHistory(trade);
                
                // 更新UI
                this.displaySignal(trade);
                this.updateTradeStatus('进行中', `新信号: ${trade.action}`);
                
                // 保存数据
                this.saveData();
                
                this.showStatus(`新信号生成: ${trade.action}`, 'success');
                console.log(`✅ 信号生成: ${trade.action}, 价格: $${trade.price}`);
                
            } else {
                this.updateTradeStatus('观望', signal.reason);
                this.showStatus('市场条件不适合交易', 'info');
                console.log('⏸️ 无交易信号:', signal.reason);
            }
            
        } catch (error) {
            console.error('生成信号失败:', error);
            this.showStatus('生成信号失败', 'error');
        }
    }
    
    analyzeMarket() {
        const { rsi, trend, volatility, pricePosition } = this.state.indicators;
        const price = this.state.currentPrice;
        
        let action = 'HOLD';
        let confidence = 0.5;
        let reason = '';
        
        // RSI信号
        if (rsi < this.config.rsiOversold) {
            // RSI超卖，可能买入机会
            if (trend === 'bullish' || trend === 'neutral') {
                action = 'BUY';
                confidence = 0.7 + (this.config.rsiOversold - rsi) / 50;
                reason = `RSI超卖(${rsi.toFixed(1)} < ${this.config.rsiOversold})，趋势${trend === 'bullish' ? '向上' : '中性'}`;
                
                if (pricePosition < 40) {
                    reason += `，价格接近支撑位(${pricePosition.toFixed(1)}%)`;
                    confidence += 0.05;
                }
            } else {
                reason = `RSI超卖(${rsi.toFixed(1)})但趋势向下，等待确认`;
            }
            
        } else if (rsi > this.config.rsiOverbought) {
            // RSI超买，可能卖出机会
            if (trend === 'bearish' || trend === 'neutral') {
                action = 'SELL';
                confidence = 0.7 + (rsi - this.config.rsiOverbought) / 50;
                reason = `RSI超买(${rsi.toFixed(1)} > ${this.config.rsiOverbought})，趋势${trend === 'bearish' ? '向下' : '中性'}`;
                
                if (pricePosition > 60) {
                    reason += `，价格接近阻力位(${pricePosition.toFixed(1)}%)`;
                    confidence += 0.05;
                }
            } else {
                reason = `RSI超买(${rsi.toFixed(1)})但趋势向上，等待确认`;
            }
            
        } else if (rsi > this.config.rsiNeutralMin && rsi < this.config.rsiNeutralMax) {
            // RSI中性区间
            reason = `RSI中性(${rsi.toFixed(1)})，市场平衡`;
            confidence = 0.6;
            
        } else {
            // RSI在正常区间
            if (pricePosition < 30 && trend !== 'bearish') {
                action = 'BUY';
                confidence = 0.65;
                reason = `价格接近支撑位(${pricePosition.toFixed(1)}%)，RSI适中(${rsi.toFixed(1)})`;
            } else if (pricePosition > 70 && trend !== 'bullish') {
                action = 'SELL';
                confidence = 0.65;
                reason = `价格接近阻力位(${pricePosition.toFixed(1)}%)，RSI适中(${rsi.toFixed(1)})`;
            } else {
                reason = `市场无明显信号，RSI: ${rsi.toFixed(1)}，位置: ${pricePosition.toFixed(1)}%`;
            }
        }
        
        // 波动率过滤
        if (volatility > this.config.highVolatility) {
            confidence *= 0.8;
            reason += ` | 高波动率(${volatility.toFixed(1)}%)降低信号强度`;
        }
        
        // 限制置信度范围
        confidence = Math.max(0.3, Math.min(0.95, confidence));
        
        return {
            action,
            confidence: confidence.toFixed(2),
            reason,
            price: price.toFixed(2),
            rsi: rsi.toFixed(2),
            trend,
            volatility: volatility.toFixed(1),
            pricePosition: pricePosition.toFixed(1)
        };
    }
    
    createTradeRecord(signal) {
        const { action, confidence, reason, price, rsi } = signal;
        const priceNum = parseFloat(price);
        
        // 计算交易参数
        const params = this.calculateTradeParams(action, priceNum, parseFloat(confidence));
        
        // 生成唯一ID
        const id = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return {
            id,
            action,
            confidence,
            price: price,
            tp1: params.tp1.toFixed(2),
            tp2: params.tp2.toFixed(2),
            sl: params.sl.toFixed(2),
            positionSize: params.positionSize,
            positionPercent: params.positionPercent,
            riskReward: params.riskReward,
            reason,
            rsi,
            symbol: this.config.symbol,
            timestamp: new Date().toISOString(),
            status: 'active',
            result: null,
            pnl: null,
            exitPrice: null,
            completedAt: null
        };
    }
    
    calculateTradeParams(action, price, confidence) {
        let tp1, tp2, sl;
        
        // 计算TP/SL
        if (action === 'BUY') {
            tp1 = price * (1 + this.config.tp1Percent);
            tp2 = price * (1 + this.config.tp2Percent);
            sl = price * (1 - this.config.slPercent);
        } else if (action === 'SELL') {
            tp1 = price * (1 - this.config.tp1Percent);
            tp2 = price * (1 - this.config.tp2Percent);
            sl = price * (1 + this.config.slPercent);
        }
        
        // 计算风险回报比
        const risk = Math.abs(price - sl);
        const reward = Math.abs(tp1 - price);
        const riskReward = (reward / risk).toFixed(2);
        
        // 计算建议仓位
        const riskAmount = this.config.accountBalance * this.config.riskPerTrade;
        const positionSize = Math.min(
            (riskAmount / (risk / price)),
            this.config.accountBalance * this.config.maxPositionPercent
        );
        const positionPercent = ((positionSize / this.config.accountBalance) * 100).toFixed(1);
        
        return {
            tp1,
            tp2,
            sl,
            riskReward,
            positionSize: positionSize.toFixed(2),
            positionPercent
        };
    }
    
    // ==================== 交易监控方法 ====================
    
    checkTradeConditions() {
        if (!this.state.activeTrade || !this.state.currentPrice) return;
        
        const trade = this.state.activeTrade;
        const price = parseFloat(trade.price);
        const current = this.state.currentPrice;
        const tp1 = parseFloat(trade.tp1);
        const tp2 = parseFloat(trade.tp2);
        const sl = parseFloat(trade.sl);
        
        let triggered = false;
        let result = null;
        let tpLevel = 0;
        
        if (trade.action === 'BUY') {
            if (current >= tp2) {
                result = 'win';
                tpLevel = 2;
                triggered = true;
            } else if (current >= tp1) {
                result = 'win';
                tpLevel = 1;
                triggered = true;
            } else if (current <= sl) {
                result = 'loss';
                triggered = true;
            }
        } else if (trade.action === 'SELL') {
            if (current <= tp2) {
                result = 'win';
                tpLevel = 2;
                triggered = true;
            } else if (current <= tp1) {
                result = 'win';
                tpLevel = 1;
                triggered = true;
            } else if (current >= sl) {
                result = 'loss';
                triggered = true;
            }
        }
        
        if (triggered) {
            this.completeTrade(result, tpLevel, current);
        } else {
            this.updateDistanceDisplay(trade, current);
        }
    }
    
    completeTrade(result, tpLevel, currentPrice) {
        const trade = this.state.activeTrade;
        
        // 计算盈亏
        const positionSize = parseFloat(trade.positionSize);
        const entry = parseFloat(trade.price);
        let pnl = 0;
        
        if (result === 'win') {
            const tpPrice = tpLevel === 1 ? parseFloat(trade.tp1) : parseFloat(trade.tp2);
            
            if (trade.action === 'BUY') {
                pnl = (tpPrice - entry) * (positionSize / entry);
            } else {
                pnl = (entry - tpPrice) * (positionSize / entry);
            }
        } else {
            const slPrice = parseFloat(trade.sl);
            if (trade.action === 'BUY') {
                pnl = (slPrice - entry) * (positionSize / entry);
            } else {
                pnl = (entry - slPrice) * (positionSize / entry);
            }
        }
        
        // 更新交易记录
        trade.status = result === 'win' ? 
            (tpLevel === 1 ? 'hit_tp1' : 'hit_tp2') : 
            'hit_sl';
        trade.result = result;
        trade.pnl = pnl.toFixed(2);
        trade.exitPrice = currentPrice.toFixed(2);
        trade.completedAt = new Date().toISOString();
        
        // 更新统计数据
        this.updateStats(result, pnl);
        
        // 显示结果
        const resultText = result === 'win' ? 
            `${tpLevel === 2 ? '第二止盈' : '第一止盈'}达成，盈利 $${pnl.toFixed(2)}` :
            `止损触发，亏损 $${Math.abs(pnl).toFixed(2)}`;
        
        this.updateTradeStatus('已完成', resultText);
        
        // 高亮显示
        this.highlightTradeResult(result, tpLevel);
        
        // 清除活跃交易
        this.state.activeTrade = null;
        
        // 保存数据
        this.saveData();
        
        // 显示通知
        this.showSystemMessage(`交易完成: ${resultText}`, result === 'win' ? 'success' : 'error');
        
        // 开始冷却时间
        this.startCooldownPeriod();
        
        console.log(`🎯 交易完成: ${result}, PnL: $${pnl.toFixed(2)}`);
    }
    
    // ==================== UI更新方法 ====================
    
    initUI() {
        // 初始化图表
        this.initChart();
        
        // 更新所有显示
        this.updateAllDisplays();
    }
    
    updatePriceData(ticker) {
        if (!ticker) return;
        
        const price = parseFloat(ticker.last);
        this.state.currentPrice = price;
        
        // 更新价格显示
        this.updatePriceDisplay(price);
        
        // 更新市场数据
        this.updateMarketData(ticker);
        
        // 添加到价格历史
        this.addPriceToHistory(price);
    }
    
    updatePriceDisplay(price) {
        const priceElement = document.getElementById('priceDisplay');
        const timeElement = document.getElementById('updateTime');
        
        if (priceElement) {
            priceElement.textContent = `$${price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}`;
        }
        
        if (timeElement) {
            timeElement.textContent = new Date().toLocaleTimeString('zh-CN');
        }
    }
    
    updateMarketData(ticker) {
        const highElement = document.getElementById('high24h');
        const lowElement = document.getElementById('low24h');
        
        if (highElement && ticker.high24h) {
            highElement.textContent = `$${parseFloat(ticker.high24h).toLocaleString('en-US', {
                minimumFractionDigits: 2
            })}`;
        }
        
        if (lowElement && ticker.low24h) {
            lowElement.textContent = `$${parseFloat(ticker.low24h).toLocaleString('en-US', {
                minimumFractionDigits: 2
            })}`;
        }
    }
    
    updateIndicatorsDisplay() {
        const { rsi, trend, pricePosition } = this.state.indicators;
        
        // RSI显示
        const rsiElement = document.getElementById('rsiValue');
        const rsiSignalElement = document.getElementById('rsiSignal');
        
        if (rsiElement) {
            rsiElement.textContent = rsi.toFixed(2);
            
            if (rsi < this.config.rsiOversold) {
                rsiElement.className = 'text-2xl font-bold text-green-400';
                if (rsiSignalElement) {
                    rsiSignalElement.textContent = '超卖';
                    rsiSignalElement.className = 'text-xs text-green-400 mt-1';
                }
            } else if (rsi > this.config.rsiOverbought) {
                rsiElement.className = 'text-2xl font-bold text-red-400';
                if (rsiSignalElement) {
                    rsiSignalElement.textContent = '超买';
                    rsiSignalElement.className = 'text-xs text-red-400 mt-1';
                }
            } else {
                rsiElement.className = 'text-2xl font-bold text-yellow-400';
                if (rsiSignalElement) {
                    rsiSignalElement.textContent = '中性';
                    rsiSignalElement.className = 'text-xs text-yellow-400 mt-1';
                }
            }
        }
        
        // 趋势强度
        const trendElement = document.getElementById('trendStrength');
        if (trendElement) {
            let strength = 50;
            if (trend === 'bullish') strength = 75;
            if (trend === 'bearish') strength = 25;
            
            trendElement.textContent = `${strength}%`;
            
            if (strength > 60) {
                trendElement.className = 'text-2xl font-bold text-green-400';
            } else if (strength < 40) {
                trendElement.className = 'text-2xl font-bold text-red-400';
            } else {
                trendElement.className = 'text-2xl font-bold text-yellow-400';
            }
        }
        
        // 支撑阻力位
        const srElement = document.getElementById('srLevel');
        if (srElement) {
            srElement.textContent = `${pricePosition.toFixed(1)}%`;
        }
    }
    
    displaySignal(signal) {
        if (!signal) return;
        
        // 更新信号卡片
        const signalDisplay = document.getElementById('signalDisplay');
        const signalType = document.getElementById('signalType');
        const signalConf = document.getElementById('signalConf');
        const signalReason = document.getElementById('signalReason');
        const signalTime = document.getElementById('signalTime');
        
        if (signalDisplay) {
            signalDisplay.className = 'rounded-xl p-6 shadow-lg border-2';
            
            if (signal.action === 'BUY') {
                signalDisplay.classList.add('buy-signal', 'border-green-500');
            } else if (signal.action === 'SELL') {
                signalDisplay.classList.add('sell-signal', 'border-red-500');
            }
        }
        
        if (signalType) {
            if (signal.action === 'BUY') {
                signalType.innerHTML = '🔼 BUY';
                signalType.className = 'text-5xl font-bold text-green-400 mb-4';
            } else if (signal.action === 'SELL') {
                signalType.innerHTML = '🔽 SELL';
                signalType.className = 'text-5xl font-bold text-red-400 mb-4';
            }
        }
        
        if (signalConf) {
            signalConf.textContent = `${(parseFloat(signal.confidence) * 100).toFixed(0)}%`;
        }
        
        if (signalReason) {
            signalReason.textContent = `分析原因: ${signal.reason}`;
        }
        
        if (signalTime && signal.timestamp) {
            signalTime.textContent = `生成时间: ${new Date(signal.timestamp).toLocaleTimeString('zh-CN')}`;
        }
        
        // 更新交易参数
        this.updateTradeParamsDisplay(signal);
        
        // 更新分析详情
        this.updateAnalysisDetails(signal);
    }
    
    updateTradeParamsDisplay(signal) {
        const elements = {
            entry: document.getElementById('entryPriceDisplay'),
            position: document.getElementById('positionDisplay'),
            tp1: document.getElementById('tp1Display'),
            tp2: document.getElementById('tp2Display'),
            sl: document.getElementById('slDisplay'),
            riskReward: document.getElementById('riskRewardDisplay')
        };
        
        if (elements.entry) elements.entry.textContent = `$${signal.price}`;
        if (elements.position) elements.position.textContent = `${signal.positionSize} USDT`;
        if (elements.tp1) elements.tp1.textContent = `$${signal.tp1}`;
        if (elements.tp2) elements.tp2.textContent = `$${signal.tp2}`;
        if (elements.sl) elements.sl.textContent = `$${signal.sl}`;
        if (elements.riskReward) elements.riskReward.textContent = `${signal.riskReward}:1`;
    }
    
    updateAnalysisDetails(signal) {
        const analysisReason = document.getElementById('analysisReason');
        if (analysisReason) {
            analysisReason.textContent = signal.reason;
        }
    }
    
    updateDistanceDisplay(trade, currentPrice) {
        const entry = parseFloat(trade.price);
        const tp1 = parseFloat(trade.tp1);
        const sl = parseFloat(trade.sl);
        
        let distanceTP1, distanceSL;
        
        if (trade.action === 'BUY') {
            distanceTP1 = ((currentPrice - entry) / entry * 100).toFixed(2);
            distanceSL = ((entry - currentPrice) / entry * 100).toFixed(2);
        } else {
            distanceTP1 = ((entry - currentPrice) / entry * 100).toFixed(2);
            distanceSL = ((currentPrice - entry) / entry * 100).toFixed(2);
        }
        
        // 更新进度条
        const progressElement = document.getElementById('priceProgress');
        if (progressElement) {
            const totalRange = Math.abs(tp1 - sl);
            const currentPosition = Math.abs(currentPrice - sl);
            const progress = (currentPosition / totalRange * 100);
            progressElement.style.width = `${Math.min(Math.max(progress, 0), 100)}%`;
        }
    }
    
    updateTradeStatus(status, message) {
        const statusElement = document.getElementById('tradeStatus');
        const messageElement = document.getElementById('statusMessage');
        
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = 'px-2 py-1 text-xs rounded';
            
            if (status === '进行中') {
                statusElement.classList.add('bg-yellow-900', 'text-yellow-300');
            } else if (status === '已完成') {
                statusElement.classList.add('bg-green-900', 'text-green-300');
            } else if (status === '观望') {
                statusElement.classList.add('bg-gray-700', 'text-gray-300');
            }
        }
        
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
    
    updateStats(result, pnl) {
        const stats = this.state.stats;
        
        stats.totalTrades++;
        
        if (result === 'win') {
            stats.winningTrades++;
            stats.currentStreak++;
            
            if (stats.currentStreak > stats.bestStreak) {
                stats.bestStreak = stats.currentStreak;
            }
            
            if (pnl > stats.maxWin) {
                stats.maxWin = pnl;
            }
            
            const winCount = stats.winningTrades - 1;
            stats.avgWin = winCount > 0 ? 
                ((stats.avgWin * winCount) + pnl) / stats.winningTrades : 
                pnl;
                
        } else {
            stats.currentStreak = 0;
            
            if (pnl < stats.maxLoss) {
                stats.maxLoss = pnl;
            }
            
            const lossCount = (stats.totalTrades - stats.winningTrades) - 1;
            stats.avgLoss = lossCount > 0 ? 
                ((stats.avgLoss * lossCount) + pnl) / (stats.totalTrades - stats.winningTrades) : 
                pnl;
        }
        
        stats.totalPnL += pnl;
        
        // 更新显示
        this.updateStatsDisplay();
    }
    
    updateStatsDisplay() {
        const stats = this.state.stats;
        const winRate = stats.totalTrades > 0 ? 
            ((stats.winningTrades / stats.totalTrades) * 100).toFixed(0) : 0;
        
        const totalTradesElement = document.getElementById('totalTrades');
        const winRateElement = document.getElementById('winRate');
        const totalPnLElement = document.getElementById('totalPnL');
        
        if (totalTradesElement) {
            totalTradesElement.textContent = stats.totalTrades;
        }
        
        if (winRateElement) {
            winRateElement.textContent = `${winRate}%`;
            winRateElement.className = winRate >= 50 ? 
                'text-lg font-bold text-green-400' : 
                'text-lg font-bold text-red-400';
        }
        
        if (totalPnLElement) {
            totalPnLElement.textContent = `$${stats.totalPnL.toFixed(2)}`;
            totalPnLElement.className = stats.totalPnL >= 0 ? 
                'text-lg font-bold text-green-400' : 
                'text-lg font-bold text-red-400';
        }
    }
    
    updateCooldownDisplay() {
        if (!this.isInCooldown()) {
            const timeElement = document.getElementById('cooldownTime');
            const progressElement = document.getElementById('cooldownProgress');
            
            if (timeElement) timeElement.textContent = '就绪';
            if (progressElement) progressElement.style.width = '100%';
            return;
        }
        
        const remaining = this.state.cooldownEnd - new Date();
        const seconds = Math.floor(remaining / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        
        const timeElement = document.getElementById('cooldownTime');
        const progressElement = document.getElementById('cooldownProgress');
        
        if (timeElement) {
            timeElement.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
        
        if (progressElement) {
            const totalTime = this.config.cooldownSeconds * 1000;
            const progress = ((totalTime - remaining) / totalTime * 100);
            progressElement.style.width = `${progress}%`;
        }
        
        // 每秒更新一次
        if (remaining > 1000) {
            setTimeout(() => this.updateCooldownDisplay(), 1000);
        }
    }
    
    highlightTradeResult(result, tpLevel) {
        const signalDisplay = document.getElementById('signalDisplay');
        if (!signalDisplay) return;
        
        signalDisplay.classList.add('price-hit');
        
        if (result === 'win') {
            signalDisplay.style.borderColor = '#10b981';
            signalDisplay.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.5)';
        } else {
            signalDisplay.style.borderColor = '#ef4444';
            signalDisplay.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.5)';
        }
        
        // 3秒后移除高亮
        setTimeout(() => {
            signalDisplay.classList.remove('price-hit');
            signalDisplay.style.boxShadow = '';
        }, 3000);
    }
    
    addToHistory(signal) {
        this.state.signalHistory.unshift(signal);
        
        // 保持最多20条记录
        if (this.state.signalHistory.length > 20) {
            this.state.signalHistory = this.state.signalHistory.slice(0, 20);
        }
        
        // 更新显示
        this.updateHistoryDisplay();
    }
    
    updateHistoryDisplay() {
        const tbody = document.getElementById('historyTable');
        const countElement = document.getElementById('historyCount');
        
        if (!tbody) return;
        
        if (this.state.signalHistory.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="py-4 text-center text-gray-500">暂无交易历史</td>
                </tr>
            `;
            if (countElement) countElement.textContent = '0';
            return;
        }
        
        tbody.innerHTML = this.state.signalHistory.map(signal => {
            const time = new Date(signal.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const actionClass = signal.action === 'BUY' ? 'text-green-400' : 
                              signal.action === 'SELL' ? 'text-red-400' : 'text-gray-400';
            
            const actionIcon = signal.action === 'BUY' ? '📈' : 
                             signal.action === 'SELL' ? '📉' : '⏸️';
            
            let statusClass = 'text-gray-400';
            let statusText = '等待';
            
            if (signal.status === 'hit_tp1' || signal.status === 'hit_tp2') {
                statusClass = 'text-green-400';
                statusText = signal.status === 'hit_tp1' ? 'TP1' : 'TP2';
            } else if (signal.status === 'hit_sl') {
                statusClass = 'text-red-400';
                statusText = 'SL';
            } else if (signal.status === 'active') {
                statusClass = 'text-yellow-400';
                statusText = '进行中';
            }
            
            let resultClass = 'text-gray-400';
            let resultText = '-';
            
            if (signal.result === 'win') {
                resultClass = 'text-green-400 font-bold';
                resultText = `+$${signal.pnl || '0.00'}`;
            } else if (signal.result === 'loss') {
                resultClass = 'text-red-400';
                resultText = `-$${Math.abs(signal.pnl || '0').toFixed(2)}`;
            }
            
            return `
                <tr class="border-b border-gray-700 hover:bg-gray-700/30">
                    <td class="py-2">${time}</td>
                    <td class="py-2">
                        <span class="${actionClass} font-bold">
                            ${actionIcon} ${signal.action}
                        </span>
                    </td>
                    <td class="py-2">$${signal.price}</td>
                    <td class="py-2">
                        <div class="text-green-400 text-xs">TP: $${signal.tp1}</div>
                        <div class="text-red-400 text-xs">SL: $${signal.sl}</div>
                    </td>
                    <td class="py-2">
                        <span class="${resultClass} font-semibold">${resultText}</span>
                    </td>
                </tr>
            `;
        }).join('');
        
        if (countElement) {
            countElement.textContent = this.state.signalHistory.length;
        }
    }
    
    updateAllDisplays() {
        this.updatePriceDisplay(this.state.currentPrice);
        this.updateIndicatorsDisplay();
        this.updateHistoryDisplay();
        this.updateStatsDisplay();
        this.updateCooldownDisplay();
        
        // 如果有活跃交易，显示它
        if (this.state.activeTrade) {
            this.displaySignal(this.state.activeTrade);
            this.updateTradeStatus('进行中', '交易执行中...');
        }
    }
    
    // ==================== 图表相关方法 ====================
    
    initChart() {
        const ctx = document.getElementById('btcChart');
        if (!ctx) return;
        
        this.chart = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'BTC/USDT 价格',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#d1d5db'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#9ca3af'
                        },
                        grid: {
                            color: '#374151'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#9ca3af',
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        },
                        grid: {
                            color: '#374151'
                        }
                    }
                }
            }
        });
    }
    
    addPriceToHistory(price) {
        const now = new Date();
        const timeLabel = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        this.priceData.push({
            time: timeLabel,
            price: price
        });
        
        // 保持最多30个数据点
        if (this.priceData.length > 30) {
            this.priceData.shift();
        }
        
        this.updateChart();
    }
    
    updateChart() {
        if (!this.chart || this.priceData.length === 0) return;
        
        this.chart.data.labels = this.priceData.map(item => item.time);
        this.chart.data.datasets[0].data = this.priceData.map(item => item.price);
        this.chart.update();
    }
    
    // ==================== 控制方法 ====================
    
    startAutoMode() {
        if (this.state.isRunning) return;
        
        this.state.isRunning = true;
        console.log('🚀 启动全自动模式');
        
        // 价格更新定时器
        this.intervals.price = setInterval(async () => {
            try {
                const ticker = await this.getTickerData();
                if (ticker) {
                    this.updatePriceData(ticker);
                    this.checkTradeConditions();
                }
            } catch (error) {
                console.error('价格更新失败:', error);
            }
        }, this.config.priceUpdateInterval);
        
        // 信号检查定时器
        this.intervals.signal = setInterval(() => {
            this.generateSignal();
        }, this.config.signalCheckInterval);
        
        // 图表更新定时器
        this.intervals.chart = setInterval(async () => {
            try {
                this.candles = await this.getCandleData('15m', 30);
                this.calculateIndicators();
            } catch (error) {
                console.error('图表更新失败:', error);
            }
        }, this.config.chartUpdateInterval);
    }
    
    stopAutoMode() {
        if (!this.state.isRunning) return;
        
        this.state.isRunning = false;
        console.log('🛑 停止自动模式');
        
        // 清除所有定时器
        Object.values(this.intervals).forEach(interval => {
            if (interval) clearInterval(interval);
        });
    }
    
    startCooldownPeriod() {
        this.state.cooldownEnd = new Date(Date.now() + this.config.cooldownSeconds * 1000);
        this.updateCooldownDisplay();
    }
    
    isInCooldown() {
        if (!this.state.cooldownEnd) return false;
        return new Date() < this.state.cooldownEnd;
    }
    
    // ==================== 数据存储方法 ====================
    
    loadStoredData() {
        try {
            // 加载信号历史
            const savedHistory = localStorage.getItem('trading_signals');
            if (savedHistory) {
                const parsed = JSON.parse(savedHistory);
                this.state.signalHistory = parsed.slice(0, 20);
            }
            
            // 加载系统状态
            const savedState = localStorage.getItem('trading_state');
            if (savedState) {
                const parsed = JSON.parse(savedState);
                
                // 合并状态，但保留重要数据
                this.state.stats = parsed.stats || this.state.stats;
                this.state.cooldownEnd = parsed.cooldownEnd ? new Date(parsed.cooldownEnd) : null;
                
                // 如果活跃交易存在且未完成，恢复它
                if (parsed.activeTrade && parsed.activeTrade.status === 'active') {
                    this.state.activeTrade = parsed.activeTrade;
                }
            }
            
            console.log('📂 数据加载完成');
            
        } catch (error) {
            console.error('加载数据失败:', error);
        }
    }
    
    saveData() {
        try {
            localStorage.setItem('trading_signals', 
                JSON.stringify(this.state.signalHistory));
                
            localStorage.setItem('trading_state', 
                JSON.stringify({
                    stats: this.state.stats,
                    cooldownEnd: this.state.cooldownEnd,
                    activeTrade: this.state.activeTrade,
                    lastUpdate: new Date().toISOString()
                }));
                
            console.log('💾 数据保存完成');
            
        } catch (error) {
            console.error('保存数据失败:', error);
        }
    }
    
    // ==================== 辅助方法 ====================
    
    showStatus(message, type = 'info') {
        const statusElement = document.getElementById('systemStatus');
        if (!statusElement) return;
        
        const colors = {
            info: 'text-blue-400',
            success: 'text-green-400',
            warning: 'text-yellow-400',
            error: 'text-red-400',
            loading: 'text-purple-400'
        };
        
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            loading: '⏳'
        };
        
        statusElement.textContent = `${icons[type] || ''} ${message}`;
        statusElement.className = colors[type] || colors.info;
        
        console.log(`系统状态: ${message}`);
    }
    
    showSystemMessage(message, type = 'info') {
        this.showStatus(message, type);
    }
    
    useSimulationMode() {
        console.log('🎮 进入模拟模式');
        
        // 生成模拟数据
        this.state.currentPrice = 50000 + Math.random() * 5000;
        this.state.indicators.rsi = 40 + Math.random() * 30;
        this.state.indicators.trend = Math.random() > 0.5 ? 'bullish' : 'bearish';
        this.state.indicators.volatility = 2 + Math.random() * 3;
        this.state.indicators.pricePosition = 20 + Math.random() * 60;
        
        // 更新显示
        this.updateAllDisplays();
        
        // 自动生成模拟信号
        setTimeout(() => {
            this.generateSimulatedSignal();
        }, 5000);
    }
    
    generateSimulatedSignal() {
        const rsi = this.state.indicators.rsi;
        let action = 'HOLD';
        let reason = '';
        
        if (rsi < 30) {
            action = 'BUY';
            reason = `模拟: RSI超卖(${rsi.toFixed(1)})`;
        } else if (rsi > 70) {
            action = 'SELL';
            reason = `模拟: RSI超买(${rsi.toFixed(1)})`;
        } else {
            reason = `模拟: RSI中性(${rsi.toFixed(1)})`;
        }
        
        if (action !== 'HOLD') {
            const signal = {
                action,
                confidence: (0.6 + Math.random() * 0.3).toFixed(2),
                price: this.state.currentPrice.toFixed(2),
                reason,
                rsi: rsi.toFixed(2),
                timestamp: new Date().toISOString(),
                id: `sim_${Date.now()}`
            };
            
            const trade = this.createTradeRecord(signal);
            this.state.activeTrade = trade;
            this.addToHistory(trade);
            this.displaySignal(trade);
            this.updateTradeStatus('进行中', '模拟交易执行中...');
            
            console.log(`🎮 模拟信号: ${action}`);
        }
    }
    
    // ==================== 公共方法 ====================
    
    manualGenerateSignal() {
        if (confirm('确定要手动生成信号吗？这可能会跳过冷却时间。')) {
            this.state.cooldownEnd = null;
            this.generateSignal();
        }
    }
    
    manualCheckTrade() {
        if (this.state.activeTrade) {
            this.checkTradeConditions();
            alert('已手动检查交易状态！');
        } else {
            alert('当前没有活跃交易');
        }
    }
    
    resetSystem() {
        if (confirm('确定要重置系统吗？这将清除所有历史数据！')) {
            localStorage.removeItem('trading_signals');
            localStorage.removeItem('trading_state');
            
            // 重置状态
            this.state = {
                currentPrice: 0,
                indicators: {
                    rsi: 50,
                    trend: 'neutral',
                    volatility: 0,
                    support: 0,
                    resistance: 0,
                    pricePosition: 50
                },
                activeTrade: null,
                signalHistory: [],
                stats: {
                    totalTrades: 0,
                    winningTrades: 0,
                    totalPnL: 0,
                    currentStreak: 0,
                    bestStreak: 0,
                    maxWin: 0,
                    maxLoss: 0,
                    avgWin: 0,
                    avgLoss: 0
                },
                cooldownEnd: null,
                isRunning: false,
                isInitialized: false
            };
            
            this.priceData = [];
            this.candles = [];
            
            // 停止定时器
            this.stopAutoMode();
            
            // 更新显示
            this.updateAllDisplays();
            
            // 重新启动
            setTimeout(() => {
                this.init();
            }, 1000);
            
            this.showStatus('系统已重置', 'success');
            console.log('🔄 系统已重置');
        }
    }
    
    exportData() {
        if (this.state.signalHistory.length === 0) {
            alert('没有可导出的数据');
            return;
        }
        
        const data = {
            signals: this.state.signalHistory,
            stats: this.state.stats,
            config: this.config,
            exportTime: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const fileName = `trading_data_${new Date().toISOString().slice(0, 10)}.json`;
        
        const link = document.createElement('a');
        link.setAttribute('href', dataUri);
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showStatus(`已导出 ${this.state.signalHistory.length} 条记录`, 'success');
    }
}

// ==================== 全局函数（保持兼容性） ====================

// 创建全局实例
let tradingSystem = null;

// 初始化函数
function initTradingSystem() {
    if (!tradingSystem) {
        tradingSystem = new AutoTradingSystem();
        tradingSystem.init();
    }
    return tradingSystem;
}

// 公共API函数
function manualCheckTP_SL() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.manualCheckTrade) {
        system.manualCheckTrade();
    } else {
        alert('系统未初始化');
    }
}

function forceNewSignal() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.manualGenerateSignal) {
        system.manualGenerateSignal();
    } else {
        alert('系统未初始化');
    }
}

function refreshAllData() {
    const system = window.tradingSystem || tradingSystem;
    if (system) {
        system.loadInitialData().then(() => {
            alert('数据刷新完成！');
        }).catch(() => {
            alert('数据刷新失败');
        });
    } else {
        alert('系统未初始化');
    }
}

function resetSystem() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.resetSystem) {
        system.resetSystem();
    } else {
        if (confirm('系统未初始化，确定要重置吗？')) {
            localStorage.clear();
            location.reload();
        }
    }
}

function exportSignals() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.exportData) {
        system.exportData();
    } else {
        alert('系统未初始化');
    }
}

function testAPIConnection() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.testConnection) {
        system.testConnection()
            .then(() => alert('✅ API连接正常'))
            .catch(() => alert('❌ API连接失败'));
    } else {
        alert('系统未初始化');
    }
}

function startAutoMode() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.startAutoMode) {
        system.startAutoMode();
        alert('自动模式已启动');
    } else {
        alert('系统未初始化');
    }
}

function stopAutoMode() {
    const system = window.tradingSystem || tradingSystem;
    if (system && system.stopAutoMode) {
        system.stopAutoMode();
        alert('自动模式已停止');
    } else {
        alert('系统未初始化');
    }
}

// ==================== 页面加载初始化 ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📈 BTC/USDT 自动交易系统加载中...');
    console.log('🕒 启动时间:', new Date().toLocaleString('zh-CN'));
    
    // 显示启动信息
    const welcomeMsg = `
╔═══════════════════════════════════════════╗
║   🚀 BTC/USDT 自动交易系统 v2.0           ║
║                                            ║
║   系统特性:                               ║
║   • 全自动运行，无需人工干预              ║
║   • 所有访问者信号一致                    ║
║   • 智能分析，详细信号原因                ║
║   • 优化风险控制 (SL:1.2%, TP:1.5%/3%)   ║
║   • 自动检测TP/SL，完成才给新信号         ║
║                                            ║
║   数据源: OKX交易所 API                   ║
║   时间框架: 15分钟                         ║
╚═══════════════════════════════════════════╝
    `;
    console.log(welcomeMsg);
    
    // 初始化系统
    tradingSystem = initTradingSystem();
    
    // 暴露到全局
    window.tradingSystem = tradingSystem;
    
    // 添加一些实用函数
    window.getTradingSystem = () => tradingSystem;
    
    // 添加错误处理
    window.addEventListener('error', function(event) {
        console.error('全局错误:', event.error);
        const statusElement = document.getElementById('systemStatus');
        if (statusElement) {
            statusElement.textContent = '❌ 系统错误，请刷新页面';
            statusElement.className = 'text-red-400';
        }
    });
    
    // 页面可见性变化处理
    document.addEventListener('visibilitychange', function() {
        if (tradingSystem && tradingSystem.state.isRunning) {
            if (document.hidden) {
                console.log('页面隐藏，暂停部分更新');
            } else {
                console.log('页面显示，恢复正常更新');
                tradingSystem.loadInitialData().catch(console.error);
            }
        }
    });
});

// ==================== 工具函数 ====================

// 格式化数字
function formatNumber(num, decimals = 2) {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// 格式化货币
function formatCurrency(amount) {
    return '$' + formatNumber(amount);
}

// 计算百分比变化
function calculatePercentChange(oldPrice, newPrice) {
    return ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 节流函数
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 模拟API延迟（开发用）
function simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 导出全局函数
if (typeof window !== 'undefined') {
    window.manualCheckTP_SL = manualCheckTP_SL;
    window.forceNewSignal = forceNewSignal;
    window.refreshAllData = refreshAllData;
    window.resetSystem = resetSystem;
    window.exportSignals = exportSignals;
    window.testAPIConnection = testAPIConnection;
    window.startAutoMode = startAutoMode;
    window.stopAutoMode = stopAutoMode;
}

console.log('✅ JavaScript代码加载完成');