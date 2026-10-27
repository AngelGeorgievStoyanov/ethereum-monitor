# Ethereum Monitor

Ethereum Monitor tracks native ETH transfers and ERC-20 transfer events on Ethereum Mainnet. It stores transfers that match the configured filters in PostgreSQL.

## Requirements

- Node.js 24
- npm
- PostgreSQL
- At least one Ethereum Mainnet RPC endpoint

## Setup

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

4. Start in development mode:

   ```bash
   npm run dev
   ```

For production, run `npm run build` and then `npm start`.

The API listens on port `8000`.

## Scanner startup

The scanner saves its checkpoint in PostgreSQL and resumes from it after a restart.

- If a checkpoint already exists, it takes priority over `START_BLOCK`.
- If the database is new and `START_BLOCK` is not set, the scanner skips existing history and starts after the current finalized block.
- If the database is new and `START_BLOCK` is set, the value must be a non-negative safe integer no higher than the current finalized block. The RPC provider must also return that block. Processing starts at `START_BLOCK`.
- If there are no active transaction filters, the scanner waits without processing blocks. New filters normally become active from the next finalized block, not retroactively.
- The database schema is created at startup, but existing schemas are not migrated automatically. Use a fresh database for a new setup.

## How processing works

- The scanner processes finalized blocks in order.
- It checks that block numbers, block hashes, parent hashes, transactions, and receipts are consistent before saving data.
- Transfer records, filter matches, block history, and the checkpoint are saved in a database transaction.
- The checkpoint advances only after the database writes succeed.
- Duplicate-safe inserts allow already stored transfers to be encountered again without creating duplicate records.

The scanner processes native ETH transfers and ERC-20 `Transfer` events, including recognized failed attempts. Internal trace transfers are not processed.

## Reorg recovery

The scanner stores each block's number, hash, parent hash, and status. When it detects a chain mismatch, it searches up to 100 blocks backward for a common ancestor. Replaced blocks and their transfer records are marked as reorged; their history is retained.

Recovery then processes blocks one at a time and requires 10 stable blocks before normal processing resumes. With multiple RPC endpoints, recovery requires all configured endpoints to agree on the block. With one endpoint, independent consensus is not possible and that provider is the source of truth.

If provider responses cannot be verified after the configured retries, recovery is marked as blocked instead of moving the checkpoint forward. Check `GET /api/scanner/status` for the reason. Use `POST /api/scanner/reorg-retry` to explicitly retry blocked recovery, then resume the scanner if it is paused.

The scanner limits catch-up to 100 blocks per cycle. When it is far behind, it can process up to 3 blocks in parallel during normal processing. Reorg recovery remains sequential.

## Manual rescan

A manual rescan rechecks existing canonical history from `fromBlock` through the saved checkpoint. It does not move the checkpoint.

1. Pause the scanner in manual mode:

   ```http
   POST /api/scanner/pause
   Content-Type: application/json

   {"mode":"manual"}
   ```

2. Start the rescan:

   ```http
   POST /api/scanner/rescan
   Content-Type: application/json

   {"fromBlock":19000000}
   ```

3. Use the returned `operationId` to check progress:

   ```http
   GET /api/scanner/rescan/OPERATION_ID
   ```

The scanner must be paused and idle. The requested range must have complete canonical block history. With multiple RPC endpoints, every configured endpoint must agree on each checked block. If a mismatch is found, the rescan stops and hands control to reorg recovery. A failed or interrupted rescan can be retried from the same block after checking its status.

## API

All routes below are prefixed with `/api`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health/live` | Check whether the process is running. |
| GET | `/health/ready` | Check PostgreSQL and RPC availability. |
| GET | `/scanner/status` | View the checkpoint, finalized height, lag, pause state, recovery state, and RPC metrics. |
| POST | `/scanner/pause` | Pause now or request a pause after a block. |
| POST | `/scanner/resume` | Resume processing. |
| POST | `/scanner/rescan` | Start a manual rescan. |
| GET | `/scanner/rescan/:id` | Check rescan progress. |
| POST | `/scanner/reorg-retry` | Retry blocked reorg recovery. |
| GET | `/tx-filters` | List transaction filters. |
| POST | `/tx-filters` | Create a transaction filter. |
| PUT | `/tx-filters/:id` | Update a transaction filter. |
| DELETE | `/tx-filters/:id` | Delete a transaction filter while keeping historical match records. |
| GET | `/transactions?page=1&limit=20` | List stored transfers. |
| DELETE | `/transactions/:id` | Delete a stored transfer. |

## Transfer identity and history

- Native ETH transfers are unique by transaction hash, transfer type, and block hash.
- ERC-20 transfers are unique by transaction hash, transfer type, log index, and block hash.
- Including the block hash preserves separate records when a transaction appears on a replacement block.
- `Transactions.chainStatus` stores the receipt result. `Transactions.recordStatus` stores whether the transfer is on the canonical chain.
- `TxMatches.matchStatus` tracks whether a match is active, no longer matched, linked to a deleted filter, or reorged.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. Required. |
| `RPC_URL_1` | First Ethereum RPC endpoint. Required. |
| `RPC_URL_2`, `RPC_URL_3`, etc. | Additional RPC endpoints used for fallback requests and cross-provider verification. |
| `START_BLOCK` | Optional initial block. Used only when no scanner checkpoint exists. |

Recovery counters and durations are held in memory and reset when the process restarts.
