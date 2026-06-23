'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { FrameBudgetMonitor, decimationStride, type FrameBudgetReport } from '@/utils/frameBudget';
import { useRenderLoop } from '@/hooks/useRenderLoop';

interface MetricsFrame {
  timestamp: number;
  values: Record<string, number>;
}

interface LiveMetricsCanvasProps {
  stream: MetricsFrame[];
  metrics: string[];
  height?: number;
}

// Max float64 pairs per postMessage chunk: 4096 points × 2 floats × 8 bytes = 64 KB (within limit)
const CHUNK_SIZE = 4096;
const RING_CAPACITY = 100_000;

/** Split a flat Float64Array into chunks of CHUNK_SIZE points (2 floats each). */
function* chunkBuffer(buf: Float64Array): Generator<Float64Array> {
  const floatsPerChunk = CHUNK_SIZE * 2;
  for (let offset = 0; offset < buf.length; offset += floatsPerChunk) {
    yield buf.subarray(offset, offset + floatsPerChunk);
  }
}

export function LiveMetricsCanvas({ stream, metrics, height = 300 }: LiveMetricsCanvasProps) {
  const { chartPalette } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const offscreenTransferredRef = useRef(false);
  // fallback: render on main thread when OffscreenCanvas is unsupported
  const fallbackRef = useRef(false);

  // Main-thread ring buffer (fallback path)
  const ringRef = useRef<MetricsFrame[]>(new Array(RING_CAPACITY));
  const headRef = useRef(0);
  const countRef = useRef(0);
  const rafRef = useRef(0);

  // ─── Worker setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      fallbackRef.current = true;
      return;
    }

    const worker = new Worker(
      new URL('../../workers/canvasWorker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        workerReadyRef.current = true;
      }
    };
    worker.onerror = () => {
      fallbackRef.current = true;
      workerReadyRef.current = false;
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
      offscreenTransferredRef.current = false;
    };
  }, []);

  // ─── Transfer OffscreenCanvas once on mount (after canvas element exists) ───
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || offscreenTransferredRef.current || fallbackRef.current) return;

    const worker = workerRef.current;
    if (!worker) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.getBoundingClientRect().width || 300;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;

    try {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
      offscreenTransferredRef.current = true;
    } catch {
      // transferControlToOffscreen not supported → fall back
      fallbackRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // ─── Handle resize ────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const dpr = window.devicePixelRatio || 1;

      if (offscreenTransferredRef.current && workerRef.current) {
        workerRef.current.postMessage({
          type: 'resize',
          width: w * dpr,
          height: height * dpr,
        });
      } else if (fallbackRef.current && canvasRef.current) {
        canvasRef.current.width = w * dpr;
        canvasRef.current.height = height * dpr;
        canvasRef.current.style.width = `${w}px`;
        canvasRef.current.style.height = `${height}px`;
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [height]);

  // ─── Send new stream data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!stream.length) return;

    const worker = workerRef.current;

    if (!fallbackRef.current && worker && offscreenTransferredRef.current) {
      // Build a flat Float64Array: [timestamp0, value0, timestamp1, value1, ...]
      // We encode only the first metric's value as the Y axis; X = timestamp.
      const metric = metrics[0] ?? '';
      const flat = new Float64Array(stream.length * 2);
      for (let i = 0; i < stream.length; i++) {
        flat[i * 2] = stream[i]!.timestamp;
        flat[i * 2 + 1] = stream[i]!.values[metric] ?? 0;
      }

      // Split into ≤ CHUNK_SIZE-point chunks and transfer each
      const chunks = [...chunkBuffer(flat)];
      const totalChunks = chunks.length;

      for (let idx = 0; idx < totalChunks; idx++) {
        const chunk = chunks[idx]!;
        // Copy the subarray to a standalone buffer for transfer
        const transferBuf = chunk.slice().buffer;
        try {
          worker.postMessage(
            {
              type: 'chunk',
              data: new Float64Array(transferBuf),
              chunkIndex: idx,
              totalChunks,
            },
            [transferBuf],
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === 'DataCloneError') {
            // Buffer exceeded transferable limit → fall back to main thread
            fallbackRef.current = true;
            break;
          }
          throw err;
        }
      }
      return;
    }

    // ── Fallback: main-thread ring buffer update ──────────────────────────────
    const ring = ringRef.current;
    for (let i = 0; i < stream.length; i++) {
      const writeAt = (headRef.current + countRef.current) % RING_CAPACITY;
      ring[writeAt] = stream[i]!;
      if (countRef.current < RING_CAPACITY) {
        countRef.current++;
      } else {
        headRef.current = (headRef.current + 1) % RING_CAPACITY;
      }
    }
  }, [stream, metrics]);

  // ─── Fallback rAF draw loop ───────────────────────────────────────────────────
  const drawFallback = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fallbackRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ring = ringRef.current;
    const head = headRef.current;
    const count = countRef.current;
    if (count < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const colors = chartPalette.length ? chartPalette : ['#5ec962', '#fca50a', '#21918c'];
    const pad = 10;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    metrics.forEach((metric, mi) => {
      let yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i < count; i++) {
        const v = ring[(head + i) % RING_CAPACITY]!.values[metric];
        if (v !== undefined) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
      }
      const yRange = yMax - yMin || 1;

      ctx.strokeStyle = colors[mi % colors.length] ?? '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < count; i++) {
        const v = ring[(head + i) % RING_CAPACITY]!.values[metric];
        if (v === undefined) continue;
        const x = pad + (i / (count - 1)) * (w - 2 * pad);
        const y = h - pad - ((v - yMin) / yRange) * (h - 2 * pad);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    });

    ctx.restore();
  }, [metrics, chartPalette]);

  useEffect(() => {
    if (!fallbackRef.current) return;
    let running = true;
    const loop = () => {
      if (!running) return;
      drawFallback();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [drawFallback]);

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas ref={canvasRef} className="block w-full" aria-label="Live metrics canvas" />
    </div>
  );
}
