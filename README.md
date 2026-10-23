# Ethereum Monitor

Ethereum Monitor monitors finalized native ETH transfers and ERC-20 Transfer events on Ethereum mainnet, storing transfers that match active configurations.

## Technologies

- Node.js
- Express
- Sequelize
- SQLite
- Ethers.js
- TypeScript
- Nodemon

## Requirements

- Node.js and npm
- An Infura project ID with Ethereum mainnet access, including WebSocket access

## Installation

```bash
git clone https://github.com/AngelGeorgievStoyanov/ethereum-monitor.git
cd ethereum-monitor
npm install
```

Create a `.env` file:

```env
INFURA_PROJECT_ID=your-infura-project-id
# Optional: defaults to the WebSocket endpoint for INFURA_PROJECT_ID
INFURA_WEBSOCKET_URL=wss://mainnet.infura.io/ws/v3/your-infura-project-id
DATABASE_URL=sqlite:./db.sqlite
```

## Running

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

The API listens on port 8080.

## Scanner behavior

- The scanner processes only finalized blocks, in ascending block order.
- For each block, the scanner fetches the full block and all block receipts in parallel using `Promise.all`; if either request fails, both are retried together with bounded exponential backoff.
- Native ETH transfers and successful ERC-20 `Transfer` logs are matched against active sender/recipient configuration filters.
- Stored records include `transferType` (`native` or `erc20`), `tokenAddress` for ERC-20 transfers, and `logIndex` to distinguish multiple token transfers in one transaction.
- During catch-up, it reads finalized blocks over HTTP and saves a persistent checkpoint after each fully processed block.
- Once caught up, it waits for new-block notifications over WebSocket, then checks the finalized block height over HTTP and processes only blocks that have finalized.
- If WebSocket disconnects, errors, or stops delivering block events, the scanner falls back to HTTP polling and retries the WebSocket connection.
- After a restart, scanning continues from the block after the saved checkpoint.
- If processing a block fails, the checkpoint does not advance and that block is retried.
- Only finalized direct native ETH transfers with a recipient and successful ERC-20 `Transfer` events are stored. Pending transactions and internal transactions are not monitored.
- Each configuration can filter by sender address, recipient address, both, or neither.
- Reprocessing a block does not create duplicate records for the same configuration, transaction hash, transfer type, and log index.
- Detailed console logs record RPC duration/retries, per-block processing time, transfer counts, database-write time, checkpoint progress, catch-up duration, and blocks per second.

The first startup begins at the latest finalized block unless `START_BLOCK` is set. `START_BLOCK` is used only when no scanner checkpoint exists.

To rescan from an earlier block, set `RESCAN_FROM_BLOCK` to the desired block number and restart the application. A given value is applied once and recorded in the database. To intentionally apply another rewind, change the value to a different block number.

## API

### Configurations

- `GET /api/configurations`: retrieve configurations.
- `POST /api/configurations`: create a configuration. Provide `name`, and optionally `senderAddress`, `recipientAddress`, and `isActive`.
- `PUT /api/configurations/:id`: update a configuration.
- `DELETE /api/configurations/:id`: delete a configuration.

### Transactions

- `GET /api/transactions`: retrieve stored transactions.
- `DELETE /api/transactions`: delete all stored transactions.
- `DELETE /api/transactions/filter`: delete transactions matching the JSON `where` query parameter.
- `DELETE /api/transactions/:id`: delete a transaction by its ID.

The raw SQL query endpoint has been removed.

## Environment variables

- `INFURA_PROJECT_ID`: Infura project ID used for HTTP and the default WebSocket endpoint.
- `INFURA_WEBSOCKET_URL`: optional override for the Infura WebSocket endpoint.
- `DATABASE_URL`: SQLite database URL. Defaults to `sqlite:./db.sqlite`.
- `START_BLOCK`: optional initial block number, used only when no checkpoint exists.
- `RESCAN_FROM_BLOCK`: optional one-time rewind to a block number. Each distinct value is applied once.

## License

ISC
