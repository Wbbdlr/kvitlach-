---
name: phone-ui
description: Kvitlach's phone behaviour — auto-landscape, fullscreen on entering a table, and the PWA install prompt. Use when touching immersive.ts, pwa.ts, sw.js, InstallPrompt.tsx, or when players report the table looking wrong on a phone.
---

# Phones: landscape, fullscreen, install

Testers kept landing on the felt in portrait, seeing a squeezed table, and not
working out they were meant to rotate. Three pieces, in order of how much they
actually help.

## `table/immersive.ts`

`enterImmersive()` goes fullscreen and locks landscape; `exitImmersive()`
undoes both.

- **Called from the Join / Create / Watch / Practice handlers in `App.tsx`,
  never from an effect.** That is the whole trick. `fullscreen.ts`'s comment
  ("no way to enter fullscreen automatically") is true of `orientationchange`,
  which is not a user gesture — but *entering a table is a tap*, and a tap is.
- **The call must stay synchronous inside the handler.** The room arrives a WS
  round-trip later; waiting for it loses the gesture.
- **The landscape lock is chained onto the fullscreen promise**, because
  Chrome rejects `orientation.lock()` outright unless a fullscreen element
  already exists.
- **Gated on `isHandheld()`** — coarse pointer **and** a screen short edge
  ≤820px. Coarse alone catches touchscreen laptops and TVs, and yanking a
  laptop into fullscreen because someone clicked Join would be obnoxious.
  Short edge, not width: the phone may already be held landscape.
- **`exitImmersive()` hangs off `room` disappearing, not off the Leave
  button.** Being kicked, the banker closing the table and a voided room all
  land there too, and each would otherwise strand someone locked landscape on
  the portrait lobby.
- **iOS gets none of this** — no Fullscreen API for ordinary elements, no
  orientation lock. The `.k-rotate-hint` banner and the install nudge are the
  whole story there. Don't "fix" the no-op.

## `pwa.ts` + `public/sw.js` + `InstallPrompt.tsx`

- **The service worker caches nothing on purpose.** Chrome only fires
  `beforeinstallprompt` for a site whose worker has a fetch handler, and a
  caching worker would serve testers yesterday's bundle while the footer badge
  told them otherwise. Its fetch handler must stay a no-op that never calls
  `respondWith()`.
- **Removing the worker later needs a released version that calls
  `unregister()` first.** Deleting the file does not uninstall it.
- **`beforeinstallprompt` fires once, early, often before React mounts, and
  never again.** `pwa.ts` listens at module scope for that reason; don't move
  it into a component. Tests must dispatch `appinstalled` in `beforeEach` — the
  deferred prompt is module-scope state and leaks between tests otherwise.
- The iOS branch of `InstallPrompt` shares `kvitlach.iosInstallHintSeen` with
  `TableRoot`'s in-table hint, so dismissing either silences both.

## Sizes worth knowing

Cards render at ~92 CSS px on the felt, 36px in the lobby. The felt itself is a
fixed 1280-wide virtual stage scaled to the viewport (`stage.ts`) — position
things in stage units, never viewport pixels.
