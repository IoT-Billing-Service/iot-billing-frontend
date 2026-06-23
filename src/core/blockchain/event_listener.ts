/**
 * event_listener.ts — Polls getLatestLedger() at 5 s intervals.
 * Uses the shared rpcAgent (HTTP/1.1) — no session accumulation on restarts.
 */

import { getLatestLedger, LatestLedger } from './rpc_client';

const HEARTBEAT_INTERVAL_MS = 5_000;

export type LedgerHandler = (ledger: LatestLedger) => void;

export function startLedgerListener(onLedger: LedgerHandler): () => void {
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const ledger = await getLatestLedger();
      if (!stopped) onLedger(ledger);
    } catch (err) {
      // RPC restart / network blip — log and retry next tick
      console.warn('[event_listener] getLatestLedger error:', (err as Error).message);
    }
    if (!stopped) setTimeout(tick, HEARTBEAT_INTERVAL_MS);
  }

  tick();
  return () => { stopped = true; };
}
