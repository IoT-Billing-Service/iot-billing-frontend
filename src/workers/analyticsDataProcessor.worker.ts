interface AnalyticsChunk {
  startTime: number;
  endTime: number;
  data: number[];
  metadata?: Record<string, unknown>;
}

interface ProcessorMessage {
  type: 'processChunk' | 'processAll';
  chunks: AnalyticsChunk[];
}

interface ProcessorResponse {
  type: 'chunkProcessed' | 'allProcessed';
  result: {
    averages: number[];
    totals: number[];
    timestamps: number[];
  };
}

function computeChunkStats(chunks: AnalyticsChunk[]) {
  const sorted = chunks.sort((a, b) => a.startTime - b.startTime);
  const averages: number[] = [];
  const totals: number[] = [];
  const timestamps: number[] = [];

  for (const chunk of sorted) {
    if (chunk.data.length === 0) continue;
    const sum = chunk.data.reduce((acc, v) => acc + v, 0);
    averages.push(sum / chunk.data.length);
    totals.push(sum);
    timestamps.push(chunk.startTime);
  }

  return { averages, totals, timestamps };
}

self.onmessage = (event: MessageEvent<ProcessorMessage>) => {
  const { type, chunks } = event.data;

  if (type === 'processChunk') {
    const result = computeChunkStats(chunks);
    const response: ProcessorResponse = { type: 'chunkProcessed', result };
    self.postMessage(response);
  } else if (type === 'processAll') {
    const result = computeChunkStats(chunks);
    const response: ProcessorResponse = { type: 'allProcessed', result };
    self.postMessage(response);
  }
};
