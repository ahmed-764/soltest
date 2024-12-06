# Solana Wallet Tracker

A comprehensive web application for tracking Solana wallet transactions, balances, and activity in real-time.

## Setup Instructions

### 1. Install Solana Tool Suite

Windows Installation:
```bash
# Download and run the Solana installer
curl https://release.solana.com/v1.17.9/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install-tmp\solana-install-init.exe --create-dirs
C:\solana-install-tmp\solana-install-init.exe v1.17.9
```

### 2. Configure Solana CLI

```bash
# Set default RPC endpoint
solana config set --url https://api.mainnet-beta.solana.com

# For WebSocket connections
solana config set --ws wss://api.mainnet-beta.solana.com
```

### 3. Project Dependencies

```bash
# Install project dependencies
npm install @solana/web3.js
npm install @solana/spl-token
```

### 4. Environment Setup

Create a `.env` file in the project root with your Chainstack credentials:
```
CHAINSTACK_ENDPOINT=your_chainstack_endpoint
CHAINSTACK_WSS_ENDPOINT=your_chainstack_wss_endpoint
CHAINSTACK_USERNAME=your_username
CHAINSTACK_PASSWORD=your_password
```

## Usage

1. Start a local server (e.g., using Live Server in VS Code)
2. Open index.html in your browser
3. Enter a Solana wallet address to track
4. View real-time transaction history, balance updates, and wallet activity

## Features

- Real-time wallet balance tracking
- Transaction history with detailed information
- WebSocket integration for live updates
- Support for SOL and SPL tokens
- Comprehensive error handling and rate limit management

## API Integration

### JSON-RPC Example
```javascript
// Get account balance
curl -X POST https://your-chainstack-endpoint \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"getBalance",
    "params":["wallet_address"]
  }'
```

### Web3.js Example
```javascript
const web3 = require("@solana/web3.js");
const connection = new web3.Connection(ENDPOINT);
const balance = await connection.getBalance(publicKey);
```

## Troubleshooting

1. Rate Limiting
   - The app automatically handles rate limits by switching between multiple RPC endpoints
   - Default endpoints include Solana Mainnet, Project Serum, and Ankr

2. WebSocket Connection
   - If WebSocket connection fails, the app will fallback to HTTP polling
   - Ensure proper WebSocket endpoint configuration in the .env file

3. Common Issues
   - Invalid wallet address format
   - RPC endpoint connectivity
   - Rate limit exceeded
