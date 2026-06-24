import { describe, it, expect, beforeEach } from 'vitest';
import { deviceStore } from './deviceStore';
import type { DeviceStoreState } from './deviceStore';

function snapshot(): DeviceStoreState {
  return deviceStore.getState();
}

beforeEach(() => {
  deviceStore.setState({ telemetry: {}, filter: '', _version: 0 });
});

describe('deviceStore', () => {
  describe('setTelemetry', () => {
    it('stores telemetry and increments version', () => {
      const data = { d1: { deviceId: 'd1', amount: '100', timestamp: 1 } };
      snapshot().setTelemetry(data);
      expect(snapshot().telemetry).toEqual(data);
      expect(snapshot()._version).toBe(1);
    });

    it('increments version on each call', () => {
      snapshot().setTelemetry({ d1: { deviceId: 'd1', amount: '100', timestamp: 1 } });
      snapshot().setTelemetry({ d2: { deviceId: 'd2', amount: '200', timestamp: 2 } });
      expect(snapshot()._version).toBe(2);
    });
  });

  describe('setFilter', () => {
    it('stores filter and increments version', () => {
      snapshot().setFilter('device-1');
      expect(snapshot().filter).toBe('device-1');
      expect(snapshot()._version).toBe(1);
    });
  });

  describe('batchUpdate', () => {
    it('sets both telemetry and filter with a single version increment', () => {
      snapshot().setTelemetry({ d1: { deviceId: 'd1', amount: '100', timestamp: 1 } });
      const v1 = snapshot()._version;

      const telemetry = { d2: { deviceId: 'd2', amount: '200', timestamp: 2 } };
      snapshot().batchUpdate(telemetry, 'filter-value');

      expect(snapshot().telemetry).toEqual(telemetry);
      expect(snapshot().filter).toBe('filter-value');
      expect(snapshot()._version).toBe(v1 + 1);
    });

    it('increments version once even when both fields change', () => {
      const v0 = snapshot()._version;
      snapshot().batchUpdate(
        { d1: { deviceId: 'd1', amount: '100', timestamp: 1 } },
        'filter',
      );
      expect(snapshot()._version).toBe(v0 + 1);
    });
  });

  describe('applyBroadcast', () => {
    it('applies a snapshot with a newer version', () => {
      snapshot().setTelemetry({ d1: { deviceId: 'd1', amount: '100', timestamp: 1 } });
      const v1 = snapshot()._version;

      snapshot().applyBroadcast({
        telemetry: { d2: { deviceId: 'd2', amount: '200', timestamp: 2 } },
        filter: 'new-filter',
        _version: v1 + 1,
      });

      expect(snapshot().telemetry).toEqual({ d2: { deviceId: 'd2', amount: '200', timestamp: 2 } });
      expect(snapshot().filter).toBe('new-filter');
      expect(snapshot()._version).toBe(v1 + 1);
    });

    it('rejects a snapshot with an equal version', () => {
      snapshot().setTelemetry({ d1: { deviceId: 'd1', amount: '100', timestamp: 1 } });
      const v1 = snapshot()._version;

      snapshot().applyBroadcast({
        telemetry: { d2: { deviceId: 'd2', amount: '200', timestamp: 2 } },
        filter: 'new-filter',
        _version: v1,
      });

      expect(snapshot().telemetry).toEqual({ d1: { deviceId: 'd1', amount: '100', timestamp: 1 } });
      expect(snapshot().filter).toBe('');
    });

    it('rejects a snapshot with an older version', () => {
      snapshot().setTelemetry({ d1: { deviceId: 'd1', amount: '100', timestamp: 1 } });
      snapshot().setFilter('keep');
      const v2 = snapshot()._version;

      snapshot().applyBroadcast({
        telemetry: { d2: { deviceId: 'd2', amount: '200', timestamp: 2 } },
        filter: 'old',
        _version: v2 - 1,
      });

      expect(snapshot().filter).toBe('keep');
      expect(snapshot()._version).toBe(v2);
    });
  });

  describe('cross-tab atomicity', () => {
    it('applyBroadcast sets both fields from the same snapshot', () => {
      snapshot().batchUpdate(
        { d1: { deviceId: 'd1', amount: '100', timestamp: 1 } },
        'original',
      );

      snapshot().applyBroadcast({
        telemetry: { d2: { deviceId: 'd2', amount: '200', timestamp: 2 } },
        filter: 'synced-filter',
        _version: snapshot()._version + 1,
      });

      expect(snapshot().telemetry).toEqual({ d2: { deviceId: 'd2', amount: '200', timestamp: 2 } });
      expect(snapshot().filter).toBe('synced-filter');
    });
  });
});
