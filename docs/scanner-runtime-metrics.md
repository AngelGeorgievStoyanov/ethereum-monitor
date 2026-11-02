# Scanner Runtime Metrics and Analytics

## Data flow

- Scanner, RPC, processing, persistence, filters, and recovery components publish measurements from operations they already perform.
- The RPC client emits request events and logical-operation events through the metrics event bus. It does not depend on the metrics aggregator.
- The metrics aggregator calculates rates, rolling statistics, catch-up sessions, RPC error categories, logical-operation retry statistics, and processing batch statistics.
- Dynamic Config passively stores and returns runtime metrics, scanner status, and analytics snapshots. It does not calculate metrics or query other services.
- Status and analytics endpoints read prepared snapshots. Dashboard polling does not issue PostgreSQL or RPC requests.
- Runtime metrics and history are held in process memory only. They reset when the process restarts and are not written to PostgreSQL.

## Scanner status snapshots

- During scanner startup, after scanner ownership and persistent scanner state are initialized, the application loads the initial pause/control state, checkpoint/recovery state, and latest rescan job from PostgreSQL and publishes one complete status snapshot.
- Pause/resume changes update the status snapshot immediately after the database write.
- The scanner's existing control refresh cycle continues checking the persistent pause state so changes made by another application instance are detected. This is the only recurring PostgreSQL read required for status synchronization.
- Checkpoint and recovery state are published from the scanner's in-memory state after processing and recovery work.
- Rescan job creation, progress, completion, failure, and recovery handoff publish the updated job summary.
- Lock loss and reacquisition publish scanner running state immediately.
- On lock reacquisition, persistent scanner state is loaded again and the status snapshot is refreshed.
- If startup has not yet produced the first complete snapshot, the status endpoint reports that status is initializing rather than returning a fabricated empty state.

## Runtime metrics

The current runtime snapshot includes:

- Scanner running/paused state, active filter count, configured catch-up cap, parallel block count, and parallel-processing lag threshold.
- Latest finalized block and its update time, last processed block, current lag, bounded lag history, and RPC availability based on the scanner's own finalized-block request.
- Processed blocks and transactions, average transactions per block, blocks/sec, transactions/sec, transfer matches, and processing timings.
- Actual RPC request totals, per-method and per-endpoint counts, latency percentiles, rate-limit errors, timeouts, network errors, provider errors, JSON-RPC errors, and recent failures.
- Logical RPC operation totals, successful/failed operations, retried operations, total retry attempts, endpoint failovers, and average attempts per successful operation.
- Database query volume and latency by operation type, database batch write duration, and persistence failures.
- Transaction filter evaluations, matches, predicate failures, and evaluation latency.
- Process RSS/heap/external memory, CPU usage, and event-loop utilization.
- Reorg and rescan counters.
- Active catch-up session and recent completed sessions, including live duration and throughput while a session is running.

## RPC metric semantics

- An RPC request is one actual JSON-RPC request attempt to one endpoint.
- A logical RPC operation is one scanner-level operation. For example, `getBlockAndReceipts` is one logical operation containing separate `eth_getBlockByNumber` and `eth_getBlockReceipts` requests.
- Request totals and endpoint statistics count actual endpoint requests. Logical-operation statistics count the outer operation once and track its retries/failovers separately.
- A retry is an additional attempt of the same logical operation. An endpoint failover is an operation attempt moved to another configured endpoint.
- RPC error extraction and classification are centralized in `src/utils/classifyRpcError.ts`; category names, HTTP/JSON-RPC codes, message patterns, and nested error depth are maintained in `src/constants/rpc-error.constants.ts`.

## Historical runtime retention

History is bounded in memory using generic retention settings in `src/constants/scanner-metrics.constants.ts`. These limits are not based on Ethereum block time and can be adjusted centrally.

- Metric samples are retained for up to 24 hours, subject to per-category memory safety limits.
- The configured sample limits are capacity safeguards, not an assumption about how many blocks a network produces.
- Analytics windows are configured centrally and currently include `1h`, `3h`, `6h`, `9h`, `12h`, and `24h`.
- Network-independent one-minute buckets retain throughput, lag, RPC failure/latency, database query, filter evaluation, and batch timing aggregates. Charts use these buckets rather than relying on a fixed number of block samples.
- An `available` window returns all history available in the current process, up to the retention period.
- Each analytics response reports requested duration, available duration, history start time, and whether the requested window is complete or partial.
- A process that has been running for 40 minutes can therefore return 40 minutes of partial data for a 1-hour window and complete 30/40-minute analysis through the `available` window. It does not need to run for 24 hours.
- Analytics snapshots are prepared by the metrics aggregator and published to Dynamic Config on the configured refresh interval. The analytics endpoint only selects and returns the requested snapshot.

## Endpoints

### GET /api/scanner/status

Returns the prepared scanner status snapshot from Dynamic Config. It does not query PostgreSQL or RPC. The scanner's existing control refresh cycle checks the persisted pause state independently of Dashboard requests.

### GET /api/scanner/analytics?window=1h

Returns the prepared runtime analytics snapshot for the requested window. Supported values are configured in `src/constants/scanner-metrics.constants.ts`, plus `available`.

The response includes the current metrics snapshot, block samples, lag samples, RPC events, catch-up sessions, processing batches, minute-level aggregates, retention metadata, and window coverage.

## Measurement semantics

- Blocks/sec and transactions/sec use completed block samples from the trailing 60-second window.
- Catch-up sessions begin when lag exceeds the configured parallel-processing threshold and finish when the processed checkpoint reaches the latest observed finalized block. Normal one-block/finality polling lag does not create a catch-up session.
- Active catch-up duration, blocks/sec, transactions/sec, lag reduction, and lag reduction/sec are calculated from the current session state. Final lag reduction is initial lag minus actual final lag.
- An ETA is shown only after at least 10 seconds and while the measured net lag-reduction rate is positive. Finalized-chain growth rate is also exposed separately.
- Processing batch samples report the actual block range, number of blocks, transaction count, total batch duration, and database write duration.
- Database query metrics use Sequelize benchmark timings and classify statements as reads, writes, or other operations. They measure successful query durations; persistence failures are counted separately where the persistence service reports them.
- Filter metrics are emitted by the shared filter predicate wrapper, so evaluation counts and duration represent actual predicate invocations rather than an estimate based on transaction count.

Metrics collection is in-process and non-persistent. It must never block scanner progress or issue extra RPC requests.
