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
  const queueTelemetryUpdate = useCurrencyPref((s) => s.queueTelemetryUpdate);
  const flushPendingQueue = useCurrencyPref((s) => s.flushPendingQueue);
  const pendingQueue = useCurrencyPref((s) => s.pendingQueue);

  useEffect(() => {
    const ws = new WebSocket('/api/billing/stream');

    ws.onmessage = (event) => {
      try {
        const update: BillingUpdate = JSON.parse(event.data);

        if (isUserInteracting) {
          // Queue the update — will be flushed when interaction ends
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
  }, [isUserInteracting, queueTelemetryUpdate]);

  // When interaction ends and queue has data, flush it atomically
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
