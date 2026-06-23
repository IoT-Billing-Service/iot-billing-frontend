'use client';

import dynamic from 'next/dynamic';
import { useWallet } from '@/components/providers/WalletProvider';
import { RestoreTransactionBanner } from '@/components/wallet/RestoreTransactionBanner';

/**
 * TelemetryChart is a canvas-only component that uses requestAnimationFrame
 * and a Web Worker — neither of which can run on the server. We dynamic-import
 * it with ssr:false so it ships in a separate chunk that is only fetched once
 * the "Analytics" section is actually rendered (lazy boundary).
 */
const TelemetryChart = dynamic(
  () =>
    import('@/components/dashboard/TelemetryChart').then((m) => ({ default: m.TelemetryChart })),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex items-center justify-center rounded border border-gray-700 bg-gray-800"
        style={{ height: 200 }}
        aria-label="Loading telemetry chart…"
      >
        <span className="text-sm text-gray-400">Loading chart…</span>
      </div>
    ),
  },
);

const mockData = Array.from({ length: 100 }, (_, i) => ({
  timestamp: Date.now() - (100 - i) * 1000,
  value: 50 + Math.sin(i * 0.1) * 20 + Math.random() * 10,
}));

export default function DashboardPage() {
  const { metrics } = useWallet();

  if (!metrics?.isConnected) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Connect your wallet to view dashboard data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RestoreTransactionBanner />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <p className="text-xs text-gray-400">Active Devices</p>
          <p className="mt-1 text-2xl font-bold text-green-400">1,247</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <p className="text-xs text-gray-400">Total Power Output</p>
          <p className="mt-1 text-2xl font-bold text-blue-400">84.2 kW</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <p className="text-xs text-gray-400">Escrow Locked</p>
          <p className="mt-1 text-2xl font-bold text-yellow-400">12,450 XLM</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <p className="text-xs text-gray-400">Network</p>
          <p className="mt-1 text-2xl font-bold text-purple-400">{metrics.network}</p>
        </div>
      </div>

      {/* Analytics section — TelemetryChart is lazy-loaded on first render */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">Live Power Output</h3>
        <TelemetryChart data={mockData} metric="Power (W)" />
      </div>
    </div>
  );
}
