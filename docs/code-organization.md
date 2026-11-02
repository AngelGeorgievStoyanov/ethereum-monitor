# Code Organization Conventions

> **Project scope:** These are lightweight project guidelines for a single-network EVM blockchain monitoring system, not a claim that every existing module already follows every rule. The current codebase contains some existing deviations (including services that call repository functions directly). Treat the guidelines as the intended direction for future changes and identify existing deviations explicitly during reviews. Do not add layers or abstractions solely to satisfy the document when they do not provide practical value. For a substantially larger system or production deployment, the architecture must be redesigned and the main responsibilities must be separated into independent services that can be scaled independently.


## Related development documents

Use these documents together:

- [Development Guidelines](./development-guidelines.md) — coding principles, generic and loosely coupled design, dependencies, simplicity, errors, and code reviews.
- [Performance Guidelines](./performance-guidelines.md) — evidence-based optimization, avoiding unnecessary DB/RPC work, caching, memory, batching, and correctness.
- This document — module responsibilities, dependency direction, and approved runtime behavior.

## 1. Controllers

Controllers are responsible for the HTTP layer only.

- Read request data, invoke the appropriate validation and service methods, and send the HTTP response.
- Pass validated input to services.
- Return the complete response prepared by the service.
- Do not contain business logic, access the database, use ORM models, or call repositories directly.
- Do not query, combine, filter, or map data from multiple sources.
- Do not build response DTOs or transform ORM objects.
- Keep controllers thin and predictable.

## 2. Validators

Keep request-shape and basic input validation in dedicated functions or modules under `src/validators/`.

- Validate types, required fields, formats, limits, and allowed values.
- Keep HTTP input validation separate from business rules and domain validation.
- Validators must not access repositories or ORM models, perform business operations, or build API responses.
- Return a clearly defined validated input type for the service to use.
- Reuse existing validation helpers where appropriate, such as `parsePositiveId`.
- Use the established error types and HTTP error handling conventions, including `HttpError`, `ValidationError`, and `sendHttpError`, where applicable.

## 3. Services

Services coordinate business logic and application operations.

- Do not access the database or call ORM methods directly, including `findAll()`, `findOne()`, `findByPk()`, `create()`, or `update()`.
- Perform persistence operations through repositories.
- Use repository methods with a clear purpose, such as `findLatestScannerState()`, rather than retrieving a generic set of ORM records and interpreting them in the service.
- Use the appropriate client for external communication instead of making direct RPC, HTTP, or other protocol-specific requests from the service.
- Coordinate repositories, clients, dynamic configuration, and other services as required.
- Do not depend on HTTP request or response objects.
- For API operations, call the appropriate mapper and return the complete response DTO to the controller.
- Avoid duplicating logic already provided by an appropriate service, client, or shared component.

A service should decide what operation needs to happen, not implement database access, external protocol communication, or HTTP response handling itself.

## 4. Repositories

Repositories are the only application layer that accesses ORM models and performs database queries and writes.

- Provide purpose-specific methods that reflect application needs.
- Do not expose raw ORM model instances to services.
- Convert ORM results into clearly defined data structures before returning them to services.
- Accept explicit persistence input structures prepared by the appropriate mapper.
- Do not contain HTTP concerns or coordinate entire business workflows.
- Avoid generic methods when they force services to understand query details or interpret raw persistence results.
- Keep each repository focused on persistence responsibilities.

Prefer `findLatestScannerState()` over a generic `findAll()` when the caller needs one specific result. Generic repository methods are acceptable only when they genuinely fit the use case and do not transfer query responsibility to the service.

## 5. Clients

Clients encapsulate communication with external systems and expose reusable, purpose-specific methods. This applies to every client, including RPC clients, HTTP API clients, and clients for other external services.

- When a dedicated client exists, services must use its methods instead of communicating with the external system directly.
- Expose methods that represent clear operations, such as fetching a block, retrieving receipts, or checking an external system's status.
- Design client methods for reuse by multiple services when the same operation is needed in more than one place.
- Encapsulate protocol-specific details such as request construction, response parsing, timeouts, communication errors, and retry behavior where appropriate.
- Keep business rules specific to a single service out of general-purpose clients.
- Do not access the database from a client.
- Reuse common communication mechanisms when doing so improves clarity and maintainability.
- Return clearly defined results rather than leaking raw protocol responses or transport details unnecessarily.
- Avoid turning a client into a catch-all module for unrelated external systems.

For example, services should call the shared RPC client's block and receipt methods rather than independently constructing RPC requests. If several services need the same RPC operation, they should reuse the client method rather than reimplementing the communication.

## 6. Mappers and DTOs

Mappers are required at defined layer boundaries and for explicit persistence and API data structures. They are not required for every ordinary internal function call.

### Persistence

- Map input into an explicit persistence structure before passing it to a repository.
- Do not blindly pass arbitrary controller input or another layer's ORM object into a database write.
- Explicitly select the fields that are allowed to be persisted.

### Reading and API responses

- Convert ORM results into clearly defined structures before they leave the repository.
- Build API response DTOs through an explicit mapper.
- The service calls the response mapper and returns the completed DTO to the controller.
- The controller sends that response without assembling or mapping its fields.

### General rules

- Adding a field to an ORM model must not automatically expose it in API responses or persistence inputs.
- API or persistence contract changes require explicit updates to the relevant DTOs and mappers.
- Mappers must not perform database queries, RPC calls, or business decisions.
- Do not add mapper calls to simple internal function-to-function interactions when no meaningful boundary or transformation exists.
- Use a mapper when crossing a layer boundary, translating between different data models, or building an explicit DTO or persistence structure.

## 7. Dependency direction

Keep dependencies clear and avoid circular dependencies.

The main application flow is:

`Controller → Validator / Service → Repository → Database`

External communication follows:

`Service → Client → External System`

Mappers are used at the relevant data boundaries.

- Controllers must not call repositories or external clients directly to perform business operations.
- Services must not use ORM APIs or bypass dedicated clients for RPC/HTTP communication.
- Repositories must not depend on controllers or HTTP objects.
- Clients must not depend on the business services that use them.
- Validators and mappers must not call repositories.
- Shared types must not be imported from concrete service implementations merely because they were first defined there.
- Place shared types in an appropriate shared or domain location.
- Avoid circular module dependencies.

## 8. Function parameters

Function signatures should be easy to read and difficult to misuse.

- When a function has more than 3–4 parameters, group the parameters into a single object with named properties.
- Define a dedicated type or interface when the parameters represent a meaningful operation or business context.
- Avoid long lists of positional arguments that are easy to mix up.
- Do not introduce unnecessary types for trivial cases when they add no meaningful value.
- Update all affected call sites when a signature changes.

## 9. Avoiding duplicated code

Reuse common logic when doing so is reasonable and technically appropriate, but do not eliminate duplication at any cost.

- When the same logic appears in multiple places, consider extracting a shared function, service, repository method, client method, or module, depending on its responsibility.
- Shared code must have a clear purpose and ownership.
- Do not create catch-all utility modules that combine unrelated behavior.
- Do not merge implementations with genuinely different business rules merely because they look similar.
- Avoid extra abstraction layers that make the code harder to understand without providing a concrete benefit.
- Prefer clear, maintainable code over mechanical elimination of every repeated line.

## 10. Component responsibilities

Keep responsibilities clear without creating a separate file or layer for every small function.

- **Controller:** HTTP request and response handling.
- **Validator:** request-shape and basic input validation.
- **Service:** business logic and application-level coordination.
- **Repository:** database queries and persistence.
- **Client:** reusable communication with an external system.
- **Mapper:** explicit transformation between data structures.
- **Dynamic configuration:** loading and providing dynamic application configuration.
- **Monitoring:** scanner status, metrics, and observability.
- **Recovery:** reorganization and recovery workflows, including blockchain reorg handling.

These boundaries are guidelines for responsibility, not a requirement to split every small operation into its own file. Avoid components that accumulate too many unrelated responsibilities.

## 11. Application startup

`src/index.ts` should be the application entry point and composition root.

- Initialize required dependencies and start the application in the correct order.
- Delegate work to the appropriate components.
- Do not place business logic, database queries, mapping, or complex scanner/recovery workflows in the entry point.
- Avoid blanket infinite retry loops that repeat every startup error without distinguishing its cause.
- Place retry policies in the component that understands the operation and can determine which failures are retryable.

## 12. API contracts

Keep API contracts explicit and stable.

- Give request and response DTOs clear types and purposes.
- Validate required fields explicitly.
- Distinguish fields that may be `null` from fields that may be omitted.
- Do not expose new ORM fields automatically through API responses.
- When a contract changes, update the relevant validators, DTOs, mappers, and affected consumers.
- Do not use database models as public API models by default.

## 13. Code review checklist

When reviewing or changing code, check that:

1. Controllers handle only HTTP concerns.
2. Validation is separated from controllers.
3. Services coordinate business operations without directly accessing ORM.
4. Repository methods have clear, purpose-specific responsibilities.
5. Repositories return defined data structures rather than raw ORM instances.
6. Services use dedicated clients for external communication.
7. Client methods are reusable and purpose-specific.
8. Mappers are used for persistence inputs and API responses where required.
9. New fields require explicit updates to DTOs and mappers.
10. Dependencies follow the intended direction and do not form cycles.
11. Functions with more than 3–4 parameters use an object parameter.
12. Duplicated logic is reused when appropriate, without introducing harmful abstractions.
13. Components do not accumulate unrelated responsibilities.
14. The application entry point remains focused on initialization and startup.
15. Existing API contracts are preserved unless the change explicitly updates them.
16. Reports identify changed files, checks performed, and their actual results.

## Guiding principle

Organize the application into clear layers with explicit responsibilities. Services coordinate operations, repositories handle persistence, clients encapsulate external communication, and mappers control data transformations.

The goal is not to maximize the number of files or abstractions. The goal is predictable, readable, maintainable code that can evolve without unnecessary coupling or mixed responsibilities.

## 14. Runtime behavior and performance rules

These rules document the approved runtime design. They are intended to prevent future changes from reintroducing unnecessary database or RPC work, weakening reorganization safety, or moving calculations into Dynamic Config.

### Scanner

- The application is designed to run as a single scanner instance. Do not add a Scanner advisory lock or multi-instance coordination mechanism unless the deployment architecture explicitly changes.
- Keep the normal Scanner polling interval at the configured `SCANNER_POLL_INTERVAL_MS` (currently 4000 ms). Do not reduce or increase it based on guesswork; use runtime metrics first.
- Keep finalized catch-up bounded by `MAX_BLOCKS_PER_FINALIZED_CATCHUP` (currently 100 blocks per cycle).
- When the scanner is close to the finalized head (lag at or below `SCANNER_PARALLEL_PROCESSING_LAG_BLOCKS`, currently 100), process one block at a time. When further behind, parallel processing may use up to `SCANNER_MAX_PARALLEL_BLOCKS` (currently 3).
- Keep checkpoint and other frequently needed scanner state in memory where safe. The database transaction must remain the final integrity guard: verify the expected checkpoint and parent-hash continuity before committing processed data.
- Do not add a database read on every polling cycle merely to reload a checkpoint already held in the active runtime state.

### Dynamic configuration and scanner controls

- Dynamic Config is a passive in-memory snapshot store. It must not calculate business state, derive metrics, or own scanner/recovery decisions. The responsible service calculates state and publishes the resulting snapshot.
- Scanner Pause/Resume is persisted to PostgreSQL and read into Dynamic Config at startup and every `SCANNER_CONTROL_FAST_REFRESH_INTERVAL_MS` (currently 30000 ms).
- The Scanner reads the in-memory pause snapshot; it must not query PostgreSQL on every block or polling cycle for Pause/Resume.
- If a periodic pause-state refresh fails, retain the last successfully loaded state. Do not replace it with a guessed default or stop the scanner solely because a later refresh failed.
- A Pause/Resume request is not an immediate in-memory switch. It is applied by the next successful refresh.
- Active transaction filters are loaded into an in-memory cache and refreshed according to `TX_FILTER_CACHE_REFRESH_INTERVAL_MS` (currently 60000 ms), as well as after successful local filter mutations. A failed refresh must not discard the last successfully loaded filter configuration.
- Keep refresh intervals and processing limits in the appropriate files under `src/constants/`; do not scatter hardcoded timing or batch values through services.

### Manual Rescan

- Load stored canonical block identities in batches using `RESCAN_BLOCK_IDENTITY_BATCH_SIZE` (currently 100), rather than querying the database separately for every block.
- Use the shared `iterateBlockRangeBatches` utility for forward or backward inclusive block-range pagination when the same batching behavior is needed by multiple workflows.
- Fetch each block and its receipts once for normal Rescan processing, then pass the fetched data through processing. Do not fetch the same block again unless a mismatch requires verification.
- Normal Rescan does not run strict provider consensus for every block. First compare the fetched block identity with the stored canonical identity. Invoke strict consensus only when a mismatch is detected.
- A mismatch confirmed by strict consensus is a reorganization signal and must follow the existing Reorg Recovery handoff. If consensus confirms the stored identity but the initially fetched response disagrees, stop conservatively; do not silently process a different provider response.
- Persist and publish Rescan progress every `RESCAN_PROGRESS_UPDATE_INTERVAL_BLOCKS` blocks (currently 50), and always publish the final progress on completion or failure. Candidate persistence uses its own `RESCAN_CANDIDATE_BATCH_SIZE` limit (currently 500 candidates), so large candidate sets are flushed before the 50-block progress interval. A single block's prepared candidate array still exists while that block is processed; the candidate batch limit bounds accumulation across blocks, not the temporary result for one block.
- Keep progress logging frequency separate from progress persistence frequency; use the dedicated constants in `src/constants/rescan.constants.ts`.

### Reorganization detection and recovery

- Strict provider consensus is reserved for a detected block-identity mismatch / reorganization verification. Do not add consensus calls to normal Scanner processing or normal Rescan processing.
- Strict consensus means every configured RPC provider must agree on the block identity. Do not replace this with majority voting.
- Keep the ancestor search bounded by `MAX_REORG_LOOKBACK_BLOCKS` (currently 100) and query stored identities in backward batches of `REORG_ANCESTOR_BATCH_SIZE` (currently 10). Search backward from the block immediately before the mismatching checkpoint and stop at the first confirmed common ancestor.
- Reuse the in-memory checkpoint/canonical-identity cache where valid to avoid redundant database reads, but never remove the transactional checkpoint and parent-hash integrity checks.
- Keep Recovery state transitions and rollback/reprocessing decisions in the Recovery workflow. Do not move these decisions into Dynamic Config.
- When optimizing Recovery RPC calls, preserve strict all-provider identity verification. The approved data-reuse approach is to obtain one full block response from one provider and identity-only responses from the other providers, compare all identities, and reuse the already fetched full block after consensus succeeds. Do not fetch three full copies of the block merely for consensus. This optimization must not weaken provider agreement requirements; receipts remain a separate processing input and must not be assumed to be included in the block response.
- This RPC response-reuse optimization is implemented: the Recovery call path receives one full block response, verifies its identity against identity-only responses from the other configured providers, and reuses that full response after consensus succeeds. Receipts remain a separate processing input.

### Metrics and analytics

- Metrics aggregation/publishing runs at `METRICS_PUBLISH_INTERVAL_MS` (currently 10000 ms).
- Scanner analytics are calculated on demand for the requested window. The most recently requested result is cached for `METRICS_ANALYTICS_REFRESH_INTERVAL_MS` (currently 30000 ms); analytics are not precomputed for every window during the 10-second runtime metrics publication. Each analytics calculation sorts the retained RPC durations once and reuses that ordering for the requested window. Retained RPC events use a head index for constant-time removal; the backing array is compacted periodically using `METRICS_RPC_EVENT_COMPACTION_THRESHOLD`, rather than shifting the full array for every expired event. Block and lag sample retention also uses head indexes with periodic compaction via `METRICS_SAMPLE_COMPACTION_THRESHOLD`, avoiding repeated array shifts.
- Dashboard polling and RPC event collection are separate concerns; do not change their cadence merely to change the metrics snapshot publishing interval.
- Dynamic Config stores the latest runtime metrics snapshot only; the analytics cache is owned by the metrics aggregator.
- Database query metrics classify `WITH` statements by the main statement after their CTE definitions, so data-changing CTEs are counted as writes rather than reads.

### Constants and code style

- Put scanner, Rescan, Recovery, and metrics timing/batch/limit values in their relevant files under `src/constants/`.
- Use plain numeric literals without numeric separators (for example, `60000`, not `60_000`).
- When changing a runtime interval or batch size, update the relevant constant and any runtime/status documentation that exposes the value. Avoid duplicating the same value as a separate hardcoded literal.

