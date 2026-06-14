import { cacheGet, cacheClear } from './indexedDbCache';
import type { Web3AuthSession } from '@/types';

const CHECK_INTERVAL = 30_000;
const EXPIRY_BUFFER = 60_000;

let monitorInterval: ReturnType<typeof setInterval> | null = null;

async function checkWalletPresence(): Promise<boolean> {
  try {
    const { isConnected } = await import('@stellar/freighter-api');
    const result = await isConnected();
    return !result.error && result.isConnected;
  } catch {
    return false;
  }
}

async function terminateSession(publicKey: string): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    });
  } catch {
    // best-effort server logout
  }
  await cacheClear('authSession');
}

export function startSessionMonitor(publicKey: string, onExpired?: () => void): () => void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  monitorInterval = setInterval(async () => {
    try {
      const session = await cacheGet<Web3AuthSession>('authSession', publicKey);
      if (!session) {
        onExpired?.();
        return;
      }

      if (Date.now() > session.expiresAt - EXPIRY_BUFFER) {
        await terminateSession(publicKey);
        onExpired?.();
        return;
      }

      const walletActive = await checkWalletPresence();
      if (!walletActive) {
        await terminateSession(publicKey);
        onExpired?.();
      }
    } catch {
      // monitor check failed silently
    }
  }, CHECK_INTERVAL);

  return () => {
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
  };
}

export function stopSessionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
