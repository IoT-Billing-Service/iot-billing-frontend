import dynamic from 'next/dynamic';

const WalletPageWrapper = dynamic(() => import('./WalletPageWrapper'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col flex-1 items-center justify-center">
      <main className="flex flex-1 w-full max-w-6xl flex-col gap-8 py-16 px-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-green-400">IoT Billing Service</h1>
            <p className="text-sm text-gray-400">DePIN Dashboard · Soroban Escrow Management</p>
          </div>
          <div className="w-72 h-10 rounded bg-gray-800 animate-pulse" />
        </header>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-lg border border-gray-700 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Fleet Overview</h2>
            <p className="text-sm text-gray-400">Loading wallet interface...</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Escrow Summary</h2>
            <p className="text-sm text-gray-400">Loading escrow module...</p>
          </div>
        </div>
      </main>
    </div>
  ),
});

export default function Home() {
  return <WalletPageWrapper />;
}
