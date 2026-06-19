// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WalletPageWrapper from '@/app/WalletPageWrapper';

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

describe('WalletPageWrapper', () => {
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

  it('renders the page heading and key sections', () => {
    render(<WalletPageWrapper />);

    expect(screen.getByText('IoT Billing Service')).toBeInTheDocument();
    expect(screen.getByText('DePIN Dashboard · Soroban Escrow Management')).toBeInTheDocument();
    expect(screen.getByText('Fleet Overview')).toBeInTheDocument();
    expect(screen.getByText('Escrow Summary')).toBeInTheDocument();
  });

  it('shows Connect Freighter Wallet button when wallet is disconnected', () => {
    render(<WalletPageWrapper />);

    expect(
      screen.getByRole('button', { name: 'Connect Freighter Wallet' }),
    ).toBeInTheDocument();
  });

  it('does not show DeviceProvisioner when wallet is not connected', () => {
    render(<WalletPageWrapper />);

    expect(screen.queryByText('Device Provisioning')).not.toBeInTheDocument();
  });

  it('shows DeviceProvisioner and hides connect button after wallet connects', async () => {
    render(<WalletPageWrapper />);

    screen.getByRole('button', { name: 'Connect Freighter Wallet' }).click();

    await waitFor(() => {
      expect(screen.getByText('Device Provisioning')).toBeInTheDocument();
    });

    // Connect button should be gone — replaced by connected state
    expect(
      screen.queryByRole('button', { name: 'Connect Freighter Wallet' }),
    ).not.toBeInTheDocument();
  });

  it('hides DeviceProvisioner after wallet disconnects', async () => {
    render(<WalletPageWrapper />);

    // Connect first
    screen.getByRole('button', { name: 'Connect Freighter Wallet' }).click();
    await waitFor(() => {
      expect(screen.getByText('Device Provisioning')).toBeInTheDocument();
    });

    // Now disconnect
    const disconnectBtn = screen.getByRole('button', { name: 'Disconnect' });
    expect(disconnectBtn).toBeInTheDocument();
    disconnectBtn.click();

    await waitFor(() => {
      expect(screen.queryByText('Device Provisioning')).not.toBeInTheDocument();
    });
  });

  it('shows error state when wallet connection fails', async () => {
    // Mock freighter API to fail
    const { getAddress } = await import('@stellar/freighter-api');
    vi.mocked(getAddress).mockRejectedValueOnce(new Error('Freighter connection failed'));

    render(<WalletPageWrapper />);

    screen.getByRole('button', { name: 'Connect Freighter Wallet' }).click();

    await waitFor(() => {
      expect(screen.getByText('Freighter connection failed')).toBeInTheDocument();
    });

    // Retry button should appear in error state
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
