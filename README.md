# Ethereum Monitor

Ethereum Monitor monitors finalized native ETH transfers and ERC-20 transfer activity on Ethereum mainnet, storing transfers that match active transaction filters.

## Technologies

- Node.js
- Express
- Sequelize
- PostgreSQL
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

GitHub Actions runs ESLint, the TypeScript build, and an npm dependency audit on pushes and pull requests targeting `feature/ethereum-monitoring-refactor`. Automated tests are intentionally not configured at this stage. The Prettier check is temporarily disabled in CI.

## Requirements

- Node.js 24 and npm
- PostgreSQL
- One or more Ethereum mainnet HTTP JSON-RPC endpoints

## Installation

```bash
git clone https://github.com/AngelGeorgievStoyanov/ethereum-monitor.git
cd ethereum-monitor
npm install
```

Create a fresh PostgreSQL database named `ethereum_monitor` and configure a `.env` file:

```env
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/ethereum_monitor
RPC_URL_1=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID
RPC_URL_2=https://YOUR_SECOND_PROVIDER_ENDPOINT
```

Configure `DATABASE_URL` and at least `RPC_URL_1`. Additional `RPC_URL_N` endpoints are used as fallbacks when an endpoint is rate-limited, times out, or has a transient network error. This version uses a fresh PostgreSQL schema; it does not migrate old SQLite data or alter an existing PostgreSQL schema.

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
```

Use `npm run format` to apply the configured formatting.

The API listens on port 8000.

## Scanner behavior

- The scanner processes only finalized blocks, in ascending block order.
- It fetches blocks and their receipts over HTTP JSON-RPC. Requests are sequential and retried with bounded exponential backoff.
- The RPC client rotates across configured endpoints and retries rate-limited requests, timeouts, and transient network errors on another endpoint.
- Native ETH transactions and successful ERC-20 `Transfer` logs are matched against active sender/recipient transaction filters.
- Failed ERC-20 `transfer` and `transferFrom` attempts are stored with status `failed` when their decoded sender and recipient match an active transaction filter. Reverted attempts are not treated as completed token transfers.
- Transfer amounts are stored as strings in their smallest units. Formatting into ETH or token units belongs in the API or UI layer.
- `Transactions` stores each matching transfer once. `TxMatches` records every filter that matched it, so one transfer can be associated with multiple filters.
- Native transfers are unique by `txHash + transferType`. ERC-20 transfers are unique by `txHash + transferType + logIndex`. Internal transfers do not have a database unique index; identical trace records are grouped in `internalCount`, which is null for native and ERC-20 transfers.
- Internal transaction tracing is not implemented yet; the schema supports the planned `internal` transfer type.
- During catch-up, the scanner reads finalized blocks over HTTP and saves a persistent checkpoint after each fully processed block.
- It checks the finalized block height over HTTP every 4 seconds and processes newly finalized blocks.
- After a restart, scanning continues from the block after the saved checkpoint.
- If processing a block fails, the checkpoint does not advance and that block is retried.
- Failed native ETH attempts with a direct recipient are retained with status `failed` for traceability. Pending transactions are not monitored.
- At startup, the application checks for duplicate native and ERC-20 transfer records and creates separate partial unique indexes. Duplicate records stop startup with examples; records are not deleted automatically.

The first startup begins at the latest finalized block unless `START_BLOCK` is set. `START_BLOCK` is used only when no scanner checkpoint exists.

To rescan from an earlier block, set `RESCAN_FROM_BLOCK` to the desired block number and restart the application. A given value is applied once and recorded in the database. To intentionally apply another rewind, change the value to a different block number.

## API

### Transaction filters

- `GET /api/tx-filters`: retrieve transaction filters.
- `POST /api/tx-filters`: create a filter. Provide `description`, and optionally `from`, `to`, and `isActive`.
- `PUT /api/tx-filters/:id`: update a filter.
- `DELETE /api/tx-filters/:id`: delete a filter. Matched transfers remain stored.

### Transactions

- `GET /api/transactions`: retrieve stored transfers, including their filter matches.
- `DELETE /api/transactions/:id`: delete a transfer by its integer ID.

Bulk deletion and query-based deletion endpoints are not exposed. The raw SQL query endpoint has been removed.

## Environment variables

- `DATABASE_URL`: PostgreSQL connection URL; required.
- `RPC_URL_1`, `RPC_URL_2`, etc.: ordered Ethereum mainnet HTTP JSON-RPC endpoints. At least one is required.
- `START_BLOCK`: optional initial block number, used only when no checkpoint exists.
- `RESCAN_FROM_BLOCK`: optional one-time rewind to a block number. Each distinct value is applied once.

## License

ISC
