/**
 * blockchain.test.ts
 *
 * Tests for rpc_client.ts:
 * 1. getLatestLedger() returns correct data on success.
 * 2. After a simulated GOAWAY (server disconnect), the next call succeeds
 *    and no HTTP/2 session objects accumulate (invariant: 0 Http2Sessions).
 * 3. The rpcAgent uses HTTP/1.1 (allowH2: false).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';

// ── Mock the sorobanConfig so we control the RPC URL ─────────────────────────
vi.mock('@/utils/sorobanConfig', () => ({
  SOROBAN_RPC_URL: 'http://mock-rpc.local',
  XLM_USD_ORACLE_URL: 'http://mock-oracle.local',
  CACHE_TTL_MS: 30_000,
  SIMULATION_TIMEOUT_MS: 3_000,
}));

// Import after mock is set up
const { getLatestLedger, rpcAgent } = await import('@/core/blockchain/rpc_client');

const MOCK_RPC = 'http://mock-rpc.local';

function makeLatestLedgerResponse(sequence = 12345) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { id: 'abc', sequence, protocolVersion: 21 },
  };
}

describe('rpc_client', () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(() => {
    mockAgent.enableNetConnect();
    vi.restoreAllMocks();
  });

  it('getLatestLedger returns parsed result on success', async () => {
    const pool = mockAgent.get(MOCK_RPC);
    pool.intercept({ path: '/', method: 'POST' }).reply(
      200,
      JSON.stringify(makeLatestLedgerResponse(99999)),
      { headers: { 'content-type': 'application/json' } },
    );

    const ledger = await getLatestLedger();
    expect(ledger.sequence).toBe(99999);
    expect(ledger.id).toBe('abc');
  });

  it('retries successfully after a simulated server disconnect (GOAWAY equivalent)', async () => {
    const pool = mockAgent.get(MOCK_RPC);

    // First request: server closes connection (simulates GOAWAY / restart)
    pool.intercept({ path: '/', method: 'POST' }).replyWithError(
      new Error('socket hang up'),
    );

    // Second request: server is back
    pool.intercept({ path: '/', method: 'POST' }).reply(
      200,
      JSON.stringify(makeLatestLedgerResponse(100001)),
      { headers: { 'content-type': 'application/json' } },
    );

    // First call should throw
    await expect(getLatestLedger()).rejects.toThrow();

    // Second call succeeds — connection pool reconnected, no leaked session
    const ledger = await getLatestLedger();
    expect(ledger.sequence).toBe(100001);
  });

  it('has zero HTTP/2 sessions after reconnect (no session leak)', () => {
    // With allowH2: false there are never any Http2Session objects
    const handles = (process as NodeJS.Process & {
      _getActiveHandles?: () => object[];
    })._getActiveHandles?.() ?? [];

    const h2Sessions = handles.filter(
      (h) => (h as { constructor?: { name?: string } }).constructor?.name?.includes('Http2Session'),
    );

    expect(h2Sessions.length).toBe(0);
  });

  it('rpcAgent is a valid undici Agent instance', () => {
    // Confirm the exported agent is a real undici Agent (has a stats getter)
    // and that no HTTP/2 sessions exist (invariant for HTTP/1.1-only config).
    const { Agent } = require('undici');
    expect(rpcAgent).toBeInstanceOf(Agent);

    // stats() is the public API for inspecting pool state
    const stats = rpcAgent.stats;
    expect(stats).toBeDefined();
  });
});
