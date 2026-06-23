import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { useTelemetryStore } from '../src/stores/useTelemetryStore';

describe('TelemetryChart Synchronization Invariants', () => {
  beforeEach(() => {
    act(() => {
      useTelemetryStore.getState().setTooltipDataIndex(null);
      useTelemetryStore.getState().setTooltipFrozen(false);
    });
    vi.useFakeTimers();
  });

  it('maintains freeze state during data updates', () => {
    const currentDataPoint = { value: 20, timestamp: 2000, index: 1 };

    act(() => {
      useTelemetryStore.getState().freezeTooltip(currentDataPoint);
    });

    expect(useTelemetryStore.getState().isTooltipFrozen).toBe(true);
    expect(useTelemetryStore.getState().frozenTooltipData?.value).toBe(20);

    // Should auto-unfreeze
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(useTelemetryStore.getState().isTooltipFrozen).toBe(false);
    expect(useTelemetryStore.getState().frozenTooltipData).toBe(null);
  });

  it('prevents index updates while frozen', () => {
    act(() => {
      useTelemetryStore.getState().freezeTooltip({ value: 10, timestamp: 1000, index: 0 });
    });

    expect(useTelemetryStore.getState().isTooltipFrozen).toBe(true);

    // Attempt to move mouse while frozen
    act(() => {
      useTelemetryStore.getState().setTooltipDataIndex(5);
    });

    // Index should NOT change while frozen
    expect(useTelemetryStore.getState().tooltipDataIndex).toBe(null);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(useTelemetryStore.getState().isTooltipFrozen).toBe(false);

    // Now it should work
    act(() => {
      useTelemetryStore.getState().setTooltipDataIndex(5);
    });
    expect(useTelemetryStore.getState().tooltipDataIndex).toBe(5);
  });
});
