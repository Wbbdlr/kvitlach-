// Hand-rolled animation helpers (no library — matches the project's existing
// convention of hand-rolled CSS @keyframes for everything). These are small,
// fire-and-forget DOM utilities used outside React's render tree, the same
// technique the verified mockup uses for its card fly-in and press-pulse.

const FLY_DURATION_MS = 480;
const PRESS_DURATION_MS = 220;

// Animates a transient card-back node from the deck to a hand container,
// then resolves so the caller can swap in the real (revealed or hidden) card.
export function flyCard(fromEl: HTMLElement, toEl: HTMLElement, durationMs = FLY_DURATION_MS): Promise<void> {
  return new Promise((resolve) => {
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const flyEl = document.createElement("div");
    flyEl.className = "card back table-fly-card";
    flyEl.style.left = `${fromRect.left}px`;
    flyEl.style.top = `${fromRect.top}px`;
    flyEl.style.width = `${fromRect.width}px`;
    flyEl.style.height = `${fromRect.height}px`;
    document.body.appendChild(flyEl);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flyEl.style.left = `${toRect.left}px`;
        flyEl.style.top = `${toRect.top}px`;
      });
    });

    window.setTimeout(() => {
      flyEl.remove();
      resolve();
    }, durationMs);
  });
}

// Quick press-pulse feedback on a dock button; safe to call repeatedly.
export function pressFx(el: HTMLElement, durationMs = PRESS_DURATION_MS): void {
  el.classList.remove("table-press-fx");
  void el.offsetWidth; // force reflow so a repeated press restarts the animation
  el.classList.add("table-press-fx");
  window.setTimeout(() => el.classList.remove("table-press-fx"), durationMs);
}
