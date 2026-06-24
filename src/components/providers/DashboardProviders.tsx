'use client';

/**
 * DashboardProviders
 *
 * Providers that are only needed on wallet-connected routes (/dashboard, /escrow).
 * By keeping WalletProvider and QueryProvider out of the root layout, the Stellar
 * SDK bundle (@stellar/stellar-sdk, @stellar/freighter-api) is excluded from the
 * initial / route chunk and only loaded when the user navigates here.
 *
 * Also initialises the cross-tab BroadcastChannel sync for the device store and
 * bridges the billing WebSocket stream into it so telemetry is available across
 * all tabs via a single versioned state snapshot.
 */

import { type ReactNode, useEffect } from 'react';
import { QueryProvider } from './QueryProvider';
import { WalletProvider } from './WalletProvider';
import { deviceStore } from '@/stores/deviceStore';
import { initCrossTabSync } from '@/services/crossTabSync';
import { useBillingTelemetrySync } from '@/hooks/useBillingTelemetrySync';

export function DashboardProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    const cleanup = initCrossTabSync(deviceStore);
    return cleanup;
  }, []);

  useBillingTelemetrySync();

  return (
    <QueryProvider>
      <WalletProvider>{children}</WalletProvider>
    </QueryProvider>
  );
}
