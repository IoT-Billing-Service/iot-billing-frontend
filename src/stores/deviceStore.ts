import { create } from 'zustand';
import type { BillingUpdate } from '@/hooks/useBillingStream';

export interface DeviceStoreState {
  telemetry: Record<string, BillingUpdate>;
  filter: string;
  _version: number;

  setTelemetry: (telemetry: Record<string, BillingUpdate>) => void;
  setFilter: (filter: string) => void;
  batchUpdate: (telemetry: Record<string, BillingUpdate>, filter: string) => void;
  applyBroadcast: (snapshot: Pick<DeviceStoreState, 'telemetry' | 'filter' | '_version'>) => void;
}

export const deviceStore = create<DeviceStoreState>((set, get) => ({
  telemetry: {},
  filter: '',
  _version: 0,

  setTelemetry(telemetry) {
    set({ telemetry, _version: get()._version + 1 });
  },

  setFilter(filter) {
    set({ filter, _version: get()._version + 1 });
  },

  batchUpdate(telemetry, filter) {
    set({ telemetry, filter, _version: get()._version + 1 });
  },

  applyBroadcast(snapshot) {
    if (snapshot._version <= get()._version) return;
    set({
      telemetry: snapshot.telemetry,
      filter: snapshot.filter,
      _version: snapshot._version,
    });
  },
}));
