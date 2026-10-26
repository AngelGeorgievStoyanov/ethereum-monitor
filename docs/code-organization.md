# Code organization conventions

## Mappers

Use a dedicated mapper when building an object requires several source fields, values from multiple objects, type conversion, defaults, or domain-specific field mapping.

As a practical guideline, consider a mapper when an object has more than 3–4 fields. This is a guideline, not a hard limit: a small object with non-trivial conversion may still deserve a mapper, while a simple literal object does not need one just because it has several fields.

- Keep mappers in `src/mappers/`.
- Name them after the object or transformation, for example `transactionContextMapper.ts`.
- Mappers transform data; they should not perform database writes, make RPC calls, or decide business outcomes.

## Controllers, validators, and services

- Controllers handle HTTP concerns: read request data, call services, and send responses.
- Request shape and basic input validation belong in `src/validators/`.
- Business rules and domain validation belong in services.
- Reuse `parsePositiveId` for positive integer route IDs.
- Use `HttpError` for an explicit HTTP status and `ValidationError` for domain validation failures.
- Use `sendHttpError` for caught controller errors so status mapping is consistent across endpoints.
- Repositories own persistence queries. Services coordinate business operations and repositories.

Avoid moving all controller logic into services indiscriminately: HTTP validation and business validation are separate responsibilities.
