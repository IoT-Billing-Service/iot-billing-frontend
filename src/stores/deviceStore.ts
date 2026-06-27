import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeviceTelemetry } from '@/types';

interface DeviceState {
  devices: DeviceTelemetry[];
  hydrationReady: boolean;
  setDevices: (devices: DeviceTelemetry[]) => void;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set) => ({
      devices: [],
      hydrationReady: false,
      setDevices: (devices) => set({ devices }),
    }),
    {
      name: 'device-store',
      onRehydrateStorage: () => () => {
        useDeviceStore.setState({ hydrationReady: true });
      },
    },
  ),
);
