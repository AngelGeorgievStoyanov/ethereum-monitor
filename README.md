# Ethereum Monitor

Monitors native ETH transfers and ERC-20 transfer events on an EVM-compatible network. Matching transfers are stored in PostgreSQL.

## Setup

Requirements: Node.js 24, npm, PostgreSQL, and an RPC endpoint for the network you want to monitor.

1. Run `npm install`.
2. Create a `.env` file:

    ```env
    BLOCKCHAIN_NETWORK_AND_DATABASE_NAME=ethereum-mainnet
    DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432
    RPC_URL_1=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID
    ```

3. Run `npm run dev`.

### Network and database name

`BLOCKCHAIN_NETWORK_AND_DATABASE_NAME` is the single setting used for both the PostgreSQL database name and `SCANNER_ID`.

At startup, the application checks whether a PostgreSQL database with this name exists. If it does not, the application creates it, then connects to it and creates any missing tables.

For example, with:

```env
BLOCKCHAIN_NETWORK_AND_DATABASE_NAME=ethereum-mainnet
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432
```

the application creates and uses the `ethereum-mainnet` database, and sets `SCANNER_ID` to `ethereum-mainnet`.

To use a separate database for Sepolia, change the name to:

```env
BLOCKCHAIN_NETWORK_AND_DATABASE_NAME=ethereum-sepolia
```

The application then creates and uses `ethereum-sepolia` if it does not already exist, and uses `ethereum-sepolia` as `SCANNER_ID`. Configure `RPC_URL_1`, and any additional RPC URLs, for that same network. Changing the name does not automatically change the RPC endpoint or migrate/copy data from the previous database.

The PostgreSQL user in `DATABASE_URL` must be allowed to connect to the `postgres` administrative database and create databases. The name setting must contain 1-63 letters, numbers, hyphens, or underscores.

For production, run `npm run build` and `npm start`. The API listens on port `8000`.

The application creates missing tables at startup. It does not migrate existing table schemas; schema changes must be applied separately.

## Startup and filters

The scanner saves its checkpoint in PostgreSQL and resumes from it after a restart.

- An existing checkpoint takes priority over `START_BLOCK`.
- On a new database, without `START_BLOCK`, scanning starts after the current finalized block.
- On a new database, with `START_BLOCK`, the value must be a non-negative safe integer at or below the current finalized block, and the RPC provider must return that block.
- With `START_BLOCK`, only the first active filter created before any block history exists starts at that block, allowing the initial scan to find matching transfers. Concurrent filter creation is serialized so two requests cannot both claim the initial backfill range. After an active filter exists or block history has started, new filters start from the next finalized block and do not backfill automatically. The `DynamicConfigService` owns the in-memory active-filter cache. It loads filters before scanner startup, refreshes them every 60 seconds, and refreshes immediately after filter changes through the API. If a refresh fails, the last valid cache is retained. Scanner ownership changes do not create a separate filter cache.
- With no active filters, the scanner waits without advancing the checkpoint.

## Block processing and recovery

The scanner checks block and receipt consistency before saving data. Block history, transfers, filter matches, and the checkpoint are saved in a database transaction. The checkpoint advances only after the writes succeed.

The database keeps block hashes and parent hashes. When a reorg is detected, the scanner searches up to 100 blocks for a common ancestor, marks replaced blocks and transfers as reorged, then reprocesses blocks one at a time. It requires 10 stable blocks before returning to normal processing.

With multiple RPC endpoints, reorg verification requires every configured endpoint to agree. With one endpoint, independent consensus is not possible. If provider verification fails after retries, receipt consistency fails during recovery, or the common ancestor is outside the stored block history, recovery is blocked rather than guessing or advancing the checkpoint. Receipt consistency failures during recovery stop automatic retries and record a reason in scanner state. Check `GET /api/scanner/status` and inspect the RPC providers before using `POST /api/scanner/reorg-retry` to retry blocked recovery.

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

| Method              | Route                           | Purpose                                            |
| ------------------- | ------------------------------- | -------------------------------------------------- |
| GET                 | `/health/live`                  | Process liveness.                                  |
| GET                 | `/health/ready`                 | Database and RPC availability.                     |
| GET                 | `/scanner/status`               | Checkpoint, lag, pause, recovery, and RPC metrics. |
| POST                | `/scanner/pause`                | Pause now or after a block.                        |
| POST                | `/scanner/resume`               | Resume scanning.                                   |
| POST                | `/scanner/rescan`               | Start a manual rescan.                             |
| GET                 | `/scanner/rescan/:id`           | Check rescan progress.                             |
| POST                | `/scanner/reorg-retry`          | Retry blocked recovery.                            |
| GET/POST/PUT/DELETE | `/tx-filters`                   | Manage filters.                                    |
| GET                 | `/transactions?page=1&limit=20` | List stored transfers.                             |
| DELETE              | `/transactions/:id`             | Delete a stored transfer.                          |

## Configuration

- `BLOCKCHAIN_NETWORK_AND_DATABASE_NAME`: required; database name and scanner ID.
- `DATABASE_URL`: PostgreSQL server connection URL. Do not include a database name in the path.
- `RPC_URL_1`: required RPC endpoint for the configured network.
- `RPC_URL_2`, `RPC_URL_3`, etc.: optional fallback and verification endpoints for the same network.
- `START_BLOCK`: optional initial block; used only when no checkpoint exists. Normal RPC requests time out after `RPC_ENDPOINT_TIMEOUT_MS` and can fail over to another configured endpoint.

Native ETH transfers are unique by transaction hash and block hash. ERC-20 transfers also include the log index. This preserves separate records when a transaction appears on a replacement block. Internal trace transfers are not processed.

Recovery metrics are kept in memory and reset when the process restarts.
