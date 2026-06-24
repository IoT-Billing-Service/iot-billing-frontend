/**
 * rpc_client.ts
 *
 * Soroban RPC client using undici with an explicit Agent configured for
 * HTTP/1.1 keep-alive. This avoids the HTTP/2 session leak caused by
 * GOAWAY frames during rolling RPC restarts (undici retains dead HTTP/2
 * sessions in its pool for up to MAX_IDLE_TIMEOUT = 300 s, ~2 MB each).
 *
 * Fix strategy (blueprint option 1 + 2):
 *   - Force HTTP/1.1 via `allowH2: false` on the Agent — connections are
 *     cheaply created/destroyed with no session-level leak.
 *   - Aggressive keepAlive timeouts (60 s) so idle sockets are reclaimed
 *     quickly after an RPC restart, bounding worst-case idle memory.
 *   - Session GC guard: periodic check logs if active handle count exceeds
 *     the expected ceiling (safety net for future HTTP/2 re-enablement).
 */

import { Agent, setGlobalDispatcher, fetch as uFetch } from 'undici';
import { SOROBAN_RPC_URL } from '@/utils/sorobanConfig';

// ── Dispatcher ────────────────────────────────────────────────────────────────

export const rpcAgent = new Agent({
  // Force HTTP/1.1 — eliminates HTTP/2 session object entirely.
  allowH2: false,
  // Pool of up to 10 connections per origin.
  connections: 10,
  // Reclaim idle keep-alive sockets after 60 s (vs undici default 4 s for
  // idle timeout but 5-min object lifetime for HTTP/2 sessions).
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
});

// Register as the global dispatcher so every undici.fetch() in this process
// uses the same pool (including stellar-sdk's internal fetch).
setGlobalDispatcher(rpcAgent);

// ── Session GC guard ──────────────────────────────────────────────────────────
// Expected active HTTP/2 session count is 0 (HTTP/1.1 only). If someone
// re-enables HTTP/2 without updating this guard the leak will be logged.
const EXPECTED_H2_SESSIONS = 0;
const GC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function sessionGcTick(): void {
  try {
    const handles = (process as NodeJS.Process & {
      _getActiveHandles?: () => object[];
    })._getActiveHandles?.() ?? [];

    const h2Sessions = handles.filter(
      (h) => (h as { constructor?: { name?: string } }).constructor?.name?.includes('Http2Session'),
    );

    if (h2Sessions.length > EXPECTED_H2_SESSIONS) {
      console.warn(
        `[rpc_client] HTTP/2 session leak detected: ${h2Sessions.length} active sessions ` +
          `(expected ${EXPECTED_H2_SESSIONS}). Destroying excess sessions.`,
      );
      for (const s of h2Sessions) {
        (s as { destroy?: () => void }).destroy?.();
      }
    }
  } catch {
    // _getActiveHandles not available in all environments (e.g. edge runtime)
  }
}

// Only schedule the GC when running in a long-lived Node.js process
if (typeof process !== 'undefined' && typeof setInterval !== 'undefined') {
  const gcTimer = setInterval(sessionGcTick, GC_INTERVAL_MS);
  // unref() so the timer doesn't keep the process alive in tests/scripts
  if (gcTimer.unref) gcTimer.unref();
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

let _reqId = 0;

function makeJsonRpc(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: ++_reqId, method, params });
}

async function rpcPost<T>(body: string): Promise<T> {
  const res = await uFetch(SOROBAN_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    // dispatcher is the globalDispatcher set above (rpcAgent)
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LatestLedger {
  id: string;
  sequence: number;
  protocolVersion: number;
}

/** Heartbeat: called every 5 s. Uses pooled HTTP/1.1 — no session leak. */
export async function getLatestLedger(): Promise<LatestLedger> {
  return rpcPost<LatestLedger>(makeJsonRpc('getLatestLedger', []));
}

export interface SendTransactionResult {
  hash: string;
  status: string;
  errorResultXdr?: string;
}

export async function sendTransaction(txXdr: string): Promise<SendTransactionResult> {
  return rpcPost<SendTransactionResult>(
    makeJsonRpc('sendTransaction', { transaction: txXdr }),
  );
}

export interface GetTransactionResult {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
  ledger?: number;
  resultXdr?: string;
}

export async function getTransaction(hash: string): Promise<GetTransactionResult> {
  return rpcPost<GetTransactionResult>(makeJsonRpc('getTransaction', { hash }));
}
