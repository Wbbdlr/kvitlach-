import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Card } from "../types";
import { cardImages } from "./selectors";
import { Icon } from "./icons";

// Total ms from mount to a freshly-rejected card vanishing into the discard
// pile: cardDealIn (340) + eleveroonReject's own delay (340) + its duration
// (620) + cardDiscardFly's duration (480) -- see index.css's comment above
// .k-card-discard-out for the full sequenced timeline this mirrors. Kept as
// one constant so the JS unmount timer and the CSS delays can't drift apart.
const DISCARD_FLIGHT_MS = 340 + 340 + 620 + 480;

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
  const isBlank = src === cardImages.blank;
  const alt = hidden ? "Face-down card" : `Card ${card.name}`;
  const showFallback = !hidden && !cardImages[key];
  const ignored = Boolean(card.attributes?.eleveroonIgnored);

  const sizeClass = size === "lg" ? "w-12 h-[4.5rem] sm:w-16 sm:h-24" : size === "md" ? "w-10 h-14 sm:w-12 sm:h-16" : "";

  const elevActive = ignored && !hidden;

  // The discard pile (DiscardPile.tsx), not a ring left sitting in the hand,
  // is the record of an Eleveroon reject -- see index.css's cardDiscardFly
  // comment and TASKS.md's "real discard pile" entry. A card that's already
  // resolved before this client connected (elevActive but not `animate`) has
  // nothing left to show here at all; one that just got rejected plays its
  // usual puff/crumble/rebound, THEN flies out and unmounts itself the same
  // way. Frozen the same way `animate` is: only the mount-time snapshot of
  // `elevActive`/`animate` should ever decide this, never a later re-render.
  const [flown, setFlown] = useState(() => elevActive && !animate);
  useEffect(() => {
    if (!elevActive || !animate || flown) return undefined;
    const timer = setTimeout(() => setFlown(true), DISCARD_FLIGHT_MS);
    return () => clearTimeout(timer);
    // Deliberately empty deps -- this fires once per card, off the frozen
    // elevActive/animate captured at mount, exactly like the `animate` state
    // itself; re-running it on some unrelated re-render would just re-arm a
    // timer for a card that's already mid-flight or already gone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (elevActive && flown) return null;

  return (
    <span
      className={clsx(
        "relative inline-flex",
        animate && "k-card-in",
        sizeClass,
        // k-card-elev is the ring, shown for however long this render still
        // happens at all -- brief for a live reject (it's mid-flight, see
        // `flown` above), the whole rest of the round for the pile's own
        // static review copy (DiscardPileModal.tsx doesn't set `elevActive`
        // through this path at all, see that file's comment).
        // k-card-elev-in/k-card-discard-out are the one-shot "just got
        // rejected, now watch it leave" motion, gated on `animate` the same
        // way k-card-in is: a reconnect/reload that would otherwise mount an
        // already-resolved ignored card for the first time on THIS client
        // instead returns null above, before ever reaching this markup.
        elevActive && "k-card-elev",
        elevActive && animate && "k-card-elev-in",
        elevActive && animate && "k-card-discard-out"
      )}
      style={animate && dealDelayMs ? { animationDelay: `${dealDelayMs}ms` } : undefined}
    >
      {/* The muted/grayscale treatment belongs on the card face only -- putting
          it on the wrapper used to desaturate the gold glow/badge below right
          along with the card, which defeated the point of making this read as
          a good moment rather than a dead one. */}
      {isBlank ? (
        // blank.png ships at 946x1438 -- deliberately, see stage.ts's MAX_SCALE
        // comment, so a card stays crisp scaled up on a 4K desktop. But that
        // resolution is wasted on literally every phone/tablet (stage-scale
        // never exceeds 1.0 below the design's native 1280px), and this is
        // the single most-loaded image in the app (every hidden card, every
        // seat, all game long). <source media> switches on viewport width,
        // matching stage.ts's own scale = min(availWidth / 1280, MAX_SCALE) --
        // NOT srcset/sizes, which resolves against the img's unscaled ~92px
        // layout box (the stage's transform: scale() never touches that) and
        // would keep fetching the small file even at MAX_SCALE on a big
        // desktop monitor, reintroducing the softening this asset exists to
        // avoid.
        <picture>
          <source media="(min-width: 1280px)" srcSet={cardImages.blank} />
          <img
            src="/blank-sm.png"
            alt={alt}
            className={clsx(size ? "w-full h-full object-contain" : undefined, elevActive && "opacity-70 grayscale")}
          />
        </picture>
      ) : (
        <img
          src={src}
          alt={alt}
          className={clsx(size ? "w-full h-full object-contain" : undefined, elevActive && "opacity-70 grayscale")}
        />
      )}
      {showFallback && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
          {card.name}
        </span>
      )}
      {ignored && !hidden && (
        <span className={clsx("absolute inset-0 flex flex-col items-center justify-center gap-0.5 k-elev-badge", animate && "k-elev-badge-in")}>
          <Icon name="star" size={12} className="k-elev-badge-icon" />
          <span className="k-elev-badge-label">Eleveroon</span>
        </span>
      )}
    </span>
  );
}
