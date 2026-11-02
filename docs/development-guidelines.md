# Development Guidelines

These guidelines define how we write and change code in Ethereum Monitor. They describe the intended direction for new code and refactoring; they do not imply that every existing part of the codebase already complies.

## 1. Core principles

- Prefer the simplest solution that correctly solves the problem.
- Keep code generic where the behavior is genuinely reusable.
- Minimize dependencies and coupling between modules and services.
- Make components easy to extend, replace, or remove without changing unrelated parts of the application.
- Give each module a clear responsibility.
- Prefer explicit, readable code over clever or overly abstract solutions.
- Do not introduce complexity, layers, patterns, or dependencies without a concrete benefit.
- Preserve correctness and data integrity; never trade them for speed or convenience.

## 2. Generic and extensible design

- Prefer reusable behavior over implementations hardcoded for one specific caller or scenario.
- Keep business rules out of generic utilities and infrastructure clients.
- Make extension points explicit and small.
- Avoid assumptions about concrete implementations when a stable interface or shared type is sufficient.
- Do not build a framework or plugin system for a problem that needs only a small module.
- Do not introduce dependency injection, interfaces, factories, or adapters automatically. Use them when they reduce real coupling or make replacement/testing materially easier.
- Avoid circular dependencies and avoid importing types from concrete services when those types belong in a shared location.
- A feature should be removable without requiring unrelated modules to be rewritten.

## 3. Responsibilities and dependencies

Follow the boundaries described in [Code Organization](./code-organization.md):

- Controllers handle HTTP concerns.
- Validators handle request-shape and basic input validation.
- Services coordinate business operations.
- Repositories handle database access.
- Clients encapsulate external communication such as RPC.
- Mappers handle meaningful data-boundary transformations.

Do not bypass an existing boundary without a clear reason. Equally, do not add a new layer for a trivial operation merely to follow a pattern mechanically.

## 4. Functions, types, and configuration

- Functions with more than 3–4 parameters should normally accept one options object with named properties.
- Use clear types for meaningful inputs, outputs, and domain concepts.
- Avoid unnecessary wrappers, duplicate types, and type assertions that hide uncertainty.
- Handle optional and nullable values explicitly; do not assume a value exists and then fail at runtime.
- Keep configuration and runtime constants centralized in the appropriate `src/constants/` modules.
- Avoid magic numbers and repeated configuration literals.
- Use plain numeric literals without numeric separators (for example, `60000`, not `60_000`).

## 5. Reuse without over-abstraction

- Before extracting shared code, confirm that the behavior and its rules are genuinely the same.
- Put shared logic in the layer that owns that responsibility: utility, service, repository, client, or mapper.
- Avoid duplicating complex business logic across services.
- Do not force unrelated behavior into a catch-all helper.
- A small amount of clear duplication is preferable to a confusing abstraction with many flags and special cases.
- Do not make a generic function configurable for hypothetical future needs.

## 6. Errors and logging

- Handle errors at the layer that has enough context to respond correctly.
- Preserve useful error context when propagating failures.
- Do not expose raw stack traces, internal exception messages, SQL details, or provider payloads to API users.
- API errors should be stable, understandable, and safe; detailed diagnostics belong in server logs.
- Do not swallow errors silently or log the same error repeatedly at multiple layers without adding context.
- Log meaningful state transitions and operational failures, not every routine step.

## 7. Changes and reviews

Before changing code:

1. Inspect the existing implementation and its callers.
2. Identify the actual problem and the responsible module.
3. Check whether an existing helper, client, service, or repository already solves it.
4. Consider effects on API contracts, persisted data, runtime state, and recovery behavior.
5. Choose the smallest change that solves the problem without weakening correctness.

During review, check:

- Is the solution simpler than the alternatives?
- Does it introduce unnecessary dependencies or coupling?
- Is the code generic where reuse is real, without becoming over-engineered?
- Can the feature be extended, replaced, or removed without broad unrelated changes?
- Are errors handled safely and clearly?
- Are types and configuration explicit?
- Is any existing behavior or contract changed unintentionally?

## Guiding principle

Write code that is simple, generic where useful, loosely coupled, and easy to understand. The goal is to make the application easy to extend, optimize, change, and simplify—not to maximize abstractions or eliminate every repeated line.
