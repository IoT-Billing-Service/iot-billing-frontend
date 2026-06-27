import { test, expect } from '@playwright/test';

/**
 * Verifies the SSR HTML contains device count from the x-device-count cookie
 * (set by middleware), rather than an empty-state flash.
 */
test.describe('Dashboard SSR hydration flash fix', () => {
  function dateRange() {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { from, to };
  }

  test('initial HTML contains data-device-count from cookie', async ({ request }) => {
    const { from, to } = dateRange();
    const response = await request.get(`/dashboard?from=${from}&to=${to}`, {
      headers: { Cookie: 'x-device-count=3' },
    });

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('data-device-count="3"');
  });

  test('initial HTML does not contain "No devices connected"', async ({ request }) => {
    const { from, to } = dateRange();
    const response = await request.get(`/dashboard?from=${from}&to=${to}`);

    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain('No devices connected');
  });
});
