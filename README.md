# Ethereum Monitor

A service for monitoring ETH and ERC-20 transfers on Ethereum Mainnet and storing transfers that match configured filters.

## Technologies

Node.js 24, TypeScript, Express, ethers.js, Sequelize, and PostgreSQL.

## Getting started

Requirements: Node.js 24, npm, PostgreSQL, and an Ethereum Mainnet RPC endpoint.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an empty PostgreSQL database named `ethereum_monitor`.

3. Create a `.env` file:

   ```env
   DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/ethereum_monitor
   RPC_URL_1=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID
   ```

4. Start the server:

   ```bash
   npm run dev
   ```

For a production build:

```bash
npm run build
npm start
```

The API listens on port `8000`.

## How it works

- Processes finalized blocks in order and stores a checkpoint in the database to resume after a restart.
- Monitors native ETH transfers and ERC-20 `Transfer` events, including recognized failed attempts.
- Stores each transfer once in `Transactions` and records filter matches in `TxMatches`.
- Does not advance the checkpoint when block processing fails.

## Transfer uniqueness

- **Native ETH:** unique by `txHash + transferType`.
- **ERC-20:** unique by `txHash + transferType + logIndex`, because a transaction can contain multiple token transfers.
- **Internal transfers:** are not processed by this service and have no unique index. A transaction can contain distinct trace records with identical data. Processing them is planned for a separate microservice.

## API

- `GET /api/tx-filters` — list filters.
- `POST /api/tx-filters` — create a filter.
- `PUT /api/tx-filters/:id` — update a filter.
- `DELETE /api/tx-filters/:id` — delete a filter.
- `GET /api/transactions?page=1&limit=20` — list transfers with pagination.
- `DELETE /api/transactions/:id` — delete a transfer.
- `GET /api/scanner/status` — get scanner status.
- `POST /api/scanner/pause` and `POST /api/scanner/resume` — pause and resume scanning.

## Configuration

- `DATABASE_URL` — PostgreSQL connection URL.
- `RPC_URL_1`, `RPC_URL_2`, etc. — RPC endpoints; additional endpoints act as fallbacks.
- `START_BLOCK` — initial block, used when no checkpoint exists.
- `RESCAN_FROM_BLOCK` — one-time rewind to an earlier block.

A fresh PostgreSQL schema is expected. Existing schemas and old SQLite data are not migrated automatically.
