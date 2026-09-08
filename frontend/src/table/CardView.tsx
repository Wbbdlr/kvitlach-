import { useState } from "react";
import { clsx } from "clsx";
import { Card } from "../types";
import { cardImages } from "./selectors";
import { Icon } from "./icons";
import { ART_H, ART_W, DEFAULT_MARK, markSvgBody } from "./cardMark";
import { useFamilyMark } from "../familyProfile";

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
  winning,
  futched,
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
  // This card is part of an outright win -- a 21, or one of the two cards in
  // a rosier pair (selectors.ts's winningCardIndices decides; Seat/Dealer
  // gate it on the card actually being face-up, because a glow on a
  // face-down card announces the result before the reveal does).
  winning?: boolean;
  // The mirror of `winning`: this hand went over 21. Gated on the card being
  // face-up for the same reason, and never set for a blatt that overshot --
  // that settles as a push and its pill says so (selectors.ts).
  futched?: boolean;
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

  // The maker's mark, drawn over the art instead of baked into the PNG. The
  // art in public/ is now the UNMARKED render (tools/card-mark.py --no-mark),
  // so this is the only thing that draws it -- if it stops rendering the mark
  // is simply gone, it does not fall back to a stamped PNG.
  //
  // "" for a face-down card and for every card outside DEFAULT_MARK.cards
  // (currently 1, 8 and 12), so no element is created at all rather than an
  // empty <svg> over every card on a felt that re-renders each round.
  // The text comes from the active profile, which is the house look unless a
  // family link or a stamped table says otherwise. No branch on "is this a
  // family table" -- the house IS a profile. See family-profiles.ts.
  const mark = useFamilyMark();
  const markBody = hidden || showFallback ? "" : markSvgBody(Number(card.name), mark);

  // The ring stays in the hand for the rest of the round.
  //
  // This card used to puff, crumble and then fly out to the discard pile,
  // unmounting itself a couple of seconds after it was rejected -- the pile
  // was meant to be the record, not "a ring left sitting in the hand". That
  // was the wrong call, and it was reported as a bug: "that card should
  // appear as part of the hand until the next round, so people can still see
  // that it happened. That's the point of having the overlay, so people can
  // see why the hand didn't bust."
  //
  // It is the right correction. An Eleveroon reject is the explanation for an
  // arithmetic that otherwise looks wrong -- a hand holding an 11 that plainly
  // should have busted it -- and an explanation that removes itself after two
  // seconds is not available to the person who looks up a moment later, or to
  // anyone who reconnects. The card still joins the discard pile (that list is
  // cards no longer countable, which this is); it just also stays where it was
  // dealt, greyed and ringed, until the round ends and the hand clears.

  return (
    <span
      className={clsx(
        "relative inline-flex",
        animate && "k-card-in",
        sizeClass,
        // k-card-elev is the ring, and it now stays for the rest of the round
        // (see the comment above elevActive). k-card-elev-in is the one-shot
        // "just got rejected" pop, gated on `animate` the same way k-card-in
        // is: a client that reconnects mid-round mounts the card already
        // ringed rather than replaying a rejection it did not witness.
        elevActive && "k-card-elev",
        elevActive && animate && "k-card-elev-in",
        // Deliberately NOT gated on `animate`, unlike everything above it.
        // Those are one-shot arrival motions, and replaying an arrival for a
        // card that in truth arrived before this client connected is a lie
        // about what just happened. This one is different in kind: it ends in
        // a settled gold rim that says "these are the cards that won", which
        // is as true for somebody who reconnects mid-round as for the player
        // who was watching. They see a short pop on mount and then the same
        // marker everyone else is looking at.
        winning && "k-card-win",
        // Not gated on `animate` either, and for the same reason: the settled
        // state is a statement about the hand, not a replay of its arrival.
        futched && "k-card-futch"
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
      {markBody && (
        // Same opacity/grayscale treatment as the img above: an Eleveroon
        // reject desaturates its card face, and a mark that stayed blue on a
        // greyed-out card would read as a separate element sitting on top of
        // it rather than as something printed on the card.
        <svg
          className={clsx("k-cardmark", elevActive && "opacity-70 grayscale")}
          viewBox={`0 0 ${ART_W} ${ART_H}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: markBody }}
        />
      )}
      {showFallback && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
          {card.name}
        </span>
      )}
      {ignored && !hidden && (
        <span className={clsx("absolute inset-0 flex flex-col items-center justify-center gap-0.5 k-elev-badge", animate && "k-elev-badge-in")}>
          <Icon name="magen" size={12} className="k-elev-badge-icon" />
          <span className="k-elev-badge-label">Eleveroon</span>
        </span>
      )}
    </span>
  );
}
