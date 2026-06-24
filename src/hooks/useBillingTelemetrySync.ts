import { startTransition } from 'react';
import { useBillingStream } from './useBillingStream';
import { deviceStore } from '@/stores/deviceStore';

/**
 * Bridges the billing WebSocket stream into the cross-tab device store.
 *
 * Every incoming batch of billing updates is applied via `deviceStore.batchUpdate`
 * inside a `startTransition` so React can defer the render if there are higher-
 * priority updates (e.g. user typing).  The current filter value is preserved
 * during the update to ensure both fields are always committed atomically.
 */
export function useBillingTelemetrySync(): void {
  useBillingStream((updates) => {
    startTransition(() => {
      const state = deviceStore.getState();
      const nextTelemetry = { ...state.telemetry };
      for (const u of updates) {
        nextTelemetry[u.deviceId] = u;
      }
      state.batchUpdate(nextTelemetry, state.filter);
    });
  });
}
