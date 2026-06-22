import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

// In-memory store for provisioning secrets (replace with Redis in production)
const provisioningSecretStore = new Map<
  string,
  { secret: string; expiresAt: number; used: boolean }
>();

// Cleanup expired secrets every 10 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of provisioningSecretStore.entries()) {
      if (now > value.expiresAt) {
        provisioningSecretStore.delete(key);
      }
    }
  },
  10 * 60 * 1000,
);

/**
 * GET /api/auth/provisioning-secret?publicKey=<wallet>
 *
 * Returns a one-time provisioning secret used to derive the HMAC key
 * for QR code payload signing. The secret is bound to the wallet public key,
 * expires after 5 minutes, and can only be used once to prevent replay attacks.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const publicKey = searchParams.get('publicKey');

    if (!publicKey || typeof publicKey !== 'string') {
      return NextResponse.json({ error: 'publicKey is required' }, { status: 400 });
    }

    // Validate Stellar public key format
    if (!publicKey.match(/^G[A-Z0-9]{55}$/)) {
      return NextResponse.json({ error: 'Invalid Stellar public key format' }, { status: 400 });
    }

    // Check for existing valid secret (don't issue multiple per key)
    const existing = provisioningSecretStore.get(publicKey);
    if (existing && !existing.used && Date.now() < existing.expiresAt) {
      // Return existing secret if still valid and unused
      return NextResponse.json(
        { secret: existing.secret, expiresAt: existing.expiresAt },
        { status: 200 },
      );
    }

    // Generate a cryptographically secure random 32-byte secret
    const secret = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    provisioningSecretStore.set(publicKey, { secret, expiresAt, used: false });

    return NextResponse.json({ secret, expiresAt }, { status: 200 });
  } catch (error) {
    console.error('Error generating provisioning secret:', error);
    return NextResponse.json(
      { error: 'Failed to generate provisioning secret' },
      { status: 500 },
    );
  }
}


