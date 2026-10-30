# Generic transaction filters

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

value is an exact integer represented internally as BigInt. Native transfer values are in wei; ERC-20 values are in the token's smallest units. These units are not normalized across transfer types. Use transferType and, where relevant, tokenAddress together with value.

timestamp is represented in milliseconds since the Unix epoch.

## Operators

- eq, ne: equality and inequality.
- gt, gte, lt, lte: numeric, BigInt, or date comparisons.
- in, notIn: membership in an array (maximum 1000 values).
- between: inclusive range with exactly two values.
- contains: substring match for string fields.

For eq, a null actual value is compared directly with the expected value. ne, notIn, and the comparison operators do not match when the actual value is null or undefined. contains also does not match null or undefined values. in checks whether the set contains the actual value; therefore, a null actual value can match if the supplied array contains null. between requires a non-null actual value and non-null bounds.

## Address validation

Address values used by the from, to, and tokenAddress fields are validated before a filter is created or its rule is updated. The checks run only during filter mutations, not while scanning transfers.

The settings are independent in src/constants/tx-filter-address.constants.ts:

- address: controls validation for from and to.
- tokenContract: controls validation for tokenAddress.
- Each setting has ethers and onChain booleans. Either check can be enabled independently, or both can be enabled. When both are enabled, both must pass.

The ethers check uses ethers.isAddress, including mixed-case checksum validation.

The on-chain check for from and to queries contract code and transaction count. An address with no code and no transaction history is accepted; an empty history does not make an address invalid. The RPC calls must complete successfully.

The on-chain tokenAddress check requires deployed contract code and successful totalSupply() and balanceOf() calls. This is a practical ERC-20 interface check, not a guarantee of full ERC-20 compliance.

An RPC/network failure is reported separately from an invalid address or token contract. It does not silently pass validation.

## Validation, compilation, and execution

The complete rule tree is validated before a filter is saved. Validation checks the logical structure, field names, operators, value types, nesting depth, and node count. The current limits are:

- Maximum nesting depth: 20.
- Maximum rule nodes: 2000.
- Maximum values in an array used by in or notIn: 1000.

These values are implementation constants, not permanent API guarantees. They can be changed in the source configuration.

Dynamic Config loads only records where isActive = true. Each active rule is compiled once into a JavaScript predicate and cached. Membership arrays are prepared as Sets and captured as constants by the generated function.

Each transfer context is passed to every active filter. All matching filters are retained for that transfer. When a filter is deleted, its previous matches keep the original filter ID and description and are marked as FILTER_DELETED for audit history. The scanner does not check activation blocks or interpret the JSON rule tree during matching.

Generated code uses only field accessors and operator templates defined in source-controlled catalogs. Filter values are passed as constants and are never interpolated into executable source. The JavaScript function constructor requires Node.js dynamic code generation to be enabled.

When no active filters exist, the scanner does not advance its processing checkpoint. When filters are activated, processing resumes from the next unprocessed block using the current active filter set. New filters do not trigger automatic historical backfill.

## ERC-20 and failed transactions

Successful ERC-20 transfer logs are processed as individual transfer contexts. Failed ERC-20 transactions do not contain successful transfer logs. The current implementation can create a failed ERC-20 transfer context only when the transaction input can be decoded as a supported transfer or transferFrom call. Other failed contract calls do not produce ERC-20 filter contexts.
