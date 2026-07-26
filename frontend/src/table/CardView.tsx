import { clsx } from "clsx";
import { Card } from "../types";
import { cardImages } from "./selectors";

// A single card, shared by both UIs.
//
// New table UI: omit `size` -- the containing .k-hand rule sets the height
// (62px normally, 72px for the dealer, 92px for your own hand), exactly
// like the mockup's .card/.hand pair, so every hand scales by context.
// Old list UI: passes an explicit `size` and keeps its Tailwind box sizing.
export function CardView({ card, hidden, size }: { card: Card; hidden?: boolean; size?: "md" | "lg" }) {
  const key = hidden ? "blank" : card.name;
  const src = cardImages[key] ?? cardImages.blank;
  const alt = hidden ? "Face-down card" : `Card ${card.name}`;
  const showFallback = !hidden && !cardImages[key];
  const ignored = Boolean(card.attributes?.eleveroonIgnored);

  const sizeClass = size === "lg" ? "w-12 h-[4.5rem] sm:w-16 sm:h-24" : size === "md" ? "w-10 h-14 sm:w-12 sm:h-16" : "";

  return (
    <span className={clsx("relative inline-flex", sizeClass, ignored && "opacity-60 grayscale")}>
      <img src={src} alt={alt} className={size ? "w-full h-full object-contain" : undefined} />
      {showFallback && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
          {card.name}
        </span>
      )}
      {ignored && !hidden && (
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-slate-700 bg-white/40">
          Eleveroon
        </span>
      )}
    </span>
  );
}
