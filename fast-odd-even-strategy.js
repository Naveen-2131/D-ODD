class FastOddEvenStrategy {
    constructor(config = {}) {
        this.bot = null;
        this.isRunning = false;

        // Limits
        this.tradeCount = 0;
        this.maxTrades = config.maxTrades || 99999;

        // Strategy Parameters
        this.baseStake = config.baseStake || 0.35;
        this.stake = this.baseStake;
        this.martingaleStakes = config.martingaleStakes || [0.35, 0.45, 0.90, 1.86, 3.82, 7.82, 16.03, 32.85];
        this.martingaleLevel = 0;
        this.maxMartingaleLevel = this.martingaleStakes.length - 1;

        this.duration = 1;
        this.durationUnit = 't';

        // State
        this.lastContractId = null;
        this.waitingForExit = false;
        this.tickHistory = [];

        // Rate Limiting
        this.minInterval = config.minInterval || 2000;
        this.lastTradeTime = 0;

        // Profit/Loss Tracking & Cooldown
        this.sessionProfit = 0;
        this.takeProfit = config.takeProfit || 1.00;
        this.stopLoss = config.stopLoss || -50;
        this.isInCooldown = false;
        this.cooldownDuration = config.cooldownDuration || 120000;
        this.cooldownEndTime = null;
    }

    handleCommand(command) {
        const cmd = command.toLowerCase();
        if (cmd === 'start') {
            this.start();
        } else if (cmd === 'stop') {
            this.stop();
        } else {
            console.log(`Unknown command: ${cmd} `);
        }
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            console.log('>>> FAST ODD/EVEN STRATEGY STARTED ( > 5 -> ODD) <<<');
            console.log(`Stake Sequence: [${this.martingaleStakes.join(', ')}]`);
            this.resetSession();
        }
    }

    stop() {
        this.isRunning = false;
        console.log('>>> STRATEGY STOPPED <<<');
    }

    resetSession() {
        this.tradeCount = 0;
        this.stake = this.baseStake;
        this.martingaleLevel = 0;
        this.lastContractId = null;
        this.waitingForExit = false;
        this.sessionProfit = 0;
        this.isInCooldown = false;
        this.cooldownEndTime = null;
    }

    onStart(bot) {
        this.bot = bot;
        console.log('Fast Odd/Even Strategy Loaded.');
    }

    async onTick(tick) {
        if (!this.isRunning) return;

        const now = Date.now();

        // Check if in cooldown period
        if (this.isInCooldown) {
            if (now >= this.cooldownEndTime) {
                console.log('>>> COOLDOWN COMPLETE - RESTARTING SESSION <<<');
                this.resetSession();
                this.lastTradeTime = now;
            } else {
                return;
            }
        }

        // 1. Check Previous Trade if exists
        if (this.lastContractId) {
            if (this.waitingForExit) {
                const contract = await this.bot.checkContract(this.lastContractId);
                if (contract && contract.is_sold) {
                    const profit = parseFloat(contract.profit);
                    this.sessionProfit += profit;

                    console.log(`Contract ${this.lastContractId} Closed.Profit: $${profit.toFixed(2)} `);
                    console.log(`📊 Session Profit: $${this.sessionProfit.toFixed(2)} `);

                    // Check limits
                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(`🛑 Session End.Profit: $${this.sessionProfit.toFixed(2)} `);
                        this.isInCooldown = true;
                        this.cooldownEndTime = now + this.cooldownDuration;
                        this.waitingForExit = false;
                        this.lastContractId = null;
                        return;
                    }

                    if (profit > 0) {
                        console.log(`✅ WIN! Resetting stake.`);
                        this.stake = this.baseStake;
                        this.martingaleLevel = 0;
                    } else {
                        this.martingaleLevel++;
                        if (this.martingaleLevel > this.maxMartingaleLevel) {
                            console.log(`⚠️  Max Level Reached.Resetting.`);
                            this.martingaleLevel = 0;
                        }
                        this.stake = this.martingaleStakes[this.martingaleLevel] || this.baseStake * 2; // Fallback
                        console.log(`❌ LOSS.Next Stake = $${this.stake} `);
                    }

                    this.lastContractId = null;
                    this.waitingForExit = false;
                    this.lastTradeTime = now;
                } else {
                    return;
                }
            }
        }

        const quoteStr = Number(tick.quote).toFixed(2);
        const currentDigit = parseInt(quoteStr.slice(-1));

        this.tickHistory.push(currentDigit);
        if (this.tickHistory.length > 5) this.tickHistory.shift();

        if (now - this.lastTradeTime < this.minInterval) {
            return;
        }

        // Tick logging removed to reduce spam

        if (this.waitingForExit) return;

        // --- Logic: If digit > 5 -> Trade ODD ---
        let contractType = null;
        let prediction = null;

        if (currentDigit > 5) {
            contractType = 'DIGITODD';
            console.log(`⚡ Signal: Digit ${currentDigit} > 5. Trading ODD.`);
        }

        // Execute Trade
        if (contractType) {
            console.log(`Buying ${contractType} at $${this.stake}...`);
            this.tradeCount++;
            this.waitingForExit = true;

            try {
                const trade = await this.bot.buy(contractType, this.stake, this.duration, this.durationUnit, prediction);
                if (trade && trade.contract_id) {
                    this.lastContractId = trade.contract_id;
                    console.log(`Trade Executed! ID: ${trade.contract_id} `);
                } else {
                    this.waitingForExit = false;
                }
            } catch (e) {
                console.error('Buy Failed:', e);
                this.waitingForExit = false;
            }
        }
    }
}
http://localhost:3000/bot-panel.html
module.exports = FastOddEvenStrategy;
