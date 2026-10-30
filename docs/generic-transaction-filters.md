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
- `in`, `notIn`: membership in an array.
- `between`: inclusive range with exactly two values.
- `contains`: substring match for string fields.

## Compilation and execution

When Dynamic Config loads active filters, each rule is compiled once into a JavaScript predicate. Membership arrays are prepared as Sets and captured as constants by the generated function. The scanner only calls the compiled predicate for each transfer; it does not parse or traverse the rule tree.

Generated code uses only field accessors and operator templates defined in source-controlled catalogs. Filter values are passed as constants and are never interpolated into executable source.

The compiler limits rule depth to 20 and total nodes to 2000. The JavaScript function constructor requires Node.js dynamic code generation to be enabled.

## Activation boundaries

An active filter starts at the next block after the latest finalized block observed when the filter is created or its rule is changed. Updating a rule does not reevaluate old blocks. If there are no active filters, the scanner waits without advancing its checkpoint. When filters become active again, it starts from their activation boundary. A scanner pause is different: the checkpoint is preserved, and catch-up resumes from the next unprocessed block.
