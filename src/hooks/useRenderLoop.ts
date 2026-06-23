'use client';

import { useEffect, useRef } from 'react';

interface UseRenderLoopOptions {
  draw: (now: number) => void;
  prefersReducedMotion?: boolean;
  isVisible?: () => boolean;
  onResumeAfterHidden?: () => void;
  /** Threshold in ms after which a resume triggers onResumeAfterHidden. Default 5000. */
  hiddenThresholdMs?: number;
}

/**
 * Drives a draw callback via requestAnimationFrame (or a 250 ms interval when
 * prefersReducedMotion is true). Skips frames while the page is hidden and
 * calls onResumeAfterHidden when the tab becomes visible again after being
 * hidden for longer than hiddenThresholdMs.
 */
export function useRenderLoop({
  draw,
  prefersReducedMotion = false,
  isVisible,
  onResumeAfterHidden,
  hiddenThresholdMs = 5000,
}: UseRenderLoopOptions): void {
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  const onResumeRef = useRef(onResumeAfterHidden);
  onResumeRef.current = onResumeAfterHidden;

  useEffect(() => {
    let running = true;
    let lastFrameTime = 0;

    const tick = (now: number) => {
      if (!running) return;

      const visible = isVisibleRef.current?.() ?? true;
      if (!visible) {
        if (prefersReducedMotion) return;
        requestAnimationFrame(tick);
        return;
      }

      if (lastFrameTime > 0 && now - lastFrameTime > hiddenThresholdMs) {
        onResumeRef.current?.();
      }
      lastFrameTime = now;
      drawRef.current(now);

      if (!prefersReducedMotion) requestAnimationFrame(tick);
    };

    if (prefersReducedMotion) {
      const id = setInterval(() => {
        if (!running) return;
        if (!(isVisibleRef.current?.() ?? true)) return;
        const now = performance.now();
        if (lastFrameTime > 0 && now - lastFrameTime > hiddenThresholdMs) {
          onResumeRef.current?.();
        }
        lastFrameTime = now;
        drawRef.current(now);
      }, 250);
      return () => { running = false; clearInterval(id); };
    }

    requestAnimationFrame(tick);
    return () => { running = false; };
  }, [prefersReducedMotion, hiddenThresholdMs]);
}
