// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { WalletProviders } from '@/components/providers/WalletProviders';
import { useWallet } from '@/components/providers/WalletProvider';

const { nextMockAddress } = vi.hoisted(() => {
  const addrs = [
    'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7AAA1',
    'GA7QYNF7SOWQ3GLR2JGMGEKOV7Y2QH7Y2QH7Y2QH7Y2QH7Y2QH7BBB2',
  ];
  let idx = 0;
  return {
    nextMockAddress: () => {
      const addr = addrs[idx % addrs.length];
      idx++;
      return addr;
    },
  };
});

vi.mock('@stellar/freighter-api', () => {
  class MockWatchWalletChanges {
    watch = vi.fn();
    stop = vi.fn();
  }

  return {
    WatchWalletChanges: MockWatchWalletChanges,
    getAddress: vi.fn(() => Promise.resolve({ address: nextMockAddress(), error: undefined })),
    getNetwork: vi.fn(() =>
      Promise.resolve({
        network: 'testnet',
        networkPassphrase: 'Test SDF Network ; September 2015',
        error: undefined,
      }),
    ),
  };
});

function WalletContextConsumer() {
  const { metrics, connect } = useWallet();
  return (
    <div>
      <span data-testid="wallet-status">{metrics?.isConnected ? 'connected' : 'disconnected'}</span>
      <button data-testid="connect-btn" onClick={connect}>
        Connect
      </button>
    </div>
  );
}

function QueryClientConsumer() {
  const queryClient = useQueryClient();
  return <span data-testid="query-client-available">{queryClient ? 'yes' : 'no'}</span>;
}

describe('WalletProviders', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify([{ asset: 'XLM', balance: '100', decimals: 7 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides both QueryClient and Wallet context to children', () => {
    render(
      <WalletProviders>
        <div>
          <WalletContextConsumer />
          <QueryClientConsumer />
        </div>
      </WalletProviders>,
    );

    expect(screen.getByTestId('wallet-status')).toHaveTextContent('disconnected');
    expect(screen.getByTestId('query-client-available')).toHaveTextContent('yes');
  });

  it('renders children within nested provider hierarchy', () => {
    render(
      <WalletProviders>
        <div data-testid="child-content">Child Content</div>
      </WalletProviders>,
    );

    expect(screen.getByTestId('child-content')).toHaveTextContent('Child Content');
  });

  it('useWallet throws when used outside WalletProviders', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<WalletContextConsumer />);
    }).toThrow('useWallet must be used within WalletProvider');

    consoleSpy.mockRestore();
  });

  it('supports full connection flow via WalletProvider context', async () => {
    render(
      <WalletProviders>
        <WalletContextConsumer />
      </WalletProviders>,
    );

    expect(screen.getByTestId('wallet-status')).toHaveTextContent('disconnected');

    screen.getByTestId('connect-btn').click();

    await waitFor(() => {
      expect(screen.getByTestId('wallet-status')).toHaveTextContent('connected');
    });
  });

  it('surfaces connection errors from WalletProvider', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network request failed')));

    const ErrorConsumer = () => {
      const { error, connect } = useWallet();
      return (
        <div>
          <span data-testid="error-msg">{error ?? 'no-error'}</span>
          <button data-testid="connect-btn" onClick={connect}>
            Connect
          </button>
        </div>
      );
    };

    render(
      <WalletProviders>
        <ErrorConsumer />
      </WalletProviders>,
    );

    screen.getByTestId('connect-btn').click();

    await waitFor(() => {
      expect(screen.getByTestId('error-msg')).not.toHaveTextContent('no-error');
    });
  });
});
