# Ethereum Monitor

Monitors native ETH transfers and ERC-20 transfer events on an EVM-compatible network. Matching transfers are stored in PostgreSQL.

## Project scope

Ethereum Monitor is a **lightweight, single-network EVM monitoring application** designed for a limited scope. It provides continuous block scanning, native and ERC-20 transfer processing, configurable transaction filters, checkpoint persistence, and basic reorganization detection and recovery.

It is not a production-ready monitoring platform and is not designed or validated for large-scale workloads, public multi-tenant use, high availability, or strict service-level guarantees. Its HTTP API is intended for local or otherwise trusted use; authentication and authorization are not implemented, so do not expose it directly to an untrusted network.

The implementation deliberately favors a compact architecture over production infrastructure. It does not aim to provide horizontal scan throughput, independently scalable ingestion and filtering, durable event streaming, comprehensive operational monitoring, or production-grade disaster recovery.

For a substantially larger system or production deployment, the architecture must be redesigned. The main responsibilities, including RPC ingestion, address monitoring, filter evaluation, persistence, and event delivery, must be separated into independent services that can be scaled independently. The resulting architecture must also address queueing, access control, observability, redundancy, and operational safeguards. The current design should not be treated as a production blueprint.

## Setup

Requirements: Node.js 24, npm, PostgreSQL, and an RPC endpoint for the network you want to monitor.

1. Run npm install.
2. Create a .env file:

    BLOCKCHAIN_NETWORK_AND_DATABASE_NAME=ethereum-mainnet
    DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432
    RPC_URL_1=https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID

3. Run npm run dev.

### Network and database name

BLOCKCHAIN_NETWORK_AND_DATABASE_NAME is the single setting used for both the PostgreSQL database name and SCANNER_ID.

At startup, the application checks whether a PostgreSQL database with this name exists. If it does not, the application creates it, then connects to it and creates any missing tables.

For example, with:

    BLOCKCHAIN_NETWORK_AND_DATABASE_NAME=ethereum-mainnet
    DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432

the application creates and uses the ethereum-mainnet database, and sets SCANNER_ID to ethereum-mainnet.

To use a separate database for Sepolia, change the name to:

    BLOCKCHAIN_NETWORK_AND_DATABASE_NAME=ethereum-sepolia

The application then creates and uses ethereum-sepolia if it does not already exist, and uses ethereum-sepolia as SCANNER_ID. Configure RPC_URL_1, and any additional RPC URLs, for that same network. Changing the name does not automatically change the RPC endpoint or migrate/copy data from the previous database.

The PostgreSQL user in DATABASE_URL must be allowed to connect to the postgres administrative database and create databases. The name setting must contain 1-63 letters, numbers, hyphens, or underscores.

To run the compiled application locally, use npm run build followed by npm start. The API listens on port 8000. These commands describe how to run the build; they do not imply that the application is production-ready.

The application creates missing tables at startup. It does not migrate existing table schemas; schema changes must be applied separately.

## Startup and filters

The scanner saves its checkpoint in PostgreSQL and resumes from it after a restart.

- An existing checkpoint takes priority over START_BLOCK.
- When creating a new scanner state, START_BLOCK sets the first block to process. The scanner stores START_BLOCK - 1 as its initial checkpoint. The value must be a non-negative safe integer at or below the current finalized block, and the RPC provider must return that block with a valid hash and parent hash.
- When creating a new scanner state without START_BLOCK, scanning starts after the current finalized block. Existing chain history is skipped.
- Filter creation does not determine the initial checkpoint. When there are no active filters, the scanner waits without advancing the checkpoint. Once an active filter is available, scanning continues from the next unprocessed block. Newly created filters do not trigger an automatic historical backfill.
- DynamicConfigService owns the in-memory active-filter cache. Each instance applies a content-based configuration version and logs it. Normal scanner batches use one consistent snapshot; reorg recovery refreshes its snapshot for each block. Local API mutations refresh the local instance immediately; other instances discover changes on their next 60-second refresh when the database is available. If a refresh fails, the last successfully applied cache is retained.
- Invalid active filters are logged and excluded without blocking valid filters. Each invalid filter is retried once per minute. Retry counters reset on process restart. Automatic deactivation after three failed attempts is intended, but the current rule-signature comparison in the deactivation guard is incorrect; do not rely on automatic deactivation until that code issue is fixed. See docs/generic-transaction-filters.md.

### Filter capacity

The default limits are 20 unique addresses per filter and 50 active filters. Only active filters count toward the active-filter limit; inactive filters do not. The limits are defined in src/constants/tx-filter.constants.ts and can be adjusted for the deployment.

Address format validation uses ethers.isAddress and can be independently enabled or disabled for from/to addresses and tokenAddress in src/constants/tx-filter-address.constants.ts. Filter address validation does not make RPC calls.

These limits are intended for a lightweight filter feature. If the application needs to monitor substantially more addresses or a much larger number of active filters, do not simply increase the limits. Use a separate address-monitoring microservice with a message queue or event bus. That service can manage large address subscriptions, batch and schedule RPC work, apply independent rate limits, and publish detected events for the transaction scanner or downstream consumers. This keeps high-volume address monitoring isolated from the main scanner.

## Transaction filter engine

The Generic Boolean Engine evaluates nested all (AND), any (OR), and not (NOT) rules against the predefined transfer context. It is generic over the available context fields and operators; it does not attempt to cover every possible EVM transaction shape.

A runtime error in one compiled filter is logged with its filter ID and treated as a non-match for that filter and transfer. Other filters and scanner processing continue.

## Block processing and recovery

The scanner checks block and receipt consistency before saving data. Block history, transfers, filter matches, and the checkpoint are saved in a database transaction. The checkpoint advances only after the writes succeed.

The database keeps block hashes and parent hashes. When a reorg is detected, the scanner searches up to 100 blocks for a common ancestor, marks replaced blocks and transfers as reorged, then reprocesses blocks one at a time. It requires 10 stable blocks before returning to normal processing.

With multiple RPC endpoints, reorg verification requires every configured endpoint to agree. With one endpoint, independent consensus is not possible. If provider verification fails after retries, receipt consistency fails during recovery, or the common ancestor is outside the stored block history, recovery is blocked rather than guessing or advancing the checkpoint. Receipt consistency failures during recovery stop automatic retries and record a reason in scanner state. Check GET /api/scanner/status and inspect the RPC providers before using POST /api/scanner/reorg-retry to retry blocked recovery.

Catch-up is limited to 100 blocks per cycle. When far behind, normal processing can handle up to 3 blocks in parallel. Recovery remains sequential.

## Monitoring dashboard

Open http://localhost:8000/dashboard while the backend is running. The page requests GET /api/scanner/status every 5 seconds and displays scanner state, block lag, processing totals, recent block timings, RPC endpoint statistics, and recovery/rescan information.

Processing and recovery metrics are held in process memory and reset when the process restarts. RPC counters include requests made through the shared RPC client, including status checks and recovery diagnostics. The dashboard is intended for local or otherwise trusted use; the API does not implement authentication or authorization.

## Manual rescan

A rescan checks existing canonical history from fromBlock through the saved checkpoint. It does not move the checkpoint.

1. Pause the scanner in manual mode:

        POST /api/scanner/pause
        Content-Type: application/json

        {"mode":"manual"}

2. Start the rescan:

        POST /api/scanner/rescan
        Content-Type: application/json

        {"fromBlock":19000000}

3. Check progress with GET /api/scanner/rescan/OPERATION_ID, using the returned operation ID.

The scanner must be idle and canonical history must exist for the full range. A chain mismatch stops the rescan and starts reorg recovery. Failed or interrupted jobs can be retried from the same starting block after checking their status.

## API

All routes use the /api prefix.

| Method              | Route                         | Purpose                                                        |
| ------------------- | ----------------------------- | -------------------------------------------------------------- |
| GET                 | /health/live                  | Process liveness.                                              |
| GET                 | /health/ready                 | Database and RPC availability.                                 |
| GET                 | /scanner/status               | Checkpoint, lag, pause, recovery, RPC, and processing metrics. |
| POST                | /scanner/pause                | Pause now or after a block.                                    |
| POST                | /scanner/resume               | Resume scanning.                                               |
| POST                | /scanner/rescan               | Start a manual rescan.                                         |
| GET                 | /scanner/rescan/:id           | Check rescan progress.                                         |
| POST                | /scanner/reorg-retry          | Retry blocked recovery.                                        |
| GET/POST/PUT/DELETE | /tx-filters                   | Manage filters.                                                |
| GET                 | /transactions?page=1&limit=20 | List stored transfers.                                         |
| DELETE              | /transactions/:id             | Delete a stored transfer.                                      |

The dashboard is served separately at GET /dashboard.

## Configuration

- BLOCKCHAIN_NETWORK_AND_DATABASE_NAME: required; database name and scanner ID.
- DATABASE_URL: PostgreSQL server connection URL. Do not include a database name in the path.
- RPC_URL_1: required RPC endpoint for the configured network.
- RPC_URL_2, RPC_URL_3, etc.: optional fallback and verification endpoints for the same network.
- START_BLOCK: optional initial block; used only when no checkpoint exists. Normal RPC requests time out after RPC_ENDPOINT_TIMEOUT_MS and can fail over to another configured endpoint.

Native ETH transfers are unique by transaction hash and block hash. ERC-20 transfers also include the log index. This preserves separate records when a transaction appears on a replacement block. Internal trace transfers are not currently processed or available to transaction filters.

Recovery metrics and block-processing metrics are kept in memory and reset when the process restarts.
