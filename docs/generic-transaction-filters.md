# Generic transaction filters

> **Project scope:** This filter engine is part of a lightweight, single-network EVM blockchain monitoring system. It evaluates rules against the transfer contexts currently produced by this application; it is not a general-purpose EVM transaction engine or a production-scale filtering platform. For a substantially larger system or production deployment, the architecture must be redesigned and the main responsibilities, including ingestion, filtering, persistence, and event delivery, must be separated into independent services that can be scaled independently.


Filters are created and updated through /api/tx-filters. Each filter stores one JSON rule in the TxFilters.rule JSONB column.

## Rule structure

A rule is either a condition or a logical group:

- all: every child rule must match (AND).
- any: at least one child rule must match (OR).
- not: the child rule must not match (NOT).
- A condition has field, op, and value.

Groups can be nested.

## Example request

    {
        "description": "Large transfers of selected tokens",
        "isActive": true,
        "rule": {
            "all": [
                {
                    "field": "blockNumber",
                    "op": "between",
                    "value": [20000000, 21000000]
                },
                {
                    "any": [
                        {
                            "field": "tokenAddress",
                            "op": "in",
                            "value": [
                                "0x1111111111111111111111111111111111111111",
                                "0x2222222222222222222222222222222222222222"
                            ]
                        },
                        {
                            "field": "tokenAddress",
                            "op": "eq",
                            "value": "0x3333333333333333333333333333333333333333"
                        }
                    ]
                },
                {
                    "any": [
                        { "field": "value", "op": "gte", "value": "1000000000000000000" },
                        { "field": "value", "op": "lt", "value": "100000000000000000" }
                    ]
                },
                {
                    "not": {
                        "field": "from",
                        "op": "in",
                        "value": [
                            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                        ]
                    }
                }
            ]
        }
    }

## Fields

Usable fields:

- txHash
- transferType
- tokenAddress
- logIndex
- nonce
- blockHash
- blockNumber
- transactionIndex
- from
- to
- value
- status
- transactionType
- timestamp

internalCount is still present in the field registry, but the current transaction context mapper always sets it to null. It is not currently usable for meaningful filtering. Internal trace transfers are also not processed, so they do not produce filter contexts.

Address, hash, and selected string fields are normalized to lowercase when the transaction context is built. The status field is either success or failed.

Each filter context represents one transfer, not one raw blockchain transaction. A native transaction produces its native transfer context. An ERC-20 transaction can produce multiple contexts when it contains multiple matching transfer logs. All active filters are evaluated separately for each context.

The filter engine is a generic Boolean rule engine over this predefined transfer context. It supports nested all (AND), any (OR), and not (NOT) groups. It is not intended to interpret every possible EVM transaction shape.

value is an exact integer represented internally as BigInt. Native transfer values are in wei; ERC-20 values are in the token's smallest units. These units are not normalized across transfer types. Use transferType and, where relevant, tokenAddress together with value.

timestamp is represented in milliseconds since the Unix epoch.

## Operators

- eq, ne: equality and inequality.
- gt, gte, lt, lte: numeric, BigInt, or date comparisons.
- in, notIn: membership in an array (maximum 1000 values).
- between: inclusive range with exactly two values.

For eq, a null actual value is compared directly with the expected value. ne, notIn, and the comparison operators do not match when the actual value is null or undefined. in checks whether the set contains the actual value; therefore, a null actual value can match if the supplied array contains null. between requires a non-null actual value and non-null bounds.

## Address validation and capacity

Address values used with eq, ne, in, and notIn on the from, to, and tokenAddress fields are subject to the configured address format validation before a filter is created or its rule is updated. These checks run only during filter mutations, not while scanning transfers.

The independent settings are in src/constants/tx-filter-address.constants.ts:

- address.ethers controls validation for from and to.
- tokenContract.ethers controls validation for tokenAddress.
- Set either ethers option to false to disable that format check. The two settings can be configured independently.

When enabled, the check uses ethers.isAddress, including mixed-case checksum validation. It validates address syntax and checksum only. It does not check whether an address has transaction history, deployed code, or an ERC-20 contract.

Address validation makes no RPC calls and does not depend on RPC availability.

The capacity limits are defined in src/constants/tx-filter.constants.ts:

- Maximum 20 unique address values in one filter rule, across from, to, and tokenAddress.
- Maximum 50 active filters.
- Inactive filters do not count toward the active-filter limit.
- The general maximum array size for in and notIn remains 1000, but address values are additionally subject to the 20-address limit.

The active-filter limit is checked inside the transaction-filter mutation advisory lock. This makes creation and activation checks serial, preventing concurrent requests from exceeding the configured limit.

These limits are intended for a lightweight transaction-filter feature. If the application needs substantially more addresses or active filters, do not simply increase the limits. A separate address-monitoring microservice with a message queue or event bus is a better architecture. It can manage large address subscriptions, batch and schedule RPC requests, enforce independent rate limits, and publish detected events. This isolates high-volume address monitoring from the main scanner and filter evaluation flow.

## Validation, compilation, and execution

The complete rule tree is validated before a filter is saved. Validation checks the logical structure, field names, operators, value types, nesting depth, and node count. The current limits are:

- Maximum nesting depth: 20.
- Maximum rule nodes: 2000.
- Maximum values in an array used by in or notIn: 1000.

These values are implementation constants, not permanent API guarantees. They can be changed in the source configuration.

Dynamic Config loads only records where isActive = true. Each active rule is validated and compiled through the same validation-and-compilation path used before a filter is created or activated. Each valid rule is compiled once and cached. Membership arrays are prepared as Sets and captured as constants by the generated function.

A malformed active filter is isolated: it is logged with its filter ID and excluded from the active configuration, while valid filters continue loading. The filter is retried no more than once per 60-second interval. Retry counters are in memory and reset when the process restarts. The service intends to deactivate a filter after three consecutive failed attempts, but the current deactivation guard has a code defect: it compares the serialized database rule with the SHA-256 signature calculated during loading. Those values cannot match, so automatic deactivation does not currently work as documented. This must be corrected in code before relying on automatic deactivation. The intended guard is to compare the current database rule's signature with the signature from the failed load, preventing a concurrent valid update from being deactivated.

Each instance calculates a content-based configuration version and logs the version when it applies a changed configuration. The scanner captures one configuration snapshot at the start of each normal block batch and uses that snapshot for the entire batch. Reorg recovery captures a fresh snapshot for each block. An in-flight batch finishes with the version it started with; the next batch uses the latest version applied by that instance. Local API mutations refresh the local instance immediately. Other instances discover changes on their next periodic refresh, scheduled every 60 seconds, provided the database is reachable. A failed refresh retains the last successfully applied configuration.

Each transfer context is passed to every active filter. All matching filters are retained for that transfer. When a filter is deleted, its previous matches keep the original filter ID and description and are marked as FILTER_DELETED for audit history. The scanner does not check activation blocks or interpret the JSON rule tree during matching.

Generated code uses field accessors, supported field/operator combinations, and operator templates defined in one source-controlled registry. Filter values are passed as constants and are never interpolated into executable source. After compilation, runtime snapshots retain the filter ID, description, a SHA-256 rule signature, and the compiled predicate; the original rule JSON is not retained in the runtime filter object. The JavaScript function constructor requires Node.js dynamic code generation to be enabled.

When no active filters exist, the scanner does not advance its processing checkpoint. When filters are activated, processing resumes from the next unprocessed block using the current active filter set. New filters do not trigger automatic historical backfill.

## ERC-20 and failed transactions

Successful ERC-20 transfer logs are processed as individual transfer contexts. Failed ERC-20 transactions do not contain successful transfer logs. The current implementation can create a failed ERC-20 transfer context only when the transaction input can be decoded as a supported transfer or transferFrom call. Other failed contract calls do not produce ERC-20 filter contexts.
