import { useMemo } from "react";
import { GameOverSummary } from "./state";
import { tableStandings } from "./playerRecord";
import { Icon } from "./table/icons";
import { useEscapeKey } from "./useEscapeKey";
import { useDialogFocus } from "./useDialogFocus";

export interface GameOverModalProps {
  summary: GameOverSummary;
  onExport: (focusPlayerId?: string) => void;
  onClose: () => void;
}

function money(net: number) {
  return `${net >= 0 ? "+" : "-"}$${Math.abs(net).toLocaleString()}`;
}

// The last thing everyone at the table sees.
//
// Rendered from the LOBBY, not the felt: by the time this shows, `room` is
// already gone and App has fallen back to the join screen (see state.ts's
// room:closed handler and GameOverSummary for why the wipe has to happen).
// Everything here therefore comes off the summary, never off the store's
// room/round -- reading those would render an empty screen.
//
// Standings are shown to EVERY player, not only the banker. playerRecord.ts's
// tableStandings deliberately leaves that gate to its caller, so this is that
// decision, made once and written down: the whole-table export has been
// available to any player from RoomInfoDrawer since it shipped ("the same page
// for everyone at the table, with the final standings"), so putting the same
// numbers on screen at the end discloses nothing new -- it just stops the
// answer to "so who won?" requiring a download.
export function GameOverModal({ summary, onExport, onClose }: GameOverModalProps) {
  useEscapeKey(onClose, true);
  const dialogRef = useDialogFocus<HTMLDivElement>(true);

  const standings = useMemo(() => tableStandings(summary.rounds), [summary.rounds]);
  const mine = standings.find((row) => row.playerId === summary.playerId);
  const rounds = summary.rounds.length;

  return (
    <div className="k-dialog-scrim" onClick={onClose}>
      <div
        className="k-dialog max-w-lg"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Game over"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="k-modal-close" onClick={onClose} aria-label="Close" title="Close">
          <Icon name="close" size={15} />
        </button>

        <div className="space-y-3 text-sm k-dialog-strong">
          <div>
            <h2 className="text-lg font-semibold">Game over</h2>
            <div className="text-xs k-dialog-sub">
              {summary.wasBanker ? "You closed" : "The banker closed"}
              {summary.roomName ? ` ${summary.roomName}` : " the table"}
              {rounds > 0 ? ` after ${rounds} ${rounds === 1 ? "round" : "rounds"}.` : "."}
            </div>
          </div>

          {rounds === 0 ? (
            <p className="text-sm">The table closed before any rounds finished, so there is nothing to record.</p>
          ) : (
            <>
              {mine && (
                <div className="rounded-lg border k-dialog-line px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Your night</div>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className={`text-xl font-semibold ${mine.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {money(mine.net)}
                    </span>
                    <span className="text-xs k-dialog-sub">
                      {mine.wins}W / {mine.losses}L over {mine.rounds} {mine.rounds === 1 ? "round" : "rounds"}
                    </span>
                  </div>
                </div>
              )}

              {/* Same row shape as the banker's in-drawer standings, on
                  purpose -- two renderings of one table is how they drift. */}
              <div className="rounded-lg border k-dialog-line px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wide k-dialog-sub">Final standings</div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {standings.map((row) => (
                    <div key={row.playerId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {row.isBanker && <Icon name="bank" size={12} className="flex-none text-amber-300" />}
                        <span className="truncate">
                          {row.name}
                          {row.playerId === summary.playerId && <span className="k-dialog-sub"> (you)</span>}
                        </span>
                      </span>
                      <span className="flex flex-none items-center gap-3 text-xs">
                        <span className="k-dialog-sub">
                          {row.wins}W / {row.losses}L
                        </span>
                        <span className={`w-16 text-right font-semibold ${row.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {money(row.net)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* The reason this screen exists at all: the export used to be
                  reachable only while seated, so closing the room destroyed
                  every player's only route to a record of the night. */}
              <div className="flex flex-wrap gap-2">
                {mine && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => onExport(summary.playerId)}
                  >
                    <Icon name="download" size={13} />
                    Save my results
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border k-dialog-line px-3 py-1.5 text-xs font-semibold"
                  onClick={() => onExport()}
                >
                  <Icon name="download" size={13} />
                  Save the whole night
                </button>
              </div>
              <div className="text-[11px] k-dialog-sub leading-snug">
                Downloads a page you can keep or share. Nothing is saved for you once you close this.
              </div>
            </>
          )}

          <div className="flex justify-end border-t k-dialog-line pt-3">
            <button type="button" className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white" onClick={onClose}>
              Back to the lobby
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
