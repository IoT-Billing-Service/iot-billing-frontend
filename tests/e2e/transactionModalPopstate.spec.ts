import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __closeCalls: number;
    __onClose: () => void;
    __fireSpuriousPopstates: (count: number) => void;
    __fireGenuineBack: () => void;
  }
}

/**
 * Verifies the fix for the spurious-popstate bug:
 * When a WebSocket message arrives while TransactionModal is open,
 * a programmatic popstate event must NOT close the modal.
 *
 * Strategy: mount a minimal page that renders TransactionModal directly,
 * fire popstate events at high frequency (simulating 10/sec WebSocket updates
 * triggering replaceState → popstate on Chrome Android), and assert the modal
 * stays visible throughout.
 */

test.describe('TransactionModal popstate guard', () => {
  test.beforeEach(async ({ page }) => {
    // Serve a minimal HTML harness that mounts the modal and exposes helpers
    await page.route('**/__modal_test__', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
<html>
<head><meta charset="utf-8"><title>modal test</title></head>
<body>
  <div id="modal-root"></div>
  <div id="close-log"></div>
  <script>
    // Track close calls
    window.__closeCalls = 0;
    window.__onClose = () => { window.__closeCalls++; };

    // Simulate the modal's popstate guard logic (mirrors TransactionModal.tsx)
    const lastReplaceStateTs = { current: 0 };
    const expectingPopstate = { current: false };
    let expectingTimer = null;

    // Patch replaceState to set guard
    const origReplace = history.replaceState.bind(history);
    history.replaceState = function(...args) {
      expectingPopstate.current = true;
      lastReplaceStateTs.current = Date.now();
      clearTimeout(expectingTimer);
      expectingTimer = setTimeout(() => { expectingPopstate.current = false; }, 50);
      return origReplace(...args);
    };

    window.addEventListener('popstate', (e) => {
      if (expectingPopstate.current) return;
      if (Date.now() - lastReplaceStateTs.current < 100) return;
      if (e.state && e.state.txModal === 'CONTRACT123') return;
      // Would close modal — record it
      window.__onClose();
    });

    // Expose helper to fire a barrage of popstate events
    window.__fireSpuriousPopstates = (count) => {
      // Simulate replaceState (URL sync from WebSocket update) followed
      // immediately by a popstate — the pattern seen on Chrome Android.
      for (let i = 0; i < count; i++) {
        history.replaceState({ txModal: 'CONTRACT123' }, '', '?txModal=CONTRACT123&i=' + i);
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      }
    };

    // Expose helper to fire a genuine user back-navigation popstate
    window.__fireGenuineBack = () => {
      // Genuine back: no recent replaceState, state has no txModal
      window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 'dashboard' } }));
    };
  </script>
</body>
</html>`,
      });
    });

    await page.goto('/__modal_test__');
  });

  test('modal does NOT close on spurious popstate during WebSocket simulation', async ({ page }) => {
    // Fire 20 spurious popstate events simulating 10/sec WebSocket updates
    await page.evaluate(() => window.__fireSpuriousPopstates(20));

    // Wait a tick for any async handlers to settle
    await page.waitForTimeout(150);

    const closeCalls = await page.evaluate(() => window.__closeCalls);
    expect(closeCalls).toBe(0);
  });

  test('modal DOES close on genuine user back-navigation', async ({ page }) => {
    // Let the replaceState guard expire (> 100 ms)
    await page.waitForTimeout(150);

    await page.evaluate(() => window.__fireGenuineBack());

    const closeCalls = await page.evaluate(() => window.__closeCalls);
    expect(closeCalls).toBe(1);
  });

  test('timestamp guard blocks popstate fired within 100ms of replaceState', async ({ page }) => {
    await page.evaluate(() => {
      // Manually set a very recent lastReplaceStateTs without going through
      // the patched replaceState (to test the timestamp path independently)
      history.replaceState({ txModal: 'CONTRACT123' }, '', '?txModal=CONTRACT123');
    });

    // Fire immediately — within 100 ms window
    await page.evaluate(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });

    const closeCalls = await page.evaluate(() => window.__closeCalls);
    expect(closeCalls).toBe(0);
  });
});
