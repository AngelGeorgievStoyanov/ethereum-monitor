# Scanner Runtime Metrics and Analytics

## Data flow

- Scanner and processing components publish measurements from operations they already perform.
- The RPC client emits lightweight metric events through the metrics event bus. It does not depend on the metrics aggregator.
- The metrics aggregator calculates rates, rolling statistics, catch-up sessions, RPC error categories, and processing batch statistics.
- Dynamic Config passively stores and returns the latest runtime metrics, status, and analytics snapshots. It does not calculate metrics or call other services to collect them.
- Status and analytics endpoints read the prepared runtime data. Dashboard requests do not issue RPC calls.
- Runtime metrics are kept in memory only. They are reset when the process restarts and are not written to PostgreSQL.

## Runtime metrics

The current snapshot includes:

- Scanner running/paused state, active filter count, configured catch-up cap, parallel block count, and parallel-processing lag threshold.
- Latest finalized block and its update time, last processed block, current lag, bounded lag history, and RPC availability based on the scanner's own finalized-block request.
- Processed blocks and transactions, average transactions per block, blocks/sec, transactions/sec, transfer matches, and processing timings.
- RPC request totals, per-method and per-endpoint counts, latency percentiles, 429/rate-limit errors, timeouts, connection errors, server errors, JSON-RPC errors, and recent failures.
- Database batch write duration and persistence failures.
- Reorg and rescan counters.
- Active catch-up session and recent completed sessions.

## Historical runtime retention

All history is bounded in memory:

- Up to 10,000 block samples, with samples older than 24 hours removed.
- Up to 1,000 lag samples.
- Up to 1,000 RPC request events.
- Up to 1,000 processing batch samples.
- Up to 50 catch-up sessions.
- Up to 100 recent RPC errors in the current snapshot.

The analytics response includes retention counts and the oldest retained block/RPC sample timestamps. Requested windows can therefore contain fewer samples than the nominal window when a buffer limit has been reached.

## Endpoints

### GET /api/scanner/status

Returns the current scanner status. The latest finalized block is read from the runtime snapshot populated by the scanner loop. This endpoint does not call RPC.

### GET /api/scanner/analytics?window=1h

Returns runtime history for the requested window. Supported values are:

- `1h`
- `6h`
- `24h`

The response includes the current snapshot, block samples, lag samples, RPC events, catch-up sessions, processing batches, and retention metadata.

## Measurement semantics

- RPC request counts represent individual endpoint attempts. Retried requests are counted separately.
- Block and receipt fetching are measured as separate RPC methods.
- Blocks/sec and transactions/sec use completed block samples from the trailing 60-second window.
- Catch-up sessions begin when lag exceeds the configured parallel-processing threshold and finish when the processed checkpoint reaches the latest observed finalized block. Normal one-block/finality polling lag does not create a catch-up session.
- Actual lag reduction speed is measured from the session's initial lag against its current lag. An ETA is shown only after at least 10 seconds and while the measured net rate is positive. Finalized-chain growth rate is also exposed separately.
- Processing batch samples report the actual block range, number of blocks, transaction count, total batch duration, and database write duration.
- Database write failures are counted separately from RPC and processing failures.

Metrics collection is in-process and non-persistent. It must never block scanner progress or issue extra RPC requests.
