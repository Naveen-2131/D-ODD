// FastOddEvenStrategy with Dual Logic (DIGITOVER4 + DIGITUNDER6)

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
        this.martingaleStakes = config.martingaleStakes || [0.35, 0.40, 0.80, 1.64];
        this.overUnderStakes = config.overUnderStakes || config.martingaleStakes || [0.35, 0.45, 0.90, 1.86, 3.82, 7.82, 16.03, 32.85];
        this.currentMode = 'ODD_EVEN';
        this.martingaleLevel = 0;
        this.maxMartingaleLevel = this.martingaleStakes.length - 1;

        this.duration = 1;
        this.durationUnit = 't';

        this.lastContractId = null;
        this.waitingForExit = false;
        this.tickHistory = [];

        // Rate Limiting
        this.minInterval = config.minInterval || 2000;
        this.lastTradeTime = 0;

        // Profit/Loss
        this.sessionProfit = 0;
        this.takeProfit = config.takeProfit || 1.00;
        this.stopLoss = config.stopLoss || -50;

        this.isInCooldown = false;
        this.cooldownDuration = config.cooldownDuration || 120000;
        this.cooldownEndTime = null;
    }

    handleCommand(command) {
        const cmd = command.toLowerCase();
        if (cmd === 'start') this.start();
        else if (cmd === 'stop') this.stop();
        else console.log(`Unknown command: ${cmd}`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            console.log('>>> FAST ODD/EVEN STRATEGY STARTED ( > 5 = ODD ) <<<');
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
        this.currentMode = 'ODD_EVEN';
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

        // Cooldown
        if (this.isInCooldown) {
            if (now >= this.cooldownEndTime) {
                console.log('>>> COOLDOWN COMPLETE - RESTARTING SESSION <<<');
                this.resetSession();
                this.lastTradeTime = now;
            } else return;
        }

        // Previous contract check
        if (this.lastContractId && this.waitingForExit) {
            const contract = await this.bot.checkContract(this.lastContractId);
            if (contract && contract.is_sold) {
                const profit = parseFloat(contract.profit);
                this.sessionProfit += profit;
                console.log(`Contract ${this.lastContractId} Closed. Profit: $${profit.toFixed(2)}`);
                console.log(`📊 Session Profit: $${this.sessionProfit.toFixed(2)}`);

                if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                    console.log(`🛑 Session End. Profit: $${this.sessionProfit.toFixed(2)}`);
                    this.isInCooldown = true;
                    this.cooldownEndTime = now + this.cooldownDuration;
                    this.waitingForExit = false;
                    this.lastContractId = null;
                    return;
                }

                if (profit > 0) {
                    console.log(`✅ WIN! (${this.currentMode})`);
                    if (this.currentMode === 'OVER_UNDER') {
                        console.log('>>> RECOVERY SUCCESS! Switching back to ODD_EVEN <<<');
                        this.currentMode = 'ODD_EVEN';
                    }
                    this.stake = this.baseStake;
                    this.martingaleLevel = 0;
                } else {
                    console.log(`❌ LOSS (${this.currentMode})`);
                    this.martingaleLevel++;

                    let currentStakes = (this.currentMode === 'ODD_EVEN') ? this.martingaleStakes : this.overUnderStakes;
                    let maxLevel = currentStakes.length - 1;

                    if (this.martingaleLevel > maxLevel) {
                        if (this.currentMode === 'ODD_EVEN') {
                            console.log('>>> MAX LEVEL REACHED (ODD/EVEN). Switching to OVER_UNDER <<<');
                            this.currentMode = 'OVER_UNDER';
                            this.martingaleLevel = 0;
                            currentStakes = this.overUnderStakes;
                        } else {
                            console.log('⚠️ Max Level Reached (OVER/UNDER). Resetting.');
                            this.martingaleLevel = 0;
                        }
                    }

                    this.stake = currentStakes[this.martingaleLevel] || this.baseStake * 2;
                    console.log(`Next Stake = $${this.stake} (${this.currentMode})`);
                }

                this.lastContractId = null;
                this.waitingForExit = false;
                this.lastTradeTime = now;
            }
            return;
        }

        const quoteStr = Number(tick.quote).toFixed(2);
        const currentDigit = parseInt(quoteStr.slice(-1));

        this.tickHistory.push(currentDigit);
        if (this.tickHistory.length > 5) this.tickHistory.shift();

        if (now - this.lastTradeTime < this.minInterval) return;
        if (this.waitingForExit) return;

        // --- MAIN STRATEGY ---
        if (this.currentMode === 'ODD_EVEN') {
            if (currentDigit === 1) {
                console.log(`⚡ ODD_EVEN Signal: Digit ${currentDigit} > 5 → ODD`);
                await this.executeTrade('DIGITODD');
                return;
            }
        }

        // --- OVER/UNDER RECOVERY WITH DUAL TRADES ---
        if (this.currentMode === 'OVER_UNDER') {
            if (currentDigit === 1) {
                console.log(`⚡ Recovery Signal: Digit 1 → Buying BOTH DIGITOVER 4 + DIGITUNDER 6`);

                await this.executeDual('DIGITOVER', 5);
                await this.executeDual('DIGITUNDER', 6);
                return;
            }
        }
    }

    // --- Single Trade ---
    async executeTrade(type, prediction = null) {
        try {
            console.log(`Buying ${type} @ $${this.stake}`);
            const trade = await this.bot.buy(type, this.stake, this.duration, this.durationUnit, prediction);

            if (trade && trade.contract_id) {
                this.lastContractId = trade.contract_id;
                this.waitingForExit = true;
                console.log(`Trade Executed → ID: ${trade.contract_id}`);
            }
        } catch (err) {
            console.log('Buy Failed:', err);
        }
    }

    // --- Dual Trade Executor ---
    async executeDual(type, prediction) {
        try {
            console.log(`Dual Buy → ${type} @ ${this.stake} (Pred: ${prediction})`);
            const trade = await this.bot.buy(type, this.stake, this.duration, this.durationUnit, prediction);

            if (trade && trade.contract_id) {
                this.lastContractId = trade.contract_id;
                this.waitingForExit = true;
                console.log(`Dual Trade Executed → ID: ${trade.contract_id}`);
            }
        } catch (e) {
            console.log(`Dual Buy Failed: ${type}`, e);
        }
    }
}

module.exports = FastOddEvenStrategy;
