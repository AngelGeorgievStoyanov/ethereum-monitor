const assert = require('node:assert/strict');
const test = require('node:test');

const { processNativeTransfers } = require('../build/services/nativeTransferService');

const txHash = '0x' + 'a'.repeat(64);
const from = '0x' + '1'.repeat(40);
const to = '0x' + '2'.repeat(40);
const blockHash = '0x' + 'b'.repeat(64);

function makeTransaction() {
    return {
        hash: txHash,
        from,
        to,
        value: 100n,
        nonce: 0,
        type: 2,
    };
}

function makeReceipt(status) {
    return {
        transactionHash: txHash,
        blockHash,
        blockNumber: '0x10',
        transactionIndex: '0x0',
        status,
        logs: [],
    };
}

function makeFilter() {
    return {
        id: 1,
        isActive: true,
        activeFromBlock: null,
        rule: {
            logic: 'AND',
            conditions: [{ field: 'to', operator: 'eq', value: to }],
            groups: [],
        },
    };
}

test('does not classify a failed ETH transaction as a native transfer', async () => {
    const result = await processNativeTransfers(
        [makeTransaction()],
        new Map([[txHash, makeReceipt('0x0')]]),
        [makeFilter()],
        16,
        1_700_000_000,
    );

    assert.equal(result.transfersSeen, 0);
    assert.equal(result.transfersMatched, 0);
    assert.equal(result.candidates.length, 0);
});

test('collects a successful matching ETH transfer for batch persistence', async () => {
    const result = await processNativeTransfers(
        [makeTransaction()],
        new Map([[txHash, makeReceipt('0x1')]]),
        [makeFilter()],
        16,
        1_700_000_000,
    );

    assert.equal(result.transfersSeen, 1);
    assert.equal(result.transfersMatched, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].transfer.value, '100');
});
