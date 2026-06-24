import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCrossTabSync } from './crossTabSync';
import { deviceStore } from '@/stores/deviceStore';

/**
 * A fake BroadcastChannel that delivers messages synchronously to every
 * channel on the same *origin* (test-wide).  Supports both `onmessage` and
 * `addEventListener('message', handler)` so it works with the real crossTabSync
 * implementation.
 */
interface ChannelEntry {
  name: string;
  self: FakeBroadcastChannel;
}

const channels = new Set<ChannelEntry>();

class FakeBroadcastChannel {
  readonly name: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  #listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(name: string) {
    this.name = name;
    channels.add({ name, self: this });
  }

  postMessage(data: unknown) {
    for (const ch of channels) {
      if (ch.name !== this.name || ch.self === this) continue;
      ch.self.onmessage?.({ data } as MessageEvent);
      const msgListeners = ch.self.#listeners.get('message');
      if (msgListeners) {
        for (const handler of msgListeners) {
          handler({ data } as MessageEvent);
        }
      }
    }
  }

  close() {
    for (const ch of channels) {
      if (ch.self === this) {
        channels.delete(ch);
        break;
      }
    }
  }

  addEventListener(event: string, handler: (e: MessageEvent) => void) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: (e: MessageEvent) => void) {
    this.#listeners.get(event)?.delete(handler);
  }
}

beforeEach(() => {
  channels.clear();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  deviceStore.setState({ telemetry: {}, filter: '', _version: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initCrossTabSync', () => {
  it('broadcasts state changes to other tabs', () => {
    const cleanup = initCrossTabSync(deviceStore);
    const received: unknown[] = [];

    const other = new FakeBroadcastChannel('iot-billing-device-store');
    other.onmessage = (e) => { received.push(e.data); };

    deviceStore.getState().setFilter('hello');

    expect(received).toHaveLength(1);
    const msg = received[0] as Record<string, unknown>;
    expect(msg).toMatchObject({ type: 'state_sync', filter: 'hello', _version: 1 });

    cleanup();
  });

  it('applies broadcasts from other tabs via applyBroadcast', () => {
    const cleanupA = initCrossTabSync(deviceStore);

    // Simulate Tab B sending an update
    const tabB = new FakeBroadcastChannel('iot-billing-device-store');
    tabB.onmessage = null; // not listening
    tabB.postMessage({
      type: 'state_sync',
      telemetry: { d1: { deviceId: 'd1', amount: '500', timestamp: 100 } },
      filter: 'from-b',
      _version: 5,
    });

    expect(deviceStore.getState()._version).toBe(5);
    expect(deviceStore.getState().filter).toBe('from-b');
    expect(deviceStore.getState().telemetry).toEqual({
      d1: { deviceId: 'd1', amount: '500', timestamp: 100 },
    });

    cleanupA();
  });

  it('ignores broadcasts with stale versions', () => {
    const cleanupA = initCrossTabSync(deviceStore);

    // Set a baseline
    deviceStore.getState().setFilter('current');
    expect(deviceStore.getState()._version).toBe(1);

    // Tab B sends an older version
    const tabB = new FakeBroadcastChannel('iot-billing-device-store');
    tabB.postMessage({
      type: 'state_sync',
      telemetry: {},
      filter: 'stale',
      _version: 0,
    });

    // Local state is unchanged
    expect(deviceStore.getState().filter).toBe('current');
    expect(deviceStore.getState()._version).toBe(1);

    cleanupA();
  });

  it('does not echo own broadcasts back to self', () => {
    let localApplyCalls = 0;
    const origApply = deviceStore.getState().applyBroadcast;
    deviceStore.setState({ applyBroadcast: (...args: Parameters<typeof origApply>) => {
      localApplyCalls++;
      origApply(...args);
    }});

    const cleanup = initCrossTabSync(deviceStore);

    // Trigger a local state change
    deviceStore.getState().setFilter('test');

    // applyBroadcast should not have been called for own broadcast
    expect(localApplyCalls).toBe(0);

    cleanup();
  });

  it('cleanup unsubscribes and closes the channel', () => {
    const cleanup = initCrossTabSync(deviceStore);
    cleanup();

    const received: unknown[] = [];
    const other = new FakeBroadcastChannel('iot-billing-device-store');
    other.onmessage = (e) => { received.push(e.data); };

    deviceStore.getState().setFilter('after-cleanup');

    expect(received).toHaveLength(0);
  });
});
