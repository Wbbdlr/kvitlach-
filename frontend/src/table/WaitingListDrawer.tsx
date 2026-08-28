import { Player } from "../types";
import { Icon } from "./icons";
import { initialsOf } from "./Seat";
import { StageOverlay } from "./StageOverlay";
import { fullName } from "./selectors";
import { useEscapeKey } from "../useEscapeKey";

export interface WaitingListEntry {
  player: Player;
  isViewer: boolean;
  position: number;
}

export interface WaitingListDrawerProps {
  open: boolean;
  onClose: () => void;
  players: WaitingListEntry[];
}

// Opened from the waiting chip in TableRoot's chrome. The felt only ever
// seats as many players as it can render without collision (store.ts's
// MAX_SEATED_PLAYERS_PER_ROUND) -- everyone else already exists in
// room.waitingPlayerIds, already in the exact order they'll rotate in
// (one new seat per round), this just gives that a real, readable surface
// instead of a single tooltip string a big table makes unreadable.
export function WaitingListDrawer({ open, onClose, players }: WaitingListDrawerProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  // The viewer's own row is the one thing worth finding at a glance, so it's
  // pinned to the top -- but "position" still reflects their REAL place in
  // the rotation (position 1 is always seated next round, not "someday"),
  // it's only the ROW that moves, not the number.
  const sorted = [...players].sort((a, b) => (a.isViewer === b.isViewer ? a.position - b.position : a.isViewer ? -1 : 1));

  return (
    <StageOverlay>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-3"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-4 flex flex-col gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold text-slate-800 min-w-0">
              <Icon name="users" size={16} className="text-blue-600 flex-none" />
              <span className="truncate">Waiting to be seated</span>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600 flex-none" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="text-xs text-slate-500 -mt-1">
            One new seat opens each round, in this order -- everyone's guaranteed a turn.
          </div>

          <ul className="flex flex-col gap-1.5">
            {sorted.map((entry) => (
              <li
                key={entry.player.id}
                className={
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 " +
                  (entry.isViewer ? "border-accent bg-accent/5" : "border-slate-200 bg-slate-50")
                }
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                  {initialsOf(entry.player)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                  {entry.isViewer ? "You" : fullName(entry.player) || "New player"}
                </span>
                <span className="flex-none text-xs font-semibold text-slate-500">
                  {entry.position === 1 ? "Up next" : `~${entry.position} rounds`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </StageOverlay>
  );
}
