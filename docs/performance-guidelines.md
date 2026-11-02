# Performance Guidelines

These guidelines describe how to optimize Ethereum Monitor without making the code unnecessarily complex or compromising correctness. Runtime-specific approved values and workflows are documented in [Code Organization](./code-organization.md#14-runtime-behavior-and-performance-rules).

## 1. Start with evidence

- Identify the actual bottleneck before optimizing.
- Use logs, metrics, query counts, RPC counters, timings, and profiling where available.
- Do not change polling intervals, batch sizes, concurrency, or caching based on guesswork.
- Prefer a small measurable improvement over a broad redesign.
- Record the expected benefit and the correctness risks of a proposed optimization.

## 2. Avoid unnecessary I/O

- Do not make redundant database or RPC requests.
- Reuse data already fetched during the current operation when it is still valid.
- Do not query the database for state that is already reliably available in memory.
- Avoid per-item queries when one bounded range query or batch operation can safely provide the required data.
- Do not fetch full external payloads when only a small identity or metadata response is needed.
- Do not repeat a request just because the data was passed through another layer; pass the fetched result to the next operation when appropriate.
- Keep retries bounded and specific to failures that may recover.

## 3. Cache deliberately

- Add a cache only when there is a clear performance or load benefit.
- Every cache must have an explicit owner, lifetime, refresh/invalidation rule, and failure behavior.
- Define what happens when refresh succeeds, fails, or returns incomplete data.
- Retain the last known-good value when that is safe; do not silently replace it with guessed defaults.
- Invalidate or update cached state after relevant successful writes.
- Do not create multiple caches for the same data without a clear reason.
- Do not cache data whose correctness depends on freshness unless the acceptable staleness is explicitly defined.

## 4. Control memory usage

- Do not keep large objects, full block payloads, receipts, transaction arrays, or unbounded histories in memory without a concrete need.
- Prefer streaming or bounded batches for large ranges.
- Release processed batch data when it is no longer needed.
- Keep only the minimal state required between progress updates.
- Bound caches and in-memory collections, and define their cleanup behavior.
- Progress batching must not turn into accumulation of the underlying processing data.

## 5. Batch and parallel processing

- Use batching when it reduces database/RPC overhead or improves throughput.
- Keep batch sizes bounded and configurable in the appropriate constants module.
- Choose batch sizes based on measured performance and provider/database limits.
- Use parallelism only when operations are independent and ordering/integrity requirements remain satisfied.
- Do not parallelize sequential workflows such as recovery steps when order is required for correctness.
- Ensure partial failures cannot advance checkpoints or leave partially committed state.
- Keep database transactions and integrity checks around state changes that must be atomic.

## 6. Correctness before speed

- Never weaken canonical block identity checks, checkpoint validation, parent-hash continuity, transaction boundaries, or strict reorg verification to gain performance.
- Do not replace strict all-provider agreement with majority voting.
- Do not run strict consensus during normal Scanner or normal Rescan processing; it is reserved for detected identity mismatches/reorg verification.
- Optimizations must preserve the approved single-instance architecture unless the deployment requirements explicitly change.
- If an optimization makes behavior harder to reason about or recover from, prefer the safer simpler implementation.

## 7. Avoid duplicate work and logic

- Reuse existing fetched results, shared utilities, and purpose-specific client methods.
- Do not implement the same query, RPC request construction, retry policy, or business rule independently in multiple services.
- Keep shared logic in the module that owns it.
- Avoid broad abstractions that combine workflows with different correctness requirements.
- Keep Dynamic Config as a passive snapshot store; calculations and decisions belong to the responsible services.

## 8. Configuration and observability

- Centralize polling intervals, timeouts, batch sizes, concurrency limits, and cache refresh intervals under the appropriate `src/constants/` modules.
- Avoid scattering hardcoded values across services.
- Keep logging cadence separate from database progress-persistence cadence.
- Measure the effect of a change using the relevant metrics; do not infer success from code shape alone.
- Update runtime documentation when an approved interval, limit, or processing behavior changes.

## Optimization review checklist

Before accepting an optimization, verify:

1. What measured or observable problem does it solve?
2. Does it remove actual DB/RPC work or reduce memory/CPU usage?
3. Can existing data be reused safely instead of fetched again?
4. Is any cache bounded and governed by explicit refresh/invalidation rules?
5. Is memory usage bounded for large ranges?
6. Are batch sizes and concurrency appropriate and configurable?
7. Are ordering, transactions, checkpoints, and reorg guarantees preserved?
8. Does it avoid introducing unnecessary dependencies or abstractions?
9. Is the resulting code easier—not harder—to understand and maintain?
10. What evidence will confirm that the optimization helped?

## Guiding principle

Optimize measured problems, not imagined ones. Remove unnecessary work while keeping the implementation simple, bounded, observable, and correct.
