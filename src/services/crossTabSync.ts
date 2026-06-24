import type { DeviceStoreState } from '@/stores/deviceStore';

const CHANNEL_NAME = 'iot-billing-device-store';

export interface SyncMessage {
  type: 'state_sync';
  telemetry: Record<string, unknown>;
  filter: string;
  _version: number;
}

/**
 * Initialises a BroadcastChannel link between all tabs that share the same
 * origin.  Each tab subscribes to local store changes and broadcasts a full
 * state snapshot (with monotonic version) whenever `_version` increments.
 * Incoming snapshots are forwarded to `store.applyBroadcast()` which rejects
 * any version <= the local one, so stale or duplicate messages are silently
 * dropped.
 *
 * Returns a cleanup function that closes the channel and unsubscribes.
 */
export function initCrossTabSync(
  store: {
    getState: () => DeviceStoreState;
    subscribe: (listener: () => void) => () => void;
  },
): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  let lastBroadcastVersion = -1;

  const unsubStore = store.subscribe(() => {
    const state = store.getState();
    if (state._version === lastBroadcastVersion) return;
    lastBroadcastVersion = state._version;
    channel.postMessage({
      type: 'state_sync',
      telemetry: state.telemetry,
      filter: state.filter,
      _version: state._version,
    } satisfies SyncMessage);
  });

  const handleMessage = (event: MessageEvent<SyncMessage>) => {
    if (event.data?.type !== 'state_sync') return;
    store.getState().applyBroadcast({
      telemetry: event.data.telemetry as DeviceStoreState['telemetry'],
      filter: event.data.filter,
      _version: event.data._version,
    });
  };
  channel.addEventListener('message', handleMessage);

  return () => {
    unsubStore();
    channel.removeEventListener('message', handleMessage);
    channel.close();
  };
}
