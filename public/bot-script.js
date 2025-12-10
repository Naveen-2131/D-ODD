// Bot Control Panel JavaScript
document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const sessionProfit = document.getElementById('sessionProfit');
    const tradeCount = document.getElementById('tradeCount');
    const liveBalance = document.getElementById('liveBalance');
    const logsContainer = document.getElementById('logsContainer');

    let pollInterval = null;

    // Load saved config from localStorage
    function loadConfig() {
        const saved = localStorage.getItem('botConfig');
        if (saved) {
            const config = JSON.parse(saved);
            Object.keys(config).forEach(key => {
                const el = document.getElementById(key);
                if (el) el.value = config[key];
            });
        }
    }

    // Save config to localStorage
    function saveConfig() {
        const config = getConfig();
        localStorage.setItem('botConfig', JSON.stringify(config));
    }

    // Get configuration from form
    function getConfig() {
        return {
            appId: document.getElementById('appId').value,
            token: document.getElementById('token').value,
            symbol: document.getElementById('symbol').value,
            maxTrades: document.getElementById('maxTrades').value,
            baseStake: document.getElementById('baseStake').value,
            martingaleStakes: document.getElementById('martingaleStakes').value,
            takeProfit: document.getElementById('takeProfit').value,
            stopLoss: document.getElementById('stopLoss').value,
            cooldownDuration: document.getElementById('cooldownDuration').value,
            minInterval: document.getElementById('minInterval').value
        };
    }

    // Update UI based on status
    function updateStatus(status) {
        if (status.isRunning) {
            statusDot.className = 'dot running';
            statusText.textContent = 'RUNNING';
            startBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            statusDot.className = 'dot stopped';
            statusText.textContent = 'STOPPED';
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }

        // Update profit display
        const profit = status.sessionProfit || 0;
        sessionProfit.textContent = `$${profit.toFixed(2)}`;
        sessionProfit.className = profit >= 0 ? 'stat-value profit' : 'stat-value loss';

        // Update trade count
        tradeCount.textContent = status.tradeCount || 0;

        // Update live balance
        if (status.balance !== undefined) {
            liveBalance.textContent = `${status.currency || '$'} ${status.balance.toFixed(2)}`;
        }

        // Update logs
        if (status.logs && status.logs.length > 0) {
            logsContainer.innerHTML = status.logs.map(log => {
                const isSuccess = log.message.includes('✅') || log.message.includes('WIN');
                const isError = log.message.includes('❌') || log.message.includes('Error');
                const className = isSuccess ? 'success' : (isError ? 'error' : '');
                return `<p class="log-entry ${className}"><span class="timestamp">[${log.timestamp}]</span>${log.message}</p>`;
            }).join('');
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }
    }

    // Poll for status updates
    function startPolling() {
        pollInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/status');
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const status = await response.json();
                    updateStatus(status);
                }
            } catch (error) {
                // Silently ignore polling errors
            }
        }, 1000);
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    // Start bot
    startBtn.addEventListener('click', async () => {
        const config = getConfig();

        if (!config.token) {
            alert('Please enter your Deriv API Token');
            return;
        }

        saveConfig();
        startBtn.disabled = true;
        statusText.textContent = 'STARTING...';

        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const result = await response.json();

            if (response.ok) {
                logsContainer.innerHTML = '<p class="log-entry success">Bot started successfully!</p>';
                startPolling();
            } else {
                alert(`Error: ${result.error}`);
                startBtn.disabled = false;
                statusText.textContent = 'STOPPED';
            }
        } catch (error) {
            alert(`Connection error: ${error.message}`);
            startBtn.disabled = false;
            statusText.textContent = 'STOPPED';
        }
    });

    // Stop bot
    stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        statusText.textContent = 'STOPPING...';

        try {
            const response = await fetch('/api/stop', { method: 'POST' });
            const result = await response.json();

            if (response.ok) {
                stopPolling();
                statusDot.className = 'dot stopped';
                statusText.textContent = 'STOPPED';
                startBtn.disabled = false;
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });

    // Initialize
    loadConfig();
    startPolling();
});
