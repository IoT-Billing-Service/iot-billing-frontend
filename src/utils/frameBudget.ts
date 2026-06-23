/**
 * frameBudget.ts
 *
 * Lightweight frame-budget monitor. Tracks draw call duration over a rolling
 * window and reports p95 latency + dropped-frame count so render loops can
 * shed work before jank accumulates.
 */

export interface FrameBudgetReport {
  p95: number;
  droppedFrames: number;
  sampleCount: number;
}

const BUDGET_MS = 16.67; // 60 fps target
const WINDOW = 120;      // rolling sample window

export class FrameBudgetMonitor {
  private samples: number[] = [];
  private dropped = 0;
  private frameStart = 0;

  beginFrame(now: number): void {
    this.frameStart = now;
  }

  endFrame(now: number): void {
    const elapsed = now - this.frameStart;
    this.samples.push(elapsed);
    if (this.samples.length > WINDOW) this.samples.shift();
    if (elapsed > BUDGET_MS) this.dropped++;
  }

  isUnderPressure(): boolean {
    if (this.samples.length < 10) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return p95 > BUDGET_MS * 1.5;
  }

  report(): FrameBudgetReport {
    if (this.samples.length === 0) return { p95: 0, droppedFrames: 0, sampleCount: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return { p95, droppedFrames: this.dropped, sampleCount: this.samples.length };
  }
}

/**
 * Returns the stride needed so at most `maxPoints` are drawn from `totalPoints`.
 * stride=1 means draw every point; stride=2 means draw every other, etc.
 */
export function decimationStride(totalPoints: number, maxPoints: number): number {
  return Math.max(1, Math.ceil(totalPoints / maxPoints));
}
