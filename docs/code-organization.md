# Code Organization Conventions

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
