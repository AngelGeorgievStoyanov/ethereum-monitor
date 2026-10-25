# Ethereum Monitor

Ethereum Monitor monitors finalized native ETH transfers and ERC-20 transfer activity on Ethereum mainnet, storing records that match active transaction filters.

## Technologies

- Node.js
- Express
- Sequelize
- SQLite
- Ethers.js
- TypeScript
- Nodemon
- ESLint
- Prettier

## Project structure

- `src/clients`: external RPC client integration.
- `src/config`: environment configuration.
- `src/constants`: constants grouped by the feature or service that owns them.
- `src/controllers`: HTTP request and response handling.
- `src/models`: Sequelize data models.
- `src/repositories`: database access.
- `src/services`: scanner, Ethereum RPC, transfer processing, and transaction filter logic.
- `src/types`: explicit types for Ethereum JSON-RPC responses.
- `src/utils`: small shared utilities.
- `src/httpRouter.ts`: API route declarations, kept separate from controller logic.

## Continuous integration

GitHub Actions runs ESLint, Prettier formatting checks, the TypeScript build, and an npm dependency audit on pushes and pull requests targeting `feature/ethereum-monitoring-refactor`. Automated tests are intentionally not configured at this stage.

## Requirements

- Node.js 24 and npm
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

The build command clears the previous `build` output before compiling TypeScript.

Run the quality checks after installing dependencies:

```bash
npm ci
npm run lint
npm run format:check
```

Use `npm run format` to apply the configured formatting.

The API listens on port 8000.

## Scanner behavior

- The scanner processes only finalized blocks, in ascending block order.
- It fetches blocks and their receipts over HTTP JSON-RPC. Requests are sequential and retried with bounded exponential backoff.
- The RPC client rotates across configured endpoints and retries rate-limited requests, timeouts, and transient network errors on another endpoint.
- Native ETH transactions and successful ERC-20 `Transfer` logs are matched against active sender/recipient transaction filters.
- Failed ERC-20 `transfer` and `transferFrom` attempts are stored as `failed` records when their decoded sender and recipient match an active transaction filter. Reverted attempts are not treated as completed token transfers.
- Stored records include `transferType` (`native` or `erc20`), `tokenAddress` for ERC-20 transfers, and `logIndex` to distinguish multiple token transfers in one transaction.
- During catch-up, it reads finalized blocks over HTTP and saves a persistent checkpoint after each fully processed block.
- It checks the finalized block height over HTTP every 4 seconds and processes newly finalized blocks.
- After a restart, scanning continues from the block after the saved checkpoint.
- If processing a block fails, the checkpoint does not advance and that block is retried.
- Failed native ETH attempts with a direct recipient are retained with `status=failed` for traceability. Failed ERC-20 attempts are retained only when standard `transfer` or `transferFrom` calldata can be decoded. Pending transactions and internal transactions are not monitored.
- Reprocessing a block does not create duplicate records for the same transaction filter, transaction hash, transfer type, and log index.
- At startup, the application checks for existing duplicate transfer records and creates a unique SQLite index for that identity. If duplicates already exist, startup stops with examples; records are not deleted automatically.

The first startup begins at the latest finalized block unless `START_BLOCK` is set. `START_BLOCK` is used only when no scanner checkpoint exists.

To rescan from an earlier block, set `RESCAN_FROM_BLOCK` to the desired block number and restart the application. A given value is applied once and recorded in the database. To intentionally apply another rewind, change the value to a different block number.

## API

### Transaction filters

- `GET /api/tx-filters`: retrieve transaction filters.
- `POST /api/tx-filters`: create a transaction filter. Provide `name`, and optionally `senderAddress`, `recipientAddress`, and `isActive`.
- `PUT /api/tx-filters/:id`: update a transaction filter.
- `DELETE /api/tx-filters/:id`: delete a transaction filter.

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
