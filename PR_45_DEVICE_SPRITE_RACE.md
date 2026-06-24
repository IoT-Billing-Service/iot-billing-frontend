# Fix #45 — Device Status Icon Sprite Animation Race Under Concurrent State Changes

## Summary

Fixes the sprite animation race condition where a device's status icon could
persist in a stale `alert` state after the device had already recovered to
`active`. The root cause was that rapid state transitions (e.g. a transient
sensor spike resolving within 200ms) could arrive out of order through async
processing, with a slower `alert` update overwriting a faster `active` update
that had already been applied.

## Context — files did not exist prior to this PR

The three files cited in the issue report did not exist in the repository at
the time this PR was opened:

| File                                     | Status before this PR |
| ---------------------------------------- | --------------------- |
| `src/components/map/DeviceMapCanvas.tsx` | Did not exist         |
| `src/components/map/spriteManager.ts`    | Did not exist         |
| `src/hooks/useDeviceStatusStream.ts`     | Did not exist         |

Rather than patching existing code, this PR **creates all three files from
scratch** with the race-condition mitigations built in from the start, along
with a full test suite covering the failure scenarios described in the issue.

---

## Problem

A device transitioning `active → alert → active` within 200ms (triggered by a
transient sensor spike) caused the sprite to freeze on `alert` even after
recovery. The sequence of events:

1. `active` update (seq=1) is dispatched and processed immediately.
2. `alert` update (seq=2) is dispatched but arrives late due to async
   processing delay.
3. `active` update (seq=3) is dispatched and applied — device appears recovered.
4. The delayed `alert` (seq=2) finally arrives and overwrites seq=3 — the icon
   snaps back to `alert` with no further update to correct it.
5. The stale `alert` icon persists for up to 5 seconds, misleading field
   technicians.

---

## Solution

Three mitigations are applied in two layers, matching the blueprint in the
issue report.

### Layer 1 — `useDeviceStatusStream.ts` (upstream, primary defence)

**100ms per-device debounce buffer**

Incoming WebSocket updates are held in a `Map<deviceId, DeviceStatusUpdate>`
buffer. Only the highest-`eventSeq` update per device survives the 100ms
window. A burst of rapid state changes (the issue example: 5 changes within
200ms) produces exactly one flush carrying the final confirmed state. Transient
spikes that resolve inside the window are never forwarded to the renderer at
all.

**In-buffer sequence guard**

If a stale update (lower `eventSeq`) arrives for a device that already has a
newer update buffered, it is discarded immediately — no timer reset, no
overwrite.

On unmount the buffer is flushed synchronously so no event is silently lost.

### Layer 2 — `spriteManager.ts` (renderer-side, second line of defence)

**Monotonic sequence guard in `applyUpdate()`**

The `SpriteManager` stores the `eventSeq` of the last applied update per
device. Any incoming update with `eventSeq ≤ current.eventSeq` is rejected
before touching sprite state. This catches the exact race in the issue report:
if seq=3 (`active`) was already applied, a late-arriving seq=2 (`alert`) is
silently dropped.

**State-machine transition validation**

Only semantically valid transitions are accepted. The transition table is
explicit and covers all four states (`active`, `idle`, `alert`, `offline`).
An update requesting an invalid transition is rejected even if its sequence
number is newer — this guards against protocol-level bugs independently of the
debounce layer.

### `DeviceMapCanvas.tsx` — wiring

The canvas component connects the two layers:

- `useDeviceStatusStream` receives the `updateDeviceSprite` callback.
- `updateDeviceSprite` calls `spriteManager.applyUpdate()` for each batched
  update, which enforces both the sequence guard and transition validation.
- `useRenderLoop` drives the draw loop; it reads the validated states from
  `SpriteManager.getAllStates()` each frame.

---

## Files changed

### Added

| File                                       | Description                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useDeviceStatusStream.ts`       | WebSocket hook with 100ms debounce buffer and in-buffer sequence guard                                                                        |
| `src/hooks/useDeviceStatusStream.test.ts`  | 9 tests: debounce collapse, stale discard, 5-change rapid-transition test, multi-device batching, unmount flush, malformed-message resilience |
| `src/components/map/spriteManager.ts`      | Sprite state manager with monotonic sequence guard and transition validation                                                                  |
| `src/components/map/spriteManager.test.ts` | 15 tests: sequence guard (equal, less-than), valid/invalid transitions, exact bug-report race scenario, 5-update stress test, lifecycle       |
| `src/components/map/DeviceMapCanvas.tsx`   | Canvas component wiring `useDeviceStatusStream` → `SpriteManager` → `useRenderLoop`                                                           |

### Modified

None. No existing files were changed.

---

## Tests

```
Test Files  23 passed (23)
     Tests  184 passed (184)
```

All pre-existing tests continue to pass. New tests added:

**`useDeviceStatusStream.test.ts`**

- Opens a single WebSocket connection on mount
- Delivers a single update after the 100ms debounce window
- Collapses 3 updates for the same device within 100ms, keeping only the latest
- Discards a stale update that arrives after a newer one was buffered
- **Rapid-transition test (blueprint requirement):** 5 status changes within 200ms — delivers only the final confirmed state (`active`, seq=5)
- Batches updates for multiple devices in the same 100ms window
- Flushes buffered updates on unmount (no data loss)
- Closes the WebSocket on unmount
- Ignores malformed messages without crashing

**`spriteManager.test.ts`**

- Returns `undefined` for an unknown device
- `initialise()` seeds state without validation
- Accepts first update for an unknown device unconditionally
- Applies an update when `eventSeq` is strictly greater
- Discards a stale update when `eventSeq` is equal
- Discards a stale update when `eventSeq` is less than current
- Allows valid transition: `active → alert`
- Allows valid recovery: `alert → active`
- Allows valid transition: `offline → active` (device came back online)
- Accepts a self-transition with higher seq
- **Race scenario from bug report:** `active(seq=1)` applied, `active(seq=3)` applied, then late `alert(seq=2)` arrives — discarded, sprite stays `active`
- **5 rapid updates stress test:** sprite always reflects the most recent confirmed state
- `remove()` deletes a device
- `clear()` removes all devices
- `getAllStates()` returns snapshots for all devices

---

## Security considerations

No authentication, signing, wallet, or contract logic is touched. The changes
are scoped entirely to the device map rendering pipeline and its WebSocket
feed. No secrets, keys, or sensitive data pass through the new code paths.

---

## Risks and remaining assumptions

- The `eventSeq` counter must be assigned server-side and must be strictly
  monotonic per device. If the backend resets `eventSeq` (e.g. after a
  service restart) without the frontend being aware, updates will be silently
  dropped until the sequence exceeds the last seen value. A reconnect clears
  no state today — this is intentional (avoids flash-of-wrong-state on
  reconnect) but should be revisited if backend restarts are frequent.
- The 100ms debounce window is a fixed constant (`DEBOUNCE_MS = 100`). If
  field requirements change (e.g. sub-100ms alert latency is required), this
  will need to be made configurable.
- `DeviceMapCanvas` uses a simplified lat/lng projection for illustration. The
  actual map projection should be substituted when integrating with a real map
  tile layer.

---

## Checklist

- [x] Change is scoped to the issue request
- [x] All 184 tests pass (`npm test`)
- [x] TypeScript type-check passes (`npm run typecheck`)
- [x] New behaviour is covered by tests
- [x] Rapid-transition test (5 changes within 200ms) verifies the sprite reflects the most recent confirmed state
- [x] No secrets committed
- [x] No unrelated formatting churn
- [x] No existing files modified
- [x] Security-sensitive assumptions documented above
