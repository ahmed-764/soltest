// Initialize Solana connection with Chainstack endpoint
const CHAINSTACK_ENDPOINT = 'https://solana-mainnet.core.chainstack.com';
const WSS_ENDPOINT = 'wss://solana-mainnet.core.chainstack.com';

// Connection configuration
const connectionConfig = {
    httpHeaders: {
        'Authorization': 'Basic ' + btoa('unruffled-noether:dimple-simile-boxcar-jury-sulk-waggle')
    },
    commitment: 'confirmed',
    wsEndpoint: WSS_ENDPOINT
};

const connection = new solanaWeb3.Connection(CHAINSTACK_ENDPOINT, connectionConfig);
let wsConnection = null;
let walletSubscription = null;

// DOM Elements
const walletInput = document.getElementById('wallet-address');
const trackButton = document.getElementById('track-wallet');
const dashboard = document.getElementById('dashboard');
const solAmount = document.getElementById('sol-amount');
const tokenList = document.getElementById('token-list');
const transactionsTable = document.getElementById('transactions').getElementsByTagName('tbody')[0];
const nftGrid = document.getElementById('nft-grid');
const liveUpdates = document.getElementById('live-updates');

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
            updateNFTs(address)
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
        const signatures = await connection.getConfirmedSignaturesForAddress2(publicKey, { limit: 10 });
        
        transactionsTable.innerHTML = '';
        for (const sig of signatures) {
            const tx = await connection.getTransaction(sig.signature);
            if (!tx) continue;

            const row = document.createElement('tr');
            const date = new Date(tx.blockTime * 1000);
            const amount = tx.meta?.postBalances[0] - tx.meta?.preBalances[0];
            const type = amount > 0 ? 'Received' : 'Sent';
            
            row.innerHTML = `
                <td>${date.toLocaleString()}</td>
                <td class="${type.toLowerCase()}">${type}</td>
                <td>${Math.abs(amount / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4)} SOL</td>
                <td><a href="https://explorer.solana.com/tx/${sig.signature}" target="_blank">${sig.signature.slice(0, 8)}...</a></td>
            `;
            transactionsTable.appendChild(row);
        }
    } catch (error) {
        console.error('Error updating transactions:', error);
        showError('Failed to fetch transaction history');
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

function toggleLiveUpdates(event) {
    const address = walletInput.value.trim();
    if (!isValidAddress(address)) {
        event.target.checked = false;
        showError('Please enter a valid wallet address first');
        return;
    }

    if (event.target.checked) {
        try {
            wsConnection = new WebSocket(WSS_ENDPOINT);
            
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
