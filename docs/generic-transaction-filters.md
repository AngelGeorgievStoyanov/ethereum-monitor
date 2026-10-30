# Generic transaction filters

Filters are created and updated through `/api/tx-filters`. Each filter stores one JSON rule in the `TxFilters.rule` JSONB column.

## Rule structure

A rule is either a condition or a logical group:

- `all`: every child rule must match (AND).
- `any`: at least one child rule must match (OR).
- `not`: the child rule must not match (NOT).
- A condition has `field`, `op`, and `value`.

Groups can be nested.

## Example request

```json
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
```

## Fields

Allowed fields: `txHash`, `transferType`, `tokenAddress`, `logIndex`, `nonce`, `blockHash`, `blockNumber`, `transactionIndex`, `from`, `to`, `value`, `internalCount`, `status`, `transactionType`, and `timestamp`.

Address/hash/string fields configured as case-insensitive are normalized to lowercase when the transaction context is built. `value` is an exact integer represented internally as BigInt. Native values are in wei; ERC-20 values are in the token's smallest units.

## Operators

- `eq`, `ne`: equality and inequality.
- `gt`, `gte`, `lt`, `lte`: comparisons.
- `in`, `notIn`: membership in an array (maximum 1000 values).
- `between`: inclusive range with exactly two values.
- `contains`: substring match for string fields.

## Validation, compilation, and execution

The complete rule tree is validated before a filter is saved. Validation checks the logical structure, field names, operators, value types, nesting depth (maximum 20), and node count (maximum 2000). Validation does not compile or execute the rule.

Dynamic Config loads only records where `isActive = true`. Each active rule is compiled once into a JavaScript predicate and cached. Membership arrays are prepared as Sets and captured as constants by the generated function.

Each transfer context is passed to every active filter. All matching filters are retained for that transfer. When a filter is deleted, its previous matches keep the original filter ID and description and are marked as `FILTER_DELETED` for audit history. The scanner does not check activation blocks or interpret the JSON rule tree during matching.

Generated code uses only field accessors and operator templates defined in source-controlled catalogs. Filter values are passed as constants and are never interpolated into executable source. The JavaScript function constructor requires Node.js dynamic code generation to be enabled.

When no active filters exist, the scanner does not advance its processing checkpoint. When filters are activated, processing resumes from the next unprocessed block using the current active filter set.
