import { useState } from "react";
import { clsx } from "clsx";
import { Card } from "../types";
import { cardImages } from "./selectors";
import { Icon } from "./icons";

// A single card, shared by both UIs.
//
// New table UI: omit `size` -- the containing .k-hand rule sets the height
// (62px normally, 72px for the dealer, 92px for your own hand), exactly
// like the mockup's .card/.hand pair, so every hand scales by context.
// Old list UI: passes an explicit `size` and keeps its Tailwind box sizing.
export function CardView({
  card,
  hidden,
  size,
  dealDelayMs,
  pastFirstPaint,
}: {
  card: Card;
  hidden?: boolean;
  size?: "md" | "lg";
  // How long to hold before flying in -- only meaningful for a hand's very
  // first card (see Seat.tsx/Dealer.tsx), staggering the opening deal so it
  // visibly goes around the table instead of every seat's card 1 landing at
  // once.
  dealDelayMs?: number;
  // Was the table already past its first paint when THIS card mounted? A
  // fresh page load/reconnect mid-round mounts every already-dealt card for
  // the first time on this client -- without this, all of it would fly in
  // at once as if freshly dealt, replaying a deal that already happened.
  // Captured via a lazy useState initializer (runs exactly once, at mount)
  // rather than read directly off the prop: this card's key is round-scoped
  // (see Seat.tsx), so it only ever mounts once for its whole lifetime, and
  // the decision has to freeze at that moment -- reading the live prop on
  // every render would let a later, unrelated re-render retroactively ADD
  // the animation class to an already-settled card (browsers restart a CSS
  // animation whenever animation-name goes from none to set), replaying it
  // for a card that in reality arrived silently.
  pastFirstPaint?: boolean;
}) {
  const [animate] = useState(() => Boolean(pastFirstPaint));
  const key = hidden ? "blank" : card.name;
  const src = cardImages[key] ?? cardImages.blank;
  const alt = hidden ? "Face-down card" : `Card ${card.name}`;
  const showFallback = !hidden && !cardImages[key];
  const ignored = Boolean(card.attributes?.eleveroonIgnored);

  const sizeClass = size === "lg" ? "w-12 h-[4.5rem] sm:w-16 sm:h-24" : size === "md" ? "w-10 h-14 sm:w-12 sm:h-16" : "";

  const elevActive = ignored && !hidden;

  return (
    <span
      className={clsx("relative inline-flex", animate && "k-card-in", sizeClass, elevActive && "k-card-elev")}
      style={animate && dealDelayMs ? { animationDelay: `${dealDelayMs}ms` } : undefined}
    >
      {/* The muted/grayscale treatment belongs on the card face only -- putting
          it on the wrapper used to desaturate the gold glow/badge below right
          along with the card, which defeated the point of making this read as
          a good moment rather than a dead one. */}
      <img
        src={src}
        alt={alt}
        className={clsx(size ? "w-full h-full object-contain" : undefined, elevActive && "opacity-70 grayscale")}
      />
      {showFallback && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
          {card.name}
        </span>
      )}
      {ignored && !hidden && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 k-elev-badge">
          <Icon name="star" size={12} className="k-elev-badge-icon" />
          <span className="k-elev-badge-label">Eleveroon</span>
        </span>
      )}
    </span>
  );
}
