# Generic transaction filters

Filters are created and updated through the existing `/api/tx-filters` endpoints. A rule has a root group and may contain nested groups.

## Example

```json
{
    "description": "At least 1 ETH, sent by or to this address",
    "isActive": true,
    "rule": {
        "logic": "AND",
        "conditions": [
            {
                "field": "value",
                "operator": "gte",
                "value": "1000000000000000000"
            }
        ],
        "groups": [
            {
                "logic": "OR",
                "conditions": [
                    {
                        "field": "from",
                        "operator": "eq",
                        "value": "0x1111111111111111111111111111111111111111"
                    },
                    {
                        "field": "to",
                        "operator": "eq",
                        "value": "0x1111111111111111111111111111111111111111"
                    }
                ],
                "groups": []
            }
        ]
    }
}
```

The example means: `value >= 1000000000000000000 AND (from = address OR to = address)`.

Every group requires `logic` (`AND` or `OR`), a `conditions` array, and a `groups` array. Each condition has a field, operator, and value.

## Fields

Allowed fields are `txHash`, `transferType`, `tokenAddress`, `logIndex`, `nonce`, `blockHash`, `blockNumber`, `transactionIndex`, `from`, `to`, `value`, `internalCount`, `status`, `transactionType`, and `timestamp`.

String/address comparisons are case-insensitive. `value` is compared as an exact integer; send it as a JSON string to avoid losing precision. Native-transfer values are in wei. ERC-20 values are in the token's smallest units, so token decimals must be considered by the caller.

## Operators

- `eq`, `ne`: equality and inequality.
- `gt`, `gte`, `lt`, `lte`: numeric, integer, or date comparisons.
- `in`, `notIn`: membership in an array.
- `contains`: substring match for string fields.

## Activation boundaries

An active filter starts at the next block after the latest finalized block observed when the filter is created or its rule is changed. Updating a rule does not reevaluate old blocks. If there are no active filters, the scanner waits without advancing its checkpoint. When filters become active again, it starts from their activation boundary. A scanner pause is different: the checkpoint is preserved, and catch-up resumes from the next unprocessed block.

## Scanner control

- `GET /api/scanner/status`
- `POST /api/scanner/pause` with `{"mode":"temporary"}` for an immediate five-minute pause.
- `POST /api/scanner/pause` with `{"mode":"manual"}` for an immediate manual pause.
- Add `"atBlock": 123456` to request pausing after that block is checkpointed.
- `POST /api/scanner/resume` resumes before a timeout if needed.
