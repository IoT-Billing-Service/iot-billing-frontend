import { useSyncExternalStore } from 'react';
import { deviceStore } from '@/stores/deviceStore';
import type { DeviceStoreState } from '@/stores/deviceStore';

/**
 * React-concurrent-mode-safe selector hook for the cross-tab device store.
 *
 * Uses `useSyncExternalStore` so that React treats external store updates as
 * transitions rather than urgent updates, preventing telemetry state from
 * pre-empting higher-priority UI work (e.g. user typing in the search box).
 */
export function useDeviceStore<U>(selector: (state: DeviceStoreState) => U): U {
  return useSyncExternalStore(
    deviceStore.subscribe,
    () => selector(deviceStore.getState()),
    () => selector(deviceStore.getInitialState()),
  );
}
