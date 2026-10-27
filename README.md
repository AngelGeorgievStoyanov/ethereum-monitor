# Ethereum Monitor

Monitors native ETH transfers and ERC-20 transfer events on Ethereum Mainnet. Matching transfers are stored in PostgreSQL.

## Setup

Requirements: Node.js 24, npm, PostgreSQL, and an Ethereum Mainnet RPC endpoint.

1. Run `npm install`.
2. Create an empty database named `ethereum_monitor`.
3. Create a `.env` file:

   ```env
   DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/ethereum_monitor
   RPC_URL_1=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID
   ```

4. Run `npm run dev`.

For production, run `npm run build` and `npm start`. The API listens on port `8000`.

The app creates missing tables at startup but does not migrate existing schemas. Use a fresh database for a new setup.

## Startup and filters

The scanner saves its checkpoint in PostgreSQL and resumes from it after a restart.

- An existing checkpoint takes priority over `START_BLOCK`.
- On a new database, without `START_BLOCK`, scanning starts after the current finalized block.
- On a new database, with `START_BLOCK`, the value must be a non-negative safe integer at or below the current finalized block, and the RPC provider must return that block.
- Filters normally become active from the next finalized block. They do not automatically match older blocks just because `START_BLOCK` is set.
- With no active filters, the scanner waits without advancing the checkpoint.

## Block processing and recovery

The scanner checks block and receipt consistency before saving data. Block history, transfers, filter matches, and the checkpoint are saved in a database transaction. The checkpoint advances only after the writes succeed.

The database keeps block hashes and parent hashes. When a reorg is detected, the scanner searches up to 100 blocks for a common ancestor, marks replaced blocks and transfers as reorged, then reprocesses blocks one at a time. It requires 10 stable blocks before returning to normal processing.

With multiple RPC endpoints, reorg verification requires every configured endpoint to agree. With one endpoint, independent consensus is not possible. If verification fails after retries, recovery is blocked rather than advancing the checkpoint. Check `GET /api/scanner/status`; use `POST /api/scanner/reorg-retry` to retry blocked recovery.

Catch-up is limited to 100 blocks per cycle. When far behind, normal processing can handle up to 3 blocks in parallel. Recovery remains sequential.

## Manual rescan

A rescan checks existing canonical history from `fromBlock` through the saved checkpoint. It does not move the checkpoint.

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
3. Check progress with `GET /api/scanner/rescan/OPERATION_ID`, using the returned operation ID.

The scanner must be idle and canonical history must exist for the full range. A chain mismatch stops the rescan and starts reorg recovery. Failed or interrupted jobs can be retried from the same starting block after checking their status.

## API

All routes use the `/api` prefix.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health/live` | Process liveness. |
| GET | `/health/ready` | Database and RPC availability. |
| GET | `/scanner/status` | Checkpoint, lag, pause, recovery, and RPC metrics. |
| POST | `/scanner/pause` | Pause now or after a block. |
| POST | `/scanner/resume` | Resume scanning. |
| POST | `/scanner/rescan` | Start a manual rescan. |
| GET | `/scanner/rescan/:id` | Check rescan progress. |
| POST | `/scanner/reorg-retry` | Retry blocked recovery. |
| GET/POST/PUT/DELETE | `/tx-filters` | Manage filters. |
| GET | `/transactions?page=1&limit=20` | List stored transfers. |
| DELETE | `/transactions/:id` | Delete a stored transfer. |

## Configuration

- `DATABASE_URL`: PostgreSQL connection URL.
- `RPC_URL_1`: required RPC endpoint.
- `RPC_URL_2`, `RPC_URL_3`, etc.: optional fallback and verification endpoints.
- `START_BLOCK`: optional initial block; used only when no checkpoint exists.

Native ETH transfers are unique by transaction hash and block hash. ERC-20 transfers also include the log index. This preserves separate records when a transaction appears on a replacement block. Internal trace transfers are not processed.

Recovery metrics are kept in memory and reset when the process restarts.
