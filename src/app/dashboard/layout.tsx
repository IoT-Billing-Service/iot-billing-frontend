import type { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="border-b border-gray-800 bg-gray-950 px-6 py-3">
        <div className="flex items-center gap-6 text-sm">
          <span className="font-semibold text-green-400">Dashboard</span>
          <span className="text-gray-500">Fleet</span>
          <span className="text-gray-500">Analytics</span>
          <span className="text-gray-500">Escrow</span>
          <span className="text-gray-500">Settings</span>
        </div>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
