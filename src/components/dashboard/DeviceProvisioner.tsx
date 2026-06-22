'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useQuery } from '@tanstack/react-query';
import { decodeError } from '@/utils/errorDecoder';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProvisioningSecretResponse {
  secret: string;
  expiresAt: number;
}

interface CommissionStatusResponse {
  sessionNonce: string;
  deviceId?: string;
  status: 'awaiting_scan' | 'pending' | 'commissioned' | 'failed';
  error?: string;
  updatedAt?: number;
}

interface QrPayload {
  version: 1;
  wallet: string;
  session: string;
  timestamp: number;
  hmac: string;
}

interface DeviceProvisionerProps {
  walletAddress: string;
  onComplete?: (deviceId: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const QR_REFRESH_INTERVAL_MS = 60_000; // 60 seconds
const COMMISSION_POLL_INTERVAL_MS = 2_000; // 2 seconds
const SESSION_NONCE_BYTES = 16; // 32 hex chars (16 bytes)
const PROVISIONING_RETRY_DELAY_MS = 3_000; // 3 seconds
const MAX_PROVISIONING_RETRIES = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSessionNonce(): string {
  const bytes = new Uint8Array(SESSION_NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeHmac(
  payloadString: string,
  walletPublicKey: string,
  serverSecret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(serverSecret + walletPublicKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payloadString));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchProvisioningSecret(
  publicKey: string,
  retries = MAX_PROVISIONING_RETRIES,
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(`/api/auth/provisioning-secret?publicKey=${publicKey}`);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const data: ProvisioningSecretResponse = await response.json();
      return data.secret;
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, PROVISIONING_RETRY_DELAY_MS));
      } else {
        throw new Error(
          `Failed to fetch provisioning secret after ${retries} attempts: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }
  }
  throw new Error('Failed to fetch provisioning secret');
}

async function buildQrPayload(
  walletAddress: string,
  sessionNonce: string,
  timestamp: number,
  secret: string,
): Promise<QrPayload> {
  const payloadWithoutHmac: Omit<QrPayload, 'hmac'> = {
    version: 1,
    wallet: walletAddress,
    session: sessionNonce,
    timestamp,
  };
  const payloadString = JSON.stringify(payloadWithoutHmac);
  const hmac = await computeHmac(payloadString, walletAddress, secret);
  return { ...payloadWithoutHmac, hmac };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DeviceProvisioner({ walletAddress, onComplete }: DeviceProvisionerProps) {
  const [step, setStep] = useState<'generate' | 'scan'>('generate');
  const [sessionNonce, setSessionNonce] = useState(() => generateSessionNonce());
  const [qrPayload, setQrPayload] = useState('');
  const [provisioningSecret, setProvisioningSecret] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [isFetchingSecret, setIsFetchingSecret] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onCompleteCalledRef = useRef(false);

  // --- Fetch provisioning secret ---
  const fetchSecret = useCallback(async () => {
    if (isFetchingSecret) return;
    setIsFetchingSecret(true);
    setSecretError(null);

    try {
      const secret = await fetchProvisioningSecret(walletAddress);
      setProvisioningSecret(secret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to obtain provisioning secret';
      setSecretError(message);
      setProvisioningSecret(null);
    } finally {
      setIsFetchingSecret(false);
    }
  }, [walletAddress, isFetchingSecret]);

  // --- Generate QR payload ---
  const generateQrPayload = useCallback(async () => {
    if (!provisioningSecret) return;

    try {
      const nonce = generateSessionNonce();
      const ts = Date.now();
      const payload = await buildQrPayload(walletAddress, nonce, ts, provisioningSecret);
      setSessionNonce(nonce);
      setQrPayload(JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to generate QR payload:', err);
    }
  }, [walletAddress, provisioningSecret]);

  // --- Initialize on mount ---
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      await fetchSecret();
      if (mounted) await generateQrPayload();
    };
    init();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 60-second QR auto-refresh ---
  useEffect(() => {
    if (!provisioningSecret) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => generateQrPayload(), QR_REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [provisioningSecret, generateQrPayload]);

  // --- Handle commission start ---
  const handleGenerate = useCallback(async () => {
    setStep('scan');
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    onCompleteCalledRef.current = false;
    await generateQrPayload();
  }, [generateQrPayload]);

  // --- Poll commission status ---
  const {
    data: commissionData,
    isFetching: isPolling,
    error: pollingError,
  } = useQuery<CommissionStatusResponse>({
    queryKey: ['deviceCommission', sessionNonce],
    queryFn: async () => {
      const response = await fetch(`/api/devices/commission?sessionNonce=${sessionNonce}`, {
        signal: abortControllerRef.current?.signal,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error ?? `Server returned ${response.status}`);
      }
      return response.json();
    },
    enabled: step === 'scan',
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'commissioned' || status === 'failed') return false;
      return COMMISSION_POLL_INTERVAL_MS;
    },
    staleTime: 500,
    retry: 1,
  });

  // --- Fire onComplete callback when commission succeeds ---
  useEffect(() => {
    if (
      commissionData?.status === 'commissioned' &&
      commissionData.deviceId &&
      !onCompleteCalledRef.current
    ) {
      onCompleteCalledRef.current = true;
      onComplete?.(commissionData.deviceId);
    }
  }, [commissionData, onComplete]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // --- Retry handlers ---
  const handleRetrySecret = useCallback(() => {
    setSecretError(null);
    fetchSecret();
  }, [fetchSecret]);

  const handleRetryCommission = useCallback(() => {
    setStep('generate');
    generateQrPayload();
  }, [generateQrPayload]);

  const handleCancel = useCallback(() => {
    setStep('generate');
  }, []);

  // ─── Derived state (avoids setState-in-effects lint errors) ─────────

  // Commission completion data
  const derivedDeviceId =
    commissionData?.status === 'commissioned' ? (commissionData.deviceId ?? null) : null;

  // Commission failure error message
  const commissionFailureError =
    commissionData?.status === 'failed' && commissionData.error
      ? decodeError(commissionData.error)
      : null;

  // Polling error message
  const pollingErrorMessage =
    pollingError instanceof Error ? decodeError(pollingError.message) : null;

  // Display error (failure + polling)
  const displayError = commissionFailureError ?? pollingErrorMessage;

  // UI state derived from step + commission data.
  // Commission status is only consulted when actively scanning (step === 'scan')
  // to prevent stale failure data from a previous attempt showing the error
  // state after the user clicks "Retry Commission".
  const uiState = (() => {
    if (step !== 'scan') return 'generate';
    const status = commissionData?.status;
    if (status === 'commissioned') return 'complete';
    if (status === 'failed') return 'error';
    if (status === 'pending') return 'verify';
    return 'scan';
  })();

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-6">
      <h3 className="mb-4 text-lg font-semibold text-green-400">Device Provisioning</h3>

      {/* Secret fetch error */}
      {secretError && (
        <div className="mb-4 rounded border border-red-700 bg-red-900/20 p-3">
          <p className="text-sm text-red-400">{secretError}</p>
          <button
            onClick={handleRetrySecret}
            disabled={isFetchingSecret}
            className="mt-2 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-50"
          >
            {isFetchingSecret ? 'Retrieving...' : 'Retry'}
          </button>
        </div>
      )}

      {/* UI: Generate */}
      {uiState === 'generate' && !secretError && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Generate a secure QR code to pair your hardware device with this wallet.
            {provisioningSecret && (
              <span className="ml-1 text-green-500">
                The QR code will auto-refresh every 60 seconds for security.
              </span>
            )}
          </p>

          {displayError && (
            <div className="rounded border border-red-700 bg-red-900/20 p-3">
              <p className="text-sm text-red-400">{displayError}</p>
              <button
                onClick={handleRetryCommission}
                className="mt-2 rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500"
              >
                Try Again
              </button>
            </div>
          )}

          {!qrPayload && !secretError && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-green-400 border-t-transparent" />
              Generating secure provisioning payload...
            </div>
          )}

          {qrPayload && !displayError && (
            <button
              onClick={handleGenerate}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors"
            >
              Generate Commissioning QR
            </button>
          )}
        </div>
      )}

      {/* UI: Scan (QR code visible, awaiting device scan) */}
      {uiState === 'scan' && qrPayload && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Scan this QR code with your device imaging tool. The code contains a
            cryptographically signed commissioning payload and will auto-refresh
            to prevent replay attacks.
          </p>
          <div className="flex justify-center">
            <div className="rounded border border-gray-600 bg-white p-4 shadow-lg">
              <QRCodeSVG
                value={qrPayload}
                level="H"
                includeMargin
                size={256}
                fgColor="#000000"
                bgColor="#FFFFFF"
              />
            </div>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">
              Session:{' '}
              <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-green-300">
                {sessionNonce.slice(0, 12)}...
              </code>
            </p>
            <p className="mt-1 text-xs text-gray-500">Auto-refreshes every 60 seconds</p>
          </div>
          <div className="flex justify-center gap-2">
            <button
              onClick={handleGenerate}
              className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Regenerate QR
            </button>
            <button
              onClick={handleCancel}
              className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* UI: Verify */}
      {uiState === 'verify' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
            <span className="text-yellow-400">Verifying device handshake...</span>
          </div>
          <p className="text-xs text-gray-500">
            Waiting for the device to complete the cryptographic handshake.
          </p>
          {isPolling && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-green-500" />
            </div>
          )}
        </div>
      )}

      {/* UI: Error */}
      {uiState === 'error' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white">
              ✗
            </span>
            <span className="font-medium text-red-400">Commission failed</span>
          </div>
          {commissionData?.error && (
            <p className="text-sm text-red-300">{decodeError(commissionData.error)}</p>
          )}
          <button
            onClick={handleRetryCommission}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
          >
            Retry Commission
          </button>
        </div>
      )}

      {/* UI: Complete */}
      {uiState === 'complete' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-xs text-white">
              ✓
            </span>
            <span className="font-medium text-green-400">Device provisioned successfully</span>
          </div>
          {derivedDeviceId && (
            <div className="rounded border border-green-700 bg-green-900/20 p-3">
              <p className="text-xs text-gray-400">Device ID</p>
              <p className="font-mono text-sm text-green-300">{derivedDeviceId}</p>
            </div>
          )}
          <button
            onClick={() => {
              setStep('generate');
              onCompleteCalledRef.current = false;
              generateQrPayload();
            }}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 transition-colors"
          >
            Provision Another Device
          </button>
        </div>
      )}
    </div>
  );
}
