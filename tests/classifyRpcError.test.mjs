import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRpcError } from '../build/utils/classifyRpcError.js';

test('classifies HTTP 429 as a retryable rate limit', () => {
    const result = classifyRpcError({ response: { status: 429, data: { message: 'Too many requests' } } });
    assert.equal(result.category, 'rateLimit');
    assert.equal(result.retryable, true);
    assert.equal(result.httpStatus, 429);
});

test('classifies nested JSON-RPC -32005 as a retryable rate limit', () => {
    const result = classifyRpcError(new Error(JSON.stringify({
        error: { code: -32005, message: 'Request limit exceeded' },
    })));
    assert.equal(result.category, 'rateLimit');
    assert.equal(result.retryable, true);
    assert.equal(result.rpcCode, -32005);
});

test('classifies provider rate-limit messages without HTTP status', () => {
    const result = classifyRpcError({ cause: { message: 'API rate_limit exceeded' } });
    assert.equal(result.category, 'rateLimit');
    assert.equal(result.retryable, true);
});

test('classifies timeout errors as retryable', () => {
    const result = classifyRpcError({ code: 'ETIMEDOUT', message: 'Request timed out' });
    assert.equal(result.category, 'timeout');
    assert.equal(result.retryable, true);
});

test('classifies network errors as retryable', () => {
    const result = classifyRpcError({ code: 'ECONNRESET', message: 'socket hang up' });
    assert.equal(result.category, 'network');
    assert.equal(result.retryable, true);
});

test('classifies HTTP 503 as a retryable provider error, not a rate limit', () => {
    const result = classifyRpcError({ response: { status: 503, statusText: 'Service Unavailable' } });
    assert.equal(result.category, 'provider');
    assert.equal(result.retryable, true);
    assert.equal(result.httpStatus, 503);
});

test('classifies JSON-RPC application errors as non-retryable RPC errors', () => {
    const result = classifyRpcError({ error: { code: -32602, message: 'Invalid params' } });
    assert.equal(result.category, 'rpc');
    assert.equal(result.retryable, false);
    assert.equal(result.rpcCode, -32602);
});

test('does not interpret arbitrary numeric codes as JSON-RPC codes', () => {
    const result = classifyRpcError({ code: 1234, message: 'Unexpected failure' });
    assert.equal(result.category, 'unknown');
    assert.equal(result.rpcCode, null);
    assert.equal(result.httpStatus, null);
});

test('classifies an unknown error without making it retryable', () => {
    const result = classifyRpcError(new Error('Unexpected failure'));
    assert.equal(result.category, 'unknown');
    assert.equal(result.retryable, false);
});
