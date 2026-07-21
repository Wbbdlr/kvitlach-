import { clsx } from "clsx";
import { Card } from "../types";
import { cardImages } from "./selectors";

export function CardView({ card, hidden, size = "md" }: { card: Card; hidden?: boolean; size?: "md" | "lg" }) {
  const key = hidden ? "blank" : card.name;
  const src = cardImages[key] ?? cardImages.blank;
  const alt = hidden ? "Face-down card" : `Card ${card.name}`;
  const showFallback = !hidden && !cardImages[key];
  const sizeClass = size === "lg" ? "w-12 h-[4.5rem] sm:w-16 sm:h-24" : "w-10 h-14 sm:w-12 sm:h-16";
  const ignored = Boolean(card.attributes?.eleveroonIgnored);

  return (
    <div
      className={clsx(
        `${sizeClass} rounded-lg border bg-transparent shadow-none overflow-hidden relative`,
        hidden ? "border-transparent" : "border-transparent",
        ignored && "opacity-60 grayscale border-slate-300"
      )}
    >
      <img src={src} alt={alt} className="w-full h-full object-contain" />
      {showFallback && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">
          {card.name}
        </span>
      )}
      {ignored && !hidden && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-600 bg-white/40">
          Eleveroon
        </span>
      )}
    </div>
  );
}
