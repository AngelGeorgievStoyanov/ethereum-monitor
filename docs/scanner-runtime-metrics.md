# Scanner Metrics and Analytics

## Data flow

- Scanner, RPC, processing, persistence, filters, and recovery components publish measurements from operations they already perform.
- The RPC client emits request events and logical-operation events through the metrics event bus. It does not depend on the metrics aggregator.
- The metrics aggregator calculates rates, rolling statistics, catch-up sessions, RPC error categories, logical-operation retry statistics, and processing batch statistics.
- Dynamic Config passively stores and returns current metrics and scanner status. It does not calculate metrics, analytics, or query other services.
- The status endpoint reads the prepared Dynamic Config current data. The analytics endpoint asks the metrics aggregator for the requested window; the aggregator calculates the result on demand and caches it for the configured cache duration. Dashboard polling does not issue PostgreSQL or RPC requests.
- Current metrics and history are held in process memory only. They reset when the process restarts and are not written to PostgreSQL.

## Scanner scanner statuss

- During application startup, after database and Dynamic Config initialization, the application loads the initial pause/control state, checkpoint/recovery state, and latest rescan job from PostgreSQL and publishes a scanner status before the HTTP server starts. After scanner state is initialized, the current data is refreshed with the scanner scanner state.
- The initial pause state is loaded from PostgreSQL during startup and published to Dynamic Config before the scanner starts.
- A dedicated Fast Refresh reads only the persisted `scannerPaused` flag every 30 seconds and updates the in-memory Dynamic Config current data. Pause/resume API requests only write PostgreSQL; the scanner observes them on the next refresh.
- If a Fast Refresh read fails, the last successfully loaded pause state remains active. The scanner reads the in-memory state at its safe processing boundaries and performs no database reads for pause checks.
- The existing scanner main loop republishes its runtime context during normal polling. Checkpoint and recovery state are published from the scanner's in-memory state after processing and recovery work; the stall check continues to expose stale progress through the last-processed timestamp.
- Rescan job creation, progress, completion, failure, and recovery handoff publish the updated job summary.
- If startup has not yet produced the first complete current data, the status endpoint reports that status is initializing rather than returning a fabricated empty state.

## Current metrics

The current current metrics includes:

- Scanner running/paused state, active filter count, configured catch-up cap, parallel block count, and parallel-processing lag threshold.
- Latest finalized block and its update time, last processed block, current lag, bounded lag history, and RPC availability based on the scanner's own finalized-block request.
- Processed blocks and transactions, average transactions per block, blocks/sec, transactions/sec, transfer matches, and processing timings.
- Actual RPC request totals, per-method and per-endpoint counts, latency percentiles, rate-limit errors, timeouts, network errors, provider errors, JSON-RPC errors, and recent failures.
- Logical RPC operation totals, successful/failed operations, retried operations, total retry attempts, endpoint failovers, and average attempts per successful operation.
- Database query volume split into reads, writes, and other SQL operations; query latency by operation type; database batch write duration; and persistence failures.
- Transaction filter evaluations, matches, predicate failures, and evaluation latency.
- Process RSS/heap/external memory, CPU usage, and event-loop utilization.
- Reorg and rescan counters.
- Active catch-up session and recent completed sessions, including live duration and throughput while a session is running.

## RPC metric semantics

- An RPC request is one actual JSON-RPC request attempt to one endpoint.
- A logical RPC operation is one scanner-level operation. For example, `getBlockAndReceipts` is one logical operation containing separate `eth_getBlockByNumber` and `eth_getBlockReceipts` requests. Consensus and diagnostic fan-out methods are also counted once as logical operations, while each provider request remains a separate RPC request.
- Request totals and endpoint statistics count actual endpoint requests. Logical-operation statistics count the outer operation once and track its retries/failovers separately.
- A retry is an additional attempt of the same logical operation. An endpoint failover is an operation attempt moved to another configured endpoint.
- RPC error extraction and classification are centralized in `src/utils/classifyRpcError.ts`; category names, HTTP/JSON-RPC codes and code ranges, message-property names, nested-property names, message patterns, and nested error depth are maintained in `src/constants/rpc-error.constants.ts`.

## Historical runtime retention

History is bounded in memory using generic retention settings in `src/constants/scanner-metrics.constants.ts`. These limits are not based on Ethereum block time and can be adjusted centrally.

- Metric samples are retained for up to 3 hours, subject to per-category memory safety limits.
- The configured sample limits are capacity safeguards, not an assumption about how many blocks a network produces.
- Analytics exposes only two windows: `1h` and `3h`.
- Network-independent one-minute buckets retain throughput, lag, RPC failure/latency, database query, filter evaluation, and batch timing aggregates. Throughput, RPC, component-latency, and lag charts use the selected window's buckets rather than relying on a fixed number of block samples.
- Each analytics response reports requested duration, available duration, history start time, and whether the requested window is complete or partial.
- A process that has been running for 40 minutes can return 40 minutes of partial data for a 1-hour window. It does not need to run for 3 hours.
- Analytics are calculated on demand by the metrics aggregator for the requested window. The most recently requested result is cached for `METRICS_ANALYTICS_REFRESH_INTERVAL_MS` (currently 30000 ms). Dynamic Config does not own or periodically publish analytics current data.
- Summary counters and breakdown tables are calculated for the selected window from minute buckets, including processing throughput, RPC request/error/retry/failover counts, database query counts/failures, filter evaluations, RPC methods, database query types, and per-filter performance. Percentile latency uses the retained raw RPC request samples for the selected window.

## Dashboard polling

Dashboard polling intervals and the stale-progress display threshold are configured in `public/dashboard.constants.js`:

- `STATUS_REFRESH_INTERVAL_MS` (currently 5000 ms) controls requests to `GET /api/scanner/status`.
- `ANALYTICS_REFRESH_INTERVAL_MS` (currently 30000 ms) controls requests to `GET /api/scanner/analytics`.
- `STALLED_THRESHOLD_MS` (currently 60000 ms) controls when the Dashboard displays `POSSIBLY STALLED`. This is a display threshold, not a scanner polling interval.

These Dashboard requests read in-memory states and do not issue PostgreSQL or RPC requests.

## Endpoints

### GET /api/scanner/status

Returns the prepared scanner scanner status from Dynamic Config. It does not query PostgreSQL or RPC. The dedicated 30-second Fast Refresh checks the persisted pause state independently of Dashboard requests. The scanner and Dashboard read only the in-memory Dynamic Config current data.

### GET /api/scanner/analytics?window=1h

Returns the calculated and cached runtime analytics result for the requested window. Supported values are `1h` and `3h`, configured in `src/constants/scanner-metrics.constants.ts`.

The response includes the current metrics current data, block samples, lag samples, RPC events, catch-up sessions, processing batches, minute-level aggregates, retention metadata, and window coverage.

## Measurement semantics

- Blocks/sec and transactions/sec use completed block samples from the trailing 60-second window.
- Catch-up sessions begin when lag exceeds the configured parallel-processing threshold and finish when the processed checkpoint reaches the latest observed finalized block. Normal one-block/finality polling lag does not create a catch-up session.
- Active catch-up duration, blocks/sec, transactions/sec, lag reduction, and lag reduction/sec are calculated from the current session state. Final lag reduction is initial lag minus actual final lag.
- An ETA is shown only after at least 10 seconds and while the measured net lag-reduction rate is positive. Finalized-chain growth rate is also exposed separately.
- Processing batch samples report the actual block range, number of blocks, transaction count, total batch duration, and database write duration.
- Database query metrics use Sequelize benchmark timings and classify statements as reads, writes, or other operations. The Dashboard reports all three categories so `queries = reads + writes + other` for the selected window. Successful query durations are measured centrally. Sequelize persistence errors from transaction creation, block-batch persistence, and rescan reconciliation are counted separately; arbitrary failed read queries outside those persistence paths are not yet comprehensively counted.
- Filter metrics are emitted by the shared filter predicate wrapper, so evaluation counts and duration represent actual predicate invocations rather than an estimate based on transaction count.

Metrics collection is in-process and non-persistent. It must never block scanner progress or issue extra RPC requests.
