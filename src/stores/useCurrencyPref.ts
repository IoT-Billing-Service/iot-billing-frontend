import { create } from 'zustand';

export type CurrencyCode = 'USD' | 'EUR' | 'NGN';

export interface CurrencyPrefState {
  currency: CurrencyCode;
  currencyVersion: number;
  /** True while user is interacting with the currency selector (mouseDown → mouseUp/blur) */
  isUserInteracting: boolean;
  /** Billing telemetry updates queued during interaction */
  pendingQueue: Array<{ deviceId: string; amount: string }>;

  setCurrency: (currency: CurrencyCode) => void;
  setUserInteracting: (interacting: boolean) => void;
  queueTelemetryUpdate: (update: { deviceId: string; amount: string }) => void;
  flushPendingQueue: () => void;
}

export const useCurrencyPref = create<CurrencyPrefState>((set, get) => ({
  currency: 'USD',
  currencyVersion: 0,
  isUserInteracting: false,
  pendingQueue: [],

  setCurrency(newCurrency) {
    set((s) => ({
      currency: newCurrency,
      currencyVersion: s.currencyVersion + 1,
    }));
  },

  setUserInteracting(interacting) {
    set({ isUserInteracting: interacting });
    if (!interacting) {
      // Flush queued updates atomically when interaction ends
      const { pendingQueue } = get();
      if (pendingQueue.length > 0) {
        // Queue is consumed by the billing stream hook via flushPendingQueue
        get().flushPendingQueue();
      }
    }
  },

  queueTelemetryUpdate(update) {
    set((s) => ({ pendingQueue: [...s.pendingQueue, update] }));
  },

  flushPendingQueue() {
    set({ pendingQueue: [] });
  },
}));
