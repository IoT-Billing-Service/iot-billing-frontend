import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

// In-memory store for device commissions (replace with blockchain-backed store in production)
interface CommissionEntry {
  sessionNonce: string;
  publicKey: string;
  deviceId: string;
  status: 'pending' | 'commissioned' | 'failed';
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const commissionStore = new Map<string, CommissionEntry>();

// Cleanup old commission entries every 30 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of commissionStore.entries()) {
      // Remove entries older than 1 hour
      if (now - value.createdAt > 60 * 60 * 1000) {
        commissionStore.delete(key);
      }
    }
  },
  30 * 60 * 1000,
);

/**
 * POST /api/devices/commission
 *
 * Simulates a device commissioning request. In production, this would be called
 * by the IoT device after scanning the QR code, posting the session nonce
 * and signed challenge to prove it read the commissioning data.
 *
 * Body: { sessionNonce: string, publicKey: string, signature: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionNonce, publicKey } = body;

    if (!sessionNonce || !publicKey) {
      return NextResponse.json(
        { error: 'sessionNonce and publicKey are required' },
        { status: 400 },
      );
    }

    // Validate Stellar public key format
    if (!publicKey.match(/^G[A-Z0-9]{55}$/)) {
      return NextResponse.json({ error: 'Invalid Stellar public key format' }, { status: 400 });
    }

    // Check if a commission already exists for this nonce
    const existing = commissionStore.get(sessionNonce);
    if (existing) {
      return NextResponse.json(
        {
          sessionNonce: existing.sessionNonce,
          deviceId: existing.deviceId,
          status: existing.status,
          error: existing.error,
          updatedAt: existing.updatedAt,
        },
        { status: 200 },
      );
    }

    // Generate a mock device ID (in production, this would come from the blockchain)
    const deviceId = `DEV-${randomBytes(4).toString('hex').toUpperCase()}`;

    // Create a commission entry that starts as "pending" and transitions to "commissioned"
    // after a short delay, simulating real-world processing
    const entry: CommissionEntry = {
      sessionNonce,
      publicKey,
      deviceId,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    commissionStore.set(sessionNonce, entry);

    // Simulate async commissioning: transition from pending -> commissioned after ~3 seconds
    setTimeout(() => {
      const current = commissionStore.get(sessionNonce);
      if (current && current.status === 'pending') {
        // Simulate 90% success rate
        if (Math.random() > 0.1) {
          current.status = 'commissioned';
        } else {
          current.status = 'failed';
          current.error = 'Device handshake timeout: unable to verify cryptographic challenge';
        }
        current.updatedAt = Date.now();
        commissionStore.set(sessionNonce, current);
      }
    }, 3000);

    return NextResponse.json(
      {
        sessionNonce,
        deviceId,
        status: 'pending',
        createdAt: entry.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error processing device commission:', error);
    return NextResponse.json(
      { error: 'Failed to process device commission' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/devices/commission?sessionNonce=<nonce>
 *
 * Poll this endpoint to check the commission status.
 * Returns current status: pending | commissioned | failed
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionNonce = searchParams.get('sessionNonce');

    if (!sessionNonce) {
      return NextResponse.json({ error: 'sessionNonce is required' }, { status: 400 });
    }

    const entry = commissionStore.get(sessionNonce);

    if (!entry) {
      return NextResponse.json(
        { sessionNonce, status: 'awaiting_scan', message: 'Device has not scanned the QR code yet' },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        sessionNonce: entry.sessionNonce,
        deviceId: entry.deviceId,
        status: entry.status,
        error: entry.error,
        updatedAt: entry.updatedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('Error fetching commission status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch commission status' },
      { status: 500 },
    );
  }
}
