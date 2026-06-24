import { test, expect } from '@playwright/test';

/**
 * Cross-tab device store synchronisation test.
 *
 * Opens two tabs, types a filter in Tab A, then simulates a billing telemetry
 * update.  Verifies that Tab B never renders telemetry with the wrong filter
 * by checking that the filter input value and the telemetry table are always
 * consistent.
 */
test.describe('Cross-tab device store sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    // Wait for the page to render after wallet check
    await page.waitForSelector('input[placeholder="Filter devices…"]', { timeout: 15000 });
  });

  test('Tab B receives atomic telemetry+filter state from Tab A', async ({ page, context }) => {
    const tabA = page;
    const tabB = await context.newPage();
    await tabB.goto('/dashboard');
    await tabB.waitForSelector('input[placeholder="Filter devices…"]', { timeout: 15000 });

    // ── Tab A types a filter ─────────────────────────────────────────────
    const filterInputA = tabA.getByPlaceholder('Filter devices…');
    await filterInputA.click();
    await filterInputA.fill('device-alpha');

    // ── Simulate a billing telemetry update arriving in Tab A ─────────────
    await tabA.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__deviceStore as {
        getState: () => {
          telemetry: Record<string, unknown>;
          filter: string;
          batchUpdate: (t: Record<string, unknown>, f: string) => void;
        };
      };
      if (store) {
        const state = store.getState();
        state.batchUpdate(
          { 'device-alpha': { deviceId: 'device-alpha', amount: '1000', timestamp: Date.now() } },
          state.filter,
        );
      }
    });

    // ── Wait for the BroadcastChannel to propagate ───────────────────────
    await tabB.waitForTimeout(300);

    // ── Assert Tab B has the telemetry data ──────────────────────────────
    const telemetryTableB = tabB.locator('text=Billing Telemetry');
    await expect(telemetryTableB).toBeVisible();

    // ── Assert Tab B has the correct filter ──────────────────────────────
    const filterInputB = tabB.getByPlaceholder('Filter devices…');
    await expect(filterInputB).toHaveValue('device-alpha');

    // ── Assert the telemetry rows match the filter (no mismatched state) ─
    const rows = tabB.locator('table tbody tr');
    await expect(rows).not.toHaveCount(0);
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const deviceId = await rows.nth(i).locator('td').nth(0).textContent();
      expect(deviceId?.toLowerCase()).toContain('device-alpha');
    }

    await tabB.close();
  });

  test('Tab B filter stays consistent when telemetry updates arrive', async ({ page, context }) => {
    const tabA = page;
    const tabB = await context.newPage();
    await tabB.goto('/dashboard');
    await tabB.waitForSelector('input[placeholder="Filter devices…"]', { timeout: 15000 });

    // ── Tab B types a filter ─────────────────────────────────────────────
    const filterInputB = tabB.getByPlaceholder('Filter devices…');
    await filterInputB.click();
    await filterInputB.fill('beta');

    // ── Tab A receives telemetry ──────────────────────────────────────────
    await tabA.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__deviceStore as {
        getState: () => {
          telemetry: Record<string, unknown>;
          filter: string;
          batchUpdate: (t: Record<string, unknown>, f: string) => void;
        };
      };
      if (store) {
        const state = store.getState();
        state.batchUpdate(
          { 'device-beta': { deviceId: 'device-beta', amount: '500', timestamp: Date.now() } },
          state.filter,
        );
      }
    });

    await tabB.waitForTimeout(300);

    // ── Tab B's filter should remain "beta" (not overwritten by Tab A) ──
    await expect(filterInputB).toHaveValue('beta');

    await tabB.close();
  });
});
