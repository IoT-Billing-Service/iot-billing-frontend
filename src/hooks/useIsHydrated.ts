'use client';

import { useSyncExternalStore } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';

const subscribe = () => () => {};

/**
 * Returns true only on the client after the Zustand persist store has
 * rehydrated from localStorage. Returns false during SSR and on the first
 * client paint before hydration completes.
 */
export function useIsHydrated(): boolean {
  const isMounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const hydrationReady = useDeviceStore((s) => s.hydrationReady);
  return isMounted && hydrationReady;
}
