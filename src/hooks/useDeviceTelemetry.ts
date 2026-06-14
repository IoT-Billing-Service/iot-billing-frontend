'use client';

import { useQuery } from '@tanstack/react-query';
import type { DeviceTelemetry } from '@/types';

const BATCH_INTERVAL = 500;

async function fetchTelemetryBatch(deviceIds: string[]): Promise<DeviceTelemetry[]> {
  const params = new URLSearchParams({ deviceIds: deviceIds.join(',') });
  const response = await fetch(`/api/telemetry/batch?${params}`);
  if (!response.ok) throw new Error('Failed to fetch telemetry');
  return response.json();
}

export function useDeviceTelemetry(deviceIds: string[]) {
  return useQuery({
    queryKey: ['deviceTelemetry', deviceIds],
    queryFn: () => fetchTelemetryBatch(deviceIds),
    refetchInterval: BATCH_INTERVAL,
    staleTime: 250,
  });
}

export function useSingleDeviceTelemetry(deviceId: string) {
  return useDeviceTelemetry([deviceId]);
}
