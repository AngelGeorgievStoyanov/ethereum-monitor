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
- One or more Ethereum mainnet HTTP JSON-RPC endpoints

## Installation

```bash
git clone https://github.com/AngelGeorgievStoyanov/ethereum-monitor.git
cd ethereum-monitor
npm install
```

Create a `.env` file:

```env
RPC_URL_1=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID
RPC_URL_2=https://YOUR_SECOND_PROVIDER_ENDPOINT
DATABASE_URL=sqlite:./db.sqlite
```

Configure at least `RPC_URL_1`. Additional `RPC_URL_N` endpoints are used as fallbacks when an endpoint is rate-limited, times out, or has a transient network error.

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

The API listens on port 8000.

## Scanner behavior

- The scanner processes only finalized blocks, in ascending block order.
- It fetches blocks and their receipts over HTTP JSON-RPC. Requests are sequential and retried with bounded exponential backoff.
- The RPC client rotates across configured endpoints and retries rate-limited requests, timeouts, and transient network errors on another endpoint.
- Native ETH transfers and successful ERC-20 `Transfer` logs are matched against active sender/recipient configuration filters.
- Stored records include `transferType` (`native` or `erc20`), `tokenAddress` for ERC-20 transfers, and `logIndex` to distinguish multiple token transfers in one transaction.
- During catch-up, it reads finalized blocks over HTTP and saves a persistent checkpoint after each fully processed block.
- It checks the finalized block height over HTTP every 4 seconds and processes newly finalized blocks.
- After a restart, scanning continues from the block after the saved checkpoint.
- If processing a block fails, the checkpoint does not advance and that block is retried.
- Only finalized direct native ETH transfers with a recipient and successful ERC-20 `Transfer` events are stored. Pending transactions and internal transactions are not monitored.
- Reprocessing a block does not create duplicate records for the same configuration, transaction hash, transfer type, and log index.

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
- `DELETE /api/transactions/:id`: delete a transaction by its ID.

Bulk deletion and query-based deletion endpoints are not exposed. The raw SQL query endpoint has been removed.

## Environment variables

- `RPC_URL_1`, `RPC_URL_2`, etc.: ordered Ethereum mainnet HTTP JSON-RPC endpoints. At least one is required.
- `DATABASE_URL`: SQLite database URL. Defaults to `sqlite:./db.sqlite`.
- `START_BLOCK`: optional initial block number, used only when no checkpoint exists.
- `RESCAN_FROM_BLOCK`: optional one-time rewind to a block number. Each distinct value is applied once.

## License

ISC
