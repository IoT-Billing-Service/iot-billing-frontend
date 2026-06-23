import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface TelemetryDataPoint {
  timestamp: number;
  value: number;
}

interface TelemetryState {
  tooltipDataIndex: number | null;
  isTooltipFrozen: boolean;
  frozenTooltipData: {
    value: number;
    timestamp: number;
    index: number;
  } | null;

  // Actions
  setTooltipDataIndex: (index: number | null) => void;
  setTooltipFrozen: (frozen: boolean) => void;
  freezeTooltip: (data: { value: number; timestamp: number; index: number } | null) => void;
}

export const useTelemetryStore = create<TelemetryState>()(
  subscribeWithSelector((set) => ({
    tooltipDataIndex: null,
    isTooltipFrozen: false,
    frozenTooltipData: null,

    setTooltipDataIndex: (index) => {
      set((state) => {
        if (state.isTooltipFrozen) return state;
        return { tooltipDataIndex: index };
      });
    },

    setTooltipFrozen: (frozen) => set({ isTooltipFrozen: frozen }),

    freezeTooltip: (data) => {
      set({
        isTooltipFrozen: true,
        frozenTooltipData: data
      });

      // Auto-unfreeze after 50ms
      setTimeout(() => {
        set({ isTooltipFrozen: false, frozenTooltipData: null });
      }, 50);
    },
  }))
);
