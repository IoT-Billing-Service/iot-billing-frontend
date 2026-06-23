'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useTheme } from '@/components/providers/ThemeProvider';

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
const RING_CAPACITY = 10_000;
const FULL_REDRAW_MS = 500;
const RATE_WARN_THRESHOLD = 3000;
const MAX_POINTS_PER_METRIC = 2_000;

/** Split a flat Float64Array into chunks of CHUNK_SIZE points (2 floats each). */
function* chunkBuffer(buf: Float64Array): Generator<Float64Array> {
  const floatsPerChunk = CHUNK_SIZE * 2;
  for (let offset = 0; offset < buf.length; offset += floatsPerChunk) {
    yield buf.subarray(offset, offset + floatsPerChunk);
  }
}

export function LiveMetricsCanvas({ stream, metrics, height = 300 }: LiveMetricsCanvasProps) {
  const { chartPalette, prefersReducedMotion } = useTheme();
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
  const lastFullRedraw = useRef(0);
  const lastDrawnHead = useRef(0);
  const lastFrameTime = useRef(0);
  const msgTimestamps = useRef<number[]>([]);
  const rangeCache = useRef<Map<string, { min: number; max: number }>>(new Map());
  const isPageVisible = useRef(true);
  const [memoryInfo, setMemoryInfo] = useState<string | null>(null);

  // ─── Visibility tracking ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      isPageVisible.current = document.visibilityState === 'visible';
      if (isPageVisible.current) lastFullRedraw.current = 0;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ─── Dev-mode memory measurement ─────────────────────────────────────────────
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const measure = async () => {
      try {
        const perf = performance as Performance & {
          measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
        };
        if (typeof perf.measureUserAgentSpecificMemory === 'function') {
          const result = await perf.measureUserAgentSpecificMemory();
          setMemoryInfo(`LiveMetricsCanvas memory: ${((result.bytes ?? 0) / 1_048_576).toFixed(2)} MB`);
        }
      } catch { /* not available in all browsers */ }
    };
    const interval = setInterval(measure, 30_000);
    measure();
    return () => clearInterval(interval);
  }, []);

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
      if (e.data.type === 'ready') workerReadyRef.current = true;
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

  // ─── Transfer OffscreenCanvas once on mount ───────────────────────────────────
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
        workerRef.current.postMessage({ type: 'resize', width: w * dpr, height: height * dpr });
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
      const metric = metrics[0] ?? '';
      const flat = new Float64Array(stream.length * 2);
      for (let i = 0; i < stream.length; i++) {
        flat[i * 2] = stream[i]!.timestamp;
        flat[i * 2 + 1] = stream[i]!.values[metric] ?? 0;
      }

      const chunks = [...chunkBuffer(flat)];
      const totalChunks = chunks.length;

      for (let idx = 0; idx < totalChunks; idx++) {
        const transferBuf = chunks[idx]!.slice().buffer;
        try {
          worker.postMessage(
            { type: 'chunk', data: new Float64Array(transferBuf), chunkIndex: idx, totalChunks },
            [transferBuf],
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === 'DataCloneError') {
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

    const now = performance.now();
    msgTimestamps.current.push(now);
    const cutoff = now - 1000;
    msgTimestamps.current = msgTimestamps.current.filter((t) => t > cutoff);
    if (msgTimestamps.current.length > RATE_WARN_THRESHOLD) {
      console.warn(
        `[LiveMetricsCanvas] High incoming rate: ${msgTimestamps.current.length} msg/s.`,
      );
    }
  }, [stream, metrics]);

  // ─── Range computation (cached) ───────────────────────────────────────────────
  const computeRange = useCallback((metric: string): { min: number; max: number } => {
    const cached = rangeCache.current.get(metric);
    if (cached) return cached;

    const ring = ringRef.current;
    const head = headRef.current;
    const count = countRef.current;
    let min = Infinity, max = -Infinity, found = false;

    for (let i = 0; i < count; i++) {
      const v = (ring[(head + i) % RING_CAPACITY] as MetricsFrame).values[metric];
      if (v === undefined) continue;
      found = true;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const result = found ? { min, max } : { min: 0, max: 1 };
    rangeCache.current.set(metric, result);
    return result;
  }, []);

  // ─── Fallback draw frame ──────────────────────────────────────────────────────
  const drawFrame = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container || !fallbackRef.current) return;

      const rect = container.getBoundingClientRect();
      const isOffscreen =
        rect.bottom < 0 ||
        rect.top > (window.innerHeight || document.documentElement.clientHeight) ||
        rect.right < 0 ||
        rect.left > (window.innerWidth || document.documentElement.clientWidth);
      if (isOffscreen) return;

      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = height;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const ring = ringRef.current;
      const head = headRef.current;
      const count = countRef.current;
      if (count < 2) return;

      const fullRedraw = now - lastFullRedraw.current >= FULL_REDRAW_MS;
      const padding = 10;
      const maxPoints = Math.min(MAX_POINTS_PER_METRIC, Math.max(50, Math.floor(w)));

      ctx.clearRect(0, 0, w, h);

      const colors =
        chartPalette.length >= metrics.length
          ? chartPalette
          : ['#5ec962', '#fca50a', '#21918c', '#932667', '#fcffa4'];

      metrics.forEach((metric, idx) => {
        const color = colors[idx % colors.length] ?? '#ffffff';
        const { min, max } = computeRange(metric);
        const rng = max - min || 1;

        const startIdx = !fullRedraw && lastDrawnHead.current > 0
          ? Math.max(0, lastDrawnHead.current - 1)
          : 0;

        // Decimation: stride so we never plot more than maxPoints
        const span = count - startIdx;
        const stride = Math.max(1, Math.ceil(span / maxPoints));

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let first = true;
        let lastPlotted = -1;

        for (let i = startIdx; i < count; i += stride) {
          const v = (ring[(head + i) % RING_CAPACITY] as MetricsFrame).values[metric];
          if (v === undefined) continue;
          const x = padding + (i / (count - 1)) * (w - 2 * padding);
          const y = h - padding - ((v - min) / rng) * (h - 2 * padding);
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          first = false;
          lastPlotted = i;
        }

        // Always anchor to the most recent sample
        if (lastPlotted !== count - 1) {
          const v = (ring[(head + count - 1) % RING_CAPACITY] as MetricsFrame).values[metric];
          if (v !== undefined) {
            const x = padding + ((count - 1) / (count - 1)) * (w - 2 * padding);
            const y = h - padding - ((v - min) / rng) * (h - 2 * padding);
            first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      });

      if (fullRedraw) {
        lastFullRedraw.current = now;
        rangeCache.current.clear();
      }
      lastDrawnHead.current = head + count;
    },
    [height, metrics, computeRange, chartPalette],
  );

  // ─── Fallback rAF loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fallbackRef.current) return;
    let running = true;

    const loop = (now: number) => {
      if (!running) return;
      if (!isPageVisible.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      if (lastFrameTime.current > 0 && now - lastFrameTime.current > 5000) {
        lastFullRedraw.current = 0;
      }
      lastFrameTime.current = now;
      drawFrame(now);
      rafRef.current = requestAnimationFrame(loop);
    };

    if (prefersReducedMotion) {
      const id = setInterval(() => {
        if (!running || !isPageVisible.current) return;
        const now = performance.now();
        if (lastFrameTime.current > 0 && now - lastFrameTime.current > 5000) lastFullRedraw.current = 0;
        lastFrameTime.current = now;
        drawFrame(now);
      }, 250);
      return () => { running = false; clearInterval(id); };
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [drawFrame, prefersReducedMotion]);

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas ref={canvasRef} className="block w-full" aria-label="Live metrics canvas" />
      {memoryInfo && (
        <div className="absolute bottom-1 right-2 rounded bg-black/70 px-2 py-0.5 text-[10px] text-gray-400 font-mono">
          {memoryInfo}
        </div>
      )}
    </div>
  );
}
