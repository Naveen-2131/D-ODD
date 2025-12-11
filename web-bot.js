const express = require('express');
const path = require('path');
const DerivAPI = require('@deriv/deriv-api');
const WebSocket = require('ws');
const FastOddEvenStrategy = require('./fast-odd-even-strategy');

// Capture original console.log to prevent recursion
const serverLog = console.log;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve bot panel as default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bot-panel.html'));
});

// Bot state
let botInstance = null;
let strategyInstance = null;
let apiConnection = null;
let logs = [];
let currentConfig = null;
let currentBalance = 0;
let accountCurrency = 'USD';

// Add log with limit
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    logs.push({ timestamp, message });
    if (logs.length > 100) logs.shift();
    // Use serverLog to avoid recursive loop with overridden console.log
    serverLog(`[${timestamp}] ${message}`);
}

// Override console.log globally to capture strategy output
console.log = function (...args) {
    try {
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        // Only log important messages (skip tick data spam)
        const isImportant =
            message.includes('Trade') ||
            message.includes('WIN') ||
            message.includes('LOSS') ||
            message.includes('Signal') ||
            message.includes('Buying') ||
            message.includes('Error') ||
            message.includes('Session') ||
            message.includes('COOLDOWN') ||
            message.includes('STARTED') ||
            message.includes('STOPPED') ||
            message.includes('Balance') ||
            message.includes('Authorized') ||
            message.includes('Subscribed') ||
            message.includes('Connecting');

        if (isImportant) {
            addLog(message);
        } else {
            // Still print unimportant logs to server console for debug, but don't add to UI logs
            // serverLog(message); 
        }
    } catch (e) {
        serverLog(args.join(' '));
    }
};

// API Endpoints
app.get('/api/config', (req, res) => {
    res.json({
        appId: process.env.DERIV_APP_ID || '115442',
        token: process.env.DERIV_API_TOKEN || '',
        symbol: 'R_100',
        maxTrades: 99999,
        baseStake: 0.35,
        martingaleStakes: '0.35, 0.45, 0.90, 1.86, 3.82, 7.82, 16.03, 32.85',
        overUnderStakes: '0.35, 0.45, 0.90, 1.86, 3.82, 7.82, 16.03, 32.85',
        takeProfit: 1.00,
        stopLoss: -50,
        cooldownDuration: 120000,
        minInterval: 2000
    });
});

app.post('/api/start', async (req, res) => {
    try {
        if (strategyInstance && strategyInstance.isRunning) {
            return res.status(400).json({ error: 'Bot is already running' });
        }

        // Clear old logs
        logs = [];

        const config = req.body;
        currentConfig = config;

        // Parse martingale stakes
        const martingaleStakes = config.martingaleStakes
            .split(',')
            .map(s => parseFloat(s.trim()))
            .filter(n => !isNaN(n));

        // Parse over/under stakes
        const overUnderStakes = (config.overUnderStakes || config.martingaleStakes)
            .split(',')
            .map(s => parseFloat(s.trim()))
            .filter(n => !isNaN(n));

        // Create strategy with config
        strategyInstance = new FastOddEvenStrategy({
            maxTrades: parseInt(config.maxTrades),
            baseStake: parseFloat(config.baseStake),
            martingaleStakes: martingaleStakes,
            overUnderStakes: overUnderStakes,
            takeProfit: parseFloat(config.takeProfit),
            stopLoss: parseFloat(config.stopLoss),
            cooldownDuration: parseInt(config.cooldownDuration),
            minInterval: parseInt(config.minInterval)
        });

        // Create API connection
        const wsUrl = `wss://ws.binaryws.com/websockets/v3?app_id=${config.appId}`;
        apiConnection = new WebSocket(wsUrl);
        const api = new DerivAPI({ connection: apiConnection });

        addLog('🚀 Connecting to Deriv API...');

        // Wait for connection
        await new Promise((resolve, reject) => {
            apiConnection.on('open', resolve);
            apiConnection.on('error', reject);
            setTimeout(() => reject(new Error('Connection timeout')), 10000);
        });

        // Authorize
        const account = await api.account(config.token);

        // Extract balance value (might be object or number)
        let balanceValue = account.balance;
        if (typeof balanceValue === 'object' && balanceValue !== null) {
            balanceValue = balanceValue.value || balanceValue.display || 0;
        }
        balanceValue = parseFloat(balanceValue) || 0;

        addLog(`✅ Authorized as: ${account.fullname} (${account.loginid})`);
        addLog(`💰 Balance: ${account.currency} ${balanceValue.toFixed(2)}`);
        currentBalance = balanceValue;
        accountCurrency = account.currency;

        // Setup Bot Interface
        const botInterface = {
            api: api,
            balance: account.balance,

            checkContract: async (contractId) => {
                try {
                    const openContracts = await api.basic.proposalOpenContract({
                        contract_id: contractId
                    });

                    if (openContracts.proposal_open_contract) {
                        const contract = openContracts.proposal_open_contract;
                        return {
                            is_sold: contract.is_sold,
                            profit: contract.profit,
                            status: contract.status
                        };
                    }
                    return null;
                } catch (e) {
                    addLog(`Error checking contract: ${e.message}`);
                    return null;
                }
            },

            buy: async (contractType, amount, duration, durationUnit, prediction) => {
                try {
                    const proposalParams = {
                        contract_type: contractType,
                        currency: account.currency,
                        symbol: config.symbol,
                        duration: duration,
                        duration_unit: durationUnit,
                        basis: 'stake',
                        amount: amount
                    };

                    if (prediction !== undefined && prediction !== null) {
                        proposalParams.barrier = prediction;
                    }

                    const proposal = await api.basic.proposal(proposalParams);

                    if (proposal.error) {
                        throw new Error(proposal.error.message);
                    }

                    const buy = await api.basic.buy({ buy: proposal.proposal.id, price: amount });

                    if (buy.error) {
                        throw new Error(buy.error.message);
                    }

                    return {
                        contract_id: buy.buy.contract_id,
                        buy_price: buy.buy.buy_price
                    };

                } catch (e) {
                    addLog(`Buy Error: ${e.message || e}`);
                    throw e;
                }
            }
        };

        // Start Strategy
        strategyInstance.onStart(botInterface);

        // Subscribe to Ticks
        const tickStream = await api.ticks(config.symbol);
        addLog(`📡 Subscribed to ${config.symbol} ticks...`);

        tickStream.onUpdate().subscribe(tick => {
            try {
                let quote;
                let epoch;

                if (tick.raw) {
                    quote = tick.raw.quote || tick.raw.ask || tick.raw.bid;
                    epoch = tick.raw.epoch;
                }

                if (quote === undefined) {
                    quote = tick.quote;
                }
                if (epoch === undefined) {
                    epoch = tick.epoch;
                }

                if (quote && typeof quote === 'object' && quote.value !== undefined) {
                    quote = quote.value;
                }

                if (quote !== undefined) {
                    strategyInstance.onTick({ quote, epoch });
                }
            } catch (e) {
                // Silently handle tick errors
            }
        });

        // Auto-start
        strategyInstance.start();

        res.json({ success: true, message: 'Bot started successfully' });

    } catch (error) {
        const errorMsg = error.message || error.toString() || 'Unknown error';
        addLog(`❌ Error: ${errorMsg}`);
        console.error('Full Error:', error); // Log to server console
        res.status(500).json({ error: errorMsg });
    }
});

app.post('/api/stop', (req, res) => {
    try {
        if (strategyInstance) {
            strategyInstance.stop();
            addLog('🛑 Bot stopped by user');
        }

        if (apiConnection) {
            apiConnection.close();
            apiConnection = null;
        }

        res.json({ success: true, message: 'Bot stopped' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        isRunning: strategyInstance ? strategyInstance.isRunning : false,
        sessionProfit: strategyInstance ? strategyInstance.sessionProfit : 0,
        tradeCount: strategyInstance ? strategyInstance.tradeCount : 0,
        balance: currentBalance,
        currency: accountCurrency,
        logs: logs.slice(-20) // Last 20 logs
    });
});

app.get('/api/logs', (req, res) => {
    res.json({ logs });
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 Bot Control Panel running on http://localhost:${PORT}`);
    console.log(`Open your browser and navigate to the URL above`);
});
