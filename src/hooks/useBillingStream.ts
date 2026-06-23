'use client';

import { useEffect, useRef } from 'react';
import { useCurrencyPref } from '@/stores/useCurrencyPref';

export interface BillingUpdate {
  deviceId: string;
  amount: string; // Raw u128 string from Soroban
  timestamp: number;
}

export type BillingUpdateHandler = (updates: BillingUpdate[]) => void;

/**
 * Hook that opens a WebSocket connection for billing telemetry updates.
 * When the currency selector interaction is active (isUserInteracting=true),
 * incoming updates are queued in the CurrencyPref store instead of being
 * emitted. The queue is flushed atomically when interaction ends.
 *
 * This prevents the race condition where a currency-format re-render is
 * interrupted mid-way by a telemetry update, resulting in mixed-currency
 * display.
 */
export function useBillingStream(handler: BillingUpdateHandler) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const isUserInteracting = useCurrencyPref((s) => s.isUserInteracting);
  const flushPendingQueue = useCurrencyPref((s) => s.flushPendingQueue);
  const pendingQueue = useCurrencyPref((s) => s.pendingQueue);

  // Open the billing socket once, on mount. Interaction state is read via
  // getState() inside onmessage rather than subscribed as an effect dependency,
  // so toggling the currency selector does NOT tear the socket down and
  // reconnect it (which would drop any messages arriving in the reconnect gap).
  useEffect(() => {
    const ws = new WebSocket('/api/billing/stream');

    ws.onmessage = (event) => {
      try {
        const update: BillingUpdate = JSON.parse(event.data);
        const { isUserInteracting: interacting, queueTelemetryUpdate } = useCurrencyPref.getState();

        if (interacting) {
          // Queue the update — delivered when interaction ends (see below)
          queueTelemetryUpdate({ deviceId: update.deviceId, amount: update.amount });
        } else {
          handlerRef.current([update]);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      // WebSocket errors are non-fatal; the connection will reconnect
    };

    return () => {
      ws.close();
    };
  }, []);

  // When interaction ends, deliver the queued updates to the handler and THEN
  // clear the queue. The store no longer clears it on interaction end, so the
  // updates survive long enough to be delivered here (fixes silent data loss).
  useEffect(() => {
    if (!isUserInteracting && pendingQueue.length > 0) {
      const queuedUpdates: BillingUpdate[] = pendingQueue.map((q) => ({
        deviceId: q.deviceId,
        amount: q.amount,
        timestamp: Date.now(),
      }));
      handlerRef.current(queuedUpdates);
      flushPendingQueue();
    }
  }, [isUserInteracting, pendingQueue, flushPendingQueue]);
}

/**
 * Creates a mock WebSocket-like source for testing.
 * Returns an object with a `send` method that simulates incoming messages.
 */
export function createMockBillingSource() {
  const listeners: Array<(update: BillingUpdate) => void> = [];
  return {
    send(update: BillingUpdate) {
      listeners.forEach((fn) => fn(update));
    },
    subscribe(fn: (update: BillingUpdate) => void) {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
  };
}
