// RPC Configuration
const RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana'
];

let currentRpcIndex = 0;
let connection;

function getNextRpcEndpoint() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_ENDPOINTS.length;
    return RPC_ENDPOINTS[currentRpcIndex];
}

function createConnection() {
    const endpoint = RPC_ENDPOINTS[currentRpcIndex];
    return new solanaWeb3.Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
        fetch: (url, options) => {
            return fetch(url, {
                ...options,
                headers: {
                    ...options?.headers,
                    'Content-Type': 'application/json',
                },
            });
        }
    });
}

// Initialize connection
connection = createConnection();

// Rate limiting configuration
const REQUEST_BATCH_SIZE = 3;
const BATCH_DELAY_MS = 1000;
const MAX_RETRIES = 3;

async function retryWithFallback(operation, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error);
            
            if (error.message.includes('rate limit') || error.message.includes('429')) {
                if (i < retries - 1) {
                    // Switch to next RPC endpoint
                    connection = new solanaWeb3.Connection(getNextRpcEndpoint());
                    await delay(BATCH_DELAY_MS); // Wait before retry
                    continue;
                }
            }
            throw error;
        }
    }
}

// DOM Elements
const walletInput = document.getElementById('wallet-address');
const trackButton = document.getElementById('track-wallet');
const dashboard = document.getElementById('dashboard');
const solAmount = document.getElementById('sol-amount');
const tokenList = document.getElementById('token-list');
const transactionsTable = document.getElementById('transactions').getElementsByTagName('tbody')[0];
const nftGrid = document.getElementById('nft-grid');
const liveUpdates = document.getElementById('live-updates');

// PnL Elements
const totalPnl = document.getElementById('total-pnl');
const roiPercentage = document.getElementById('roi-percentage');
const totalVolume = document.getElementById('total-volume');

// Activity Elements
const tx24h = document.getElementById('24h-tx-count');
const tx7d = document.getElementById('7d-tx-count');
const tx30dVolume = document.getElementById('30d-volume');
const activityChart = document.getElementById('activity-chart').getContext('2d');

// Load Chart.js
const chartScript = document.createElement('script');
chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js';
document.head.appendChild(chartScript);

let activityChartInstance = null;

// Event Listeners
trackButton.addEventListener('click', trackWallet);
liveUpdates.addEventListener('change', toggleLiveUpdates);

async function trackWallet() {
    const address = walletInput.value.trim();
    if (!isValidAddress(address)) {
        alert('Please enter a valid Solana wallet address');
        return;
    }

    try {
        dashboard.classList.remove('hidden');
        await Promise.all([
            updateBalance(address),
            updateTransactions(address),
            updateNFTs(address),
            calculatePnL(address),
            updateWalletActivity(address)
        ]);
    } catch (error) {
        console.error('Error tracking wallet:', error);
        alert('Error tracking wallet. Please try again.');
    }
}

function isValidAddress(address) {
    try {
        const publicKey = new solanaWeb3.PublicKey(address);
        return true;
    } catch {
        return false;
    }
}

async function updateBalance(address) {
    try {
        const publicKey = new solanaWeb3.PublicKey(address);
        
        // Add loading state
        solAmount.textContent = 'Loading...';
        
        const balance = await connection.getBalance(publicKey, 'confirmed');
        solAmount.textContent = `${(balance / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4)} SOL`;

        // Fetch SPL tokens with proper error handling
        try {
            const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
                programId: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
            });

            tokenList.innerHTML = '';
            for (const { account, pubkey } of tokenAccounts.value) {
                try {
                    const accountInfo = solanaWeb3.AccountLayout.decode(account.data);
                    const mint = new solanaWeb3.PublicKey(accountInfo.mint);
                    const tokenBalance = Number(accountInfo.amount);
                    
                    const tokenInfo = document.createElement('div');
                    tokenInfo.className = 'token-item';
                    tokenInfo.innerHTML = `
                        <span class="token-amount">${tokenBalance}</span>
                        <span class="token-address">${mint.toString()}</span>
                    `;
                    tokenList.appendChild(tokenInfo);
                } catch (tokenError) {
                    console.error('Error processing token:', tokenError);
                }
            }
        } catch (tokenError) {
            console.error('Error fetching tokens:', tokenError);
            showError('Unable to fetch token balances');
        }
    } catch (error) {
        console.error('Error updating balance:', error);
        solAmount.textContent = 'Error loading balance';
        showError('Failed to fetch wallet balance. Please check your connection and try again.');
        throw error;
    }
}

async function updateTransactions(address) {
    try {
        const publicKey = new solanaWeb3.PublicKey(address);
        
        transactionsTable.innerHTML = '<tr><td colspan="4" class="loading-text">Loading transactions...</td></tr>';
        
        // Fetch signatures with retries and fallback
        const signatures = await retryWithFallback(async () => {
            return await connection.getConfirmedSignaturesForAddress2(
                publicKey,
                {
                    limit: 10, // Reduced limit
                    commitment: 'confirmed'
                }
            );
        });
        
        if (signatures.length === 0) {
            transactionsTable.innerHTML = '<tr><td colspan="4" class="no-data">No transactions found</td></tr>';
            return;
        }

        transactionsTable.innerHTML = '';
        
        // Process transactions in smaller batches with retries
        const transactions = [];
        for (let i = 0; i < signatures.length; i += REQUEST_BATCH_SIZE) {
            const batch = signatures.slice(i, i + REQUEST_BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(sig => 
                    retryWithFallback(async () => {
                        try {
                            return await connection.getTransaction(sig.signature, {
                                commitment: 'confirmed',
                                maxSupportedTransactionVersion: 0
                            });
                        } catch (error) {
                            console.error('Error fetching transaction:', error);
                            return null;
                        }
                    })
                )
            );
            transactions.push(...batchResults);
            await delay(BATCH_DELAY_MS);
        }

        let hasValidTransactions = false;

        transactions.forEach((tx, index) => {
            if (!tx) return;
            hasValidTransactions = true;

            const signature = signatures[index].signature;
            const row = document.createElement('tr');
            
            try {
                const date = new Date(tx.blockTime * 1000);
                const preBalance = tx.meta.preBalances[0];
                const postBalance = tx.meta.postBalances[0];
                const amount = (postBalance - preBalance) / solanaWeb3.LAMPORTS_PER_SOL;
                const type = amount >= 0 ? 'Received' : 'Sent';
                const fee = tx.meta.fee / solanaWeb3.LAMPORTS_PER_SOL;
                const status = tx.meta.err ? 'Failed' : 'Success';
                
                row.innerHTML = `
                    <td>${date.toLocaleString()}</td>
                    <td>
                        <span class="tx-type ${type.toLowerCase()}">${type}</span>
                        <span class="tx-status ${status.toLowerCase()}">${status}</span>
                    </td>
                    <td>
                        <span class="amount ${type.toLowerCase()}">
                            ${Math.abs(amount).toFixed(4)} SOL
                        </span>
                        ${fee > 0 ? `<span class="fee">Fee: ${fee.toFixed(6)} SOL</span>` : ''}
                    </td>
                    <td>
                        <a href="https://explorer.solana.com/tx/${signature}" 
                           target="_blank" 
                           title="View on Solana Explorer">
                            ${signature.slice(0, 8)}...${signature.slice(-8)}
                        </a>
                    </td>
                `;
            } catch (err) {
                console.error('Error processing transaction:', err);
                row.innerHTML = `
                    <td colspan="4" class="error-text">
                        Error processing transaction ${signature.slice(0, 8)}...
                    </td>
                `;
            }
            
            transactionsTable.appendChild(row);
        });

        if (!hasValidTransactions) {
            transactionsTable.innerHTML = `
                <tr>
                    <td colspan="4" class="no-data">
                        No valid transactions found in the recent history
                    </td>
                </tr>
            `;
        }

    } catch (error) {
        console.error('Error updating transactions:', error);
        const errorMessage = error.message.includes('rate limit') 
            ? 'Rate limit reached. Switching to alternate RPC endpoint...'
            : 'Failed to fetch transaction history. Please try again.';
            
        transactionsTable.innerHTML = `
            <tr>
                <td colspan="4" class="error-text">
                    ${errorMessage}
                </td>
            </tr>
        `;
        showError(errorMessage);
    }
}

async function updateNFTs(address) {
    try {
        const publicKey = new solanaWeb3.PublicKey(address);
        const nftAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        });

        nftGrid.innerHTML = '';
        for (const { account } of nftAccounts.value) {
            if (account.data.parsed.info.tokenAmount.amount === '1' && 
                account.data.parsed.info.tokenAmount.decimals === 0) {
                
                const nftItem = document.createElement('div');
                nftItem.className = 'nft-item';
                nftItem.innerHTML = `
                    <div class="nft-info">
                        <p class="nft-name">NFT Token</p>
                        <p class="nft-mint">${account.data.parsed.info.mint}</p>
                    </div>
                `;
                nftGrid.appendChild(nftItem);
            }
        }
    } catch (error) {
        console.error('Error updating NFTs:', error);
        showError('Failed to fetch NFTs');
    }
}

async function calculatePnL(address) {
    try {
        const publicKey = new solanaWeb3.PublicKey(address);
        const signatures = await connection.getConfirmedSignaturesForAddress2(publicKey, { limit: 1000 });
        
        let totalPnLValue = 0;
        let totalVolumeValue = 0;
        let initialBalance = 0;
        
        for (const sig of signatures.reverse()) {
            try {
                const tx = await connection.getTransaction(sig.signature);
                if (!tx) continue;

                const preBalance = tx.meta.preBalances[0];
                const postBalance = tx.meta.postBalances[0];
                const balanceChange = (postBalance - preBalance) / solanaWeb3.LAMPORTS_PER_SOL;
                
                if (initialBalance === 0) {
                    initialBalance = preBalance / solanaWeb3.LAMPORTS_PER_SOL;
                }

                if (balanceChange !== 0) {
                    totalPnLValue += balanceChange;
                    totalVolumeValue += Math.abs(balanceChange);
                }
            } catch (txError) {
                console.error('Error processing transaction:', txError);
            }
        }

        // Update PnL display
        totalPnl.textContent = `${totalPnLValue.toFixed(4)} SOL`;
        totalPnl.className = totalPnLValue >= 0 ? 'positive' : 'negative';

        // Calculate and update ROI
        const roi = initialBalance !== 0 ? (totalPnLValue / initialBalance) * 100 : 0;
        roiPercentage.textContent = `${roi.toFixed(2)}%`;
        roiPercentage.className = roi >= 0 ? 'positive' : 'negative';

        // Update total volume
        totalVolume.textContent = `${totalVolumeValue.toFixed(4)} SOL`;

    } catch (error) {
        console.error('Error calculating PnL:', error);
        showError('Failed to calculate PnL');
    }
}

async function updateWalletActivity(address) {
    try {
        const publicKey = new solanaWeb3.PublicKey(address);
        const currentTime = new Date();
        const oneDayAgo = new Date(currentTime - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(currentTime - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(currentTime - 30 * 24 * 60 * 60 * 1000);

        const signatures = await connection.getConfirmedSignaturesForAddress2(publicKey, { limit: 1000 });
        
        let tx24hCount = 0;
        let tx7dCount = 0;
        let volume30d = 0;
        const dailyVolumes = new Array(30).fill(0);

        for (const sig of signatures) {
            try {
                const tx = await connection.getTransaction(sig.signature);
                if (!tx || !tx.blockTime) continue;

                const txDate = new Date(tx.blockTime * 1000);
                const balanceChange = Math.abs(tx.meta.postBalances[0] - tx.meta.preBalances[0]) / solanaWeb3.LAMPORTS_PER_SOL;

                if (txDate >= oneDayAgo) {
                    tx24hCount++;
                }
                if (txDate >= sevenDaysAgo) {
                    tx7dCount++;
                }
                if (txDate >= thirtyDaysAgo) {
                    volume30d += balanceChange;
                    const daysAgo = Math.floor((currentTime - txDate) / (24 * 60 * 60 * 1000));
                    if (daysAgo < 30) {
                        dailyVolumes[daysAgo] += balanceChange;
                    }
                }
            } catch (txError) {
                console.error('Error processing transaction:', txError);
            }
        }

        // Update activity stats
        tx24h.textContent = tx24hCount;
        tx7d.textContent = tx7dCount;
        tx30dVolume.textContent = `${volume30d.toFixed(2)} SOL`;

        // Update activity chart
        if (window.Chart && activityChart) {
            if (activityChartInstance) {
                activityChartInstance.destroy();
            }

            const labels = Array.from({length: 30}, (_, i) => `${29 - i}d ago`).reverse();
            
            activityChartInstance = new Chart(activityChart, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Daily Volume (SOL)',
                        data: dailyVolumes.reverse(),
                        borderColor: '#00FFA3',
                        backgroundColor: 'rgba(0, 255, 163, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: '#B0B0B0'
                            }
                        },
                        x: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: '#B0B0B0',
                                maxRotation: 45,
                                minRotation: 45
                            }
                        }
                    }
                }
            });
        }

    } catch (error) {
        console.error('Error updating wallet activity:', error);
        showError('Failed to update wallet activity');
    }
}

function toggleLiveUpdates(event) {
    const address = walletInput.value.trim();
    if (!isValidAddress(address)) {
        event.target.checked = false;
        showError('Please enter a valid wallet address first');
        return;
    }

    if (event.target.checked) {
        try {
            const endpoint = RPC_ENDPOINTS[currentRpcIndex].replace('https', 'wss');
            wsConnection = new WebSocket(endpoint);
            
            // Add authorization header to WebSocket connection
            wsConnection.onopen = () => {
                console.log('WebSocket connected');
                // Send authentication message
                const authMessage = {
                    jsonrpc: '2.0',
                    method: 'auth',
                    params: ['unruffled-noether:dimple-simile-boxcar-jury-sulk-waggle'],
                    id: 0
                };
                wsConnection.send(JSON.stringify(authMessage));
                subscribeToUpdates(address);
            };
            
            wsConnection.onmessage = handleWebSocketMessage;
            wsConnection.onerror = (error) => {
                console.error('WebSocket error:', error);
                event.target.checked = false;
                showError('Live updates connection failed');
            };
            wsConnection.onclose = () => {
                console.log('WebSocket connection closed');
                event.target.checked = false;
            };
        } catch (error) {
            console.error('Error setting up WebSocket:', error);
            event.target.checked = false;
            showError('Failed to establish live updates connection');
        }
    } else {
        if (wsConnection) {
            wsConnection.close();
            wsConnection = null;
        }
    }
}

function subscribeToUpdates(address) {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        const subscribeMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'accountSubscribe',
            params: [
                address,
                { encoding: 'jsonParsed', commitment: 'confirmed' }
            ]
        };
        wsConnection.send(JSON.stringify(subscribeMessage));
    }
}

function handleWebSocketMessage(event) {
    const data = JSON.parse(event.data);
    if (data.method === 'accountNotification') {
        updateBalance(walletInput.value.trim());
        updateTransactions(walletInput.value.trim());
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
}
