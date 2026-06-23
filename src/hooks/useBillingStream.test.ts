import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBillingStream, type BillingUpdate } from './useBillingStream';
import { useCurrencyPref } from '@/stores/useCurrencyPref';

/** Minimal WebSocket stand-in that records instances and lets tests push messages. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  useCurrencyPref.setState({ isUserInteracting: false, pendingQueue: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBillingStream', () => {
  it('opens the socket once and does not reconnect when interaction toggles', () => {
    renderHook(() => useBillingStream(() => {}));
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => useCurrencyPref.getState().setUserInteracting(true));
    act(() => useCurrencyPref.getState().setUserInteracting(false));

    // A single socket survives interaction toggles — no churn, no reconnect gap.
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.closed).toBe(false);
  });

  it('delivers updates immediately when not interacting', () => {
    const handler = vi.fn();
    renderHook(() => useBillingStream(handler));
    const ws = MockWebSocket.instances[0]!;

    act(() => ws.receive({ deviceId: 'd1', amount: '100', timestamp: 1 }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual([{ deviceId: 'd1', amount: '100', timestamp: 1 }]);
  });

  it('queues updates during interaction and delivers them when it ends (no data loss)', () => {
    const handler = vi.fn();
    renderHook(() => useBillingStream(handler));
    const ws = MockWebSocket.instances[0]!;

    act(() => useCurrencyPref.getState().setUserInteracting(true));
    act(() => ws.receive({ deviceId: 'd1', amount: '100', timestamp: 1 }));
    act(() => ws.receive({ deviceId: 'd2', amount: '200', timestamp: 2 }));

    // Queued, not delivered yet.
    expect(handler).not.toHaveBeenCalled();
    expect(useCurrencyPref.getState().pendingQueue).toHaveLength(2);

    act(() => useCurrencyPref.getState().setUserInteracting(false));

    // Delivered exactly once with both queued updates, then the queue clears.
    expect(handler).toHaveBeenCalledTimes(1);
    const delivered = handler.mock.calls[0]![0] as BillingUpdate[];
    expect(delivered.map((u) => u.deviceId)).toEqual(['d1', 'd2']);
    expect(useCurrencyPref.getState().pendingQueue).toHaveLength(0);
  });

  it('closes the socket on unmount', () => {
    const { unmount } = renderHook(() => useBillingStream(() => {}));
    const ws = MockWebSocket.instances[0]!;
    unmount();
    expect(ws.closed).toBe(true);
  });
});
