'use client';

import { startTransition } from 'react';
import dynamic from 'next/dynamic';
import { useWallet } from '@/components/providers/WalletProvider';
import { useDeviceStore } from '@/hooks/useDeviceStore';
import { deviceStore } from '@/stores/deviceStore';

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

function TelemetryTable() {
  const telemetry = useDeviceStore((s) => s.telemetry);
  const filter = useDeviceStore((s) => s.filter);
  const entries = Object.values(telemetry);

  const filtered = filter
    ? entries.filter((e) => e.deviceId.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">Billing Telemetry</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-xs text-gray-400">
              <th className="pb-2 pr-4">Device ID</th>
              <th className="pb-2 pr-4">Amount</th>
              <th className="pb-2 pr-4">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.deviceId} className="border-b border-gray-800 text-gray-300">
                <td className="py-2 pr-4 font-mono text-xs">{u.deviceId}</td>
                <td className="py-2 pr-4">{u.amount}</td>
                <td className="py-2 pr-4 text-xs text-gray-500">
                  {new Date(u.timestamp).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterInput() {
  const filter = useDeviceStore((s) => s.filter);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    startTransition(() => {
      deviceStore.getState().setFilter(value);
    });
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={filter}
        onChange={handleChange}
        placeholder="Filter devices…"
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 pl-10 text-sm text-gray-200 placeholder-gray-500 focus:border-green-500 focus:outline-none"
      />
      <svg
        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
        />
      </svg>
    </div>
  );
}

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

      {/* Filter input — updates wrapped in startTransition so user typing
          is never blocked by telemetry re-renders */}
      <FilterInput />

      {/* Analytics section — TelemetryChart is lazy-loaded on first render */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">Live Power Output</h3>
        <TelemetryChart data={mockData} metric="Power (W)" />
      </div>

      {/* Cross-tab synced billing telemetry — reads from device store via
          useSyncExternalStore so React treats external updates as transitions */}
      <TelemetryTable />
    </div>
  );
}
