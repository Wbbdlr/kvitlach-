import { useEffect, useRef, useState } from "react";
import { BuyInRequest, RenameRequest } from "../types";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";
import { ChipRequestForm, RenameRequestForm } from "./SelfServiceForms";

export interface RoomInfoDrawerProps {
  open: boolean;
  onClose: () => void;
  roomName?: string;
  roomId: string;
  /** Whether the table has a password set -- the value itself never reaches
   *  the client (server-side pass: it used to, in plain text, in every
   *  room:state broadcast). See the banner below for what that means for
   *  the banker specifically. */
  hasPassword?: boolean;
  buyIn?: number;
  isAdmin: boolean;
  playerId?: string;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  onRequestRename: (firstName: string, lastName?: string) => void;
  onRequestBuyIn: (amount: number, note?: string) => void;
  /** Called with the player's own id for a personal copy, or nothing for the whole table. */
  onExportHistory?: (focusPlayerId?: string) => void;
  completedRounds?: number;
  /**
   * Open with one of the self-service forms already expanded and scrolled to.
   *
   * The two things a player needs from this drawer mid-game -- more chips, and
   * a name that is spelled right -- used to be reachable only by opening a
   * drawer whose only label was the room's NAME, then finding a collapsed
   * "Request..." button inside it. Reported by a tester as things being too
   * nested to work out. The chrome menu now names both actions directly and
   * says which one it wants; the drawer is still where they live, because
   * that is where the forms and the pending-request state already are.
   */
  focus?: "rename" | "chips";
}

// Room name/ID chip -> this drawer, reachable by every seated player (not
// just the banker, unlike ManageDrawer). Everything here already existed in
// the old list UI's lobby card (sharing links, rename/buy-in self-service
// requests) but had no equivalent anywhere in the new table UI -- a player
// who never opens the classic view had no way to reach any of it.
export function RoomInfoDrawer({
  open,
  onClose,
  roomName,
  roomId,
  hasPassword,
  buyIn,
  isAdmin,
  playerId,
  renameRequests,
  buyInRequests,
  onRequestRename,
  onRequestBuyIn,
  onExportHistory,
  completedRounds = 0,
  focus,
}: RoomInfoDrawerProps) {
  const [showRenameForm, setShowRenameForm] = useState(false);
  const [showBuyInForm, setShowBuyInForm] = useState(false);
  const [copied, setCopied] = useState<"id" | "link" | null>(null);
  const [copyFailed, setCopyFailed] = useState<"id" | "link" | null>(null);
  const selfServiceRef = useRef<HTMLDivElement>(null);

  // Keyed on `open` as well as `focus` so asking for the same section twice
  // in a row still expands it -- otherwise reopening the drawer from the same
  // menu row would show it collapsed, which is exactly the dead end this
  // prop exists to remove.
  useEffect(() => {
    if (!open || !focus) return;
    setShowRenameForm(focus === "rename");
    setShowBuyInForm(focus === "chips");
    // The drawer animates in; scrolling on the same frame lands on the
    // pre-animation position.
    const id = window.setTimeout(() => {
      selfServiceRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [open, focus]);

  useEscapeKey(onClose, open);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  if (!open) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteLink = `${origin ? `${origin}/` : ""}?room=${encodeURIComponent(roomId)}`;
  const myRenameRequest = playerId ? renameRequests.find((r) => r.playerId === playerId) : undefined;
  const myBuyInRequest = playerId ? buyInRequests.find((r) => r.playerId === playerId) : undefined;

  // Only claim success once the write actually resolves. This used to set the
  // flag first and never look at the promise, so a rejected write still said
  // "Copied!" over an unchanged clipboard -- and browsers do reject this one
  // routinely, on an unfocused document or a denied permission. Worse, when
  // navigator.clipboard was missing altogether the button did nothing at all
  // and said nothing about it: that is every non-HTTPS origin, which is
  // exactly how this looks when someone opens it over plain http on the LAN.
  // Telling the player to copy it themselves beats a button that quietly
  // does nothing.
  const copy = async (text: string, which: "id" | "link") => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(text);
      setCopyFailed(null);
      setCopied(which);
      setTimeout(() => setCopied((cur) => (cur === which ? null : cur)), 2000);
    } catch {
      setCopied(null);
      setCopyFailed(which);
      setTimeout(() => setCopyFailed((cur) => (cur === which ? null : cur)), 5000);
    }
  };

  return (
    <StageOverlay>
      <div
        className="k-dialog-scrim"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="k-dialog max-w-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold k-dialog-strong min-w-0">
              <Icon name="info" size={16} className="text-sky-300 flex-none" />
              <span className="truncate">{roomName || "Kvitlach table"}</span>
            </div>
            <button type="button" className="k-dialog-sub hover:text-amber-200 flex-none" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border k-dialog-line k-dialog-inset px-3 py-2">
            <div className="text-sm">
              Game ID: <code className="font-semibold">{roomId}</code>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 p-1.5 text-amber-300 shadow-sm transition-colors hover:bg-amber-400/20"
              onClick={() => void copy(roomId, "id")}
              title="Copy game ID"
              aria-label="Copy game ID"
            >
              <Icon name="clipboard" size={14} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border k-dialog-line bg-white/5 px-3 py-1.5 shadow-sm transition-colors hover:bg-white/10"
              onClick={() => void copy(inviteLink, "link")}
            >
              <Icon name="link" size={13} />
              {copied === "link" ? "Copied!" : copyFailed === "link" ? "Copy it manually" : "Copy invite link"}
            </button>
            <a
              className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/12 px-3 py-1.5 shadow-sm transition-colors hover:bg-emerald-500/25"
              href={`https://wa.me/?text=${encodeURIComponent(`Join our Kvitlach game: ${roomName || roomId} (ID: ${roomId}) ${inviteLink}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="share" size={13} className="text-emerald-300" />
              Share via WhatsApp
            </a>
          </div>
          {copied === "id" && <div className="text-xs text-emerald-300 -mt-2">Game ID copied.</div>}
          {copyFailed === "id" && (
            <div className="text-xs text-amber-300 -mt-2">Couldn't copy automatically — select the ID above and copy it.</div>
          )}
          {copyFailed === "link" && (
            <div className="text-xs text-amber-300 -mt-2">Couldn't copy automatically — the invite link is {inviteLink}</div>
          )}

          {typeof buyIn === "number" && (
            <div className="text-xs k-dialog-sub -mt-1">
              Buy-in per player: <span className="font-semibold k-dialog-strong">${buyIn.toLocaleString()}</span>
            </div>
          )}

          {/* Every seated player can take the night home, not just the banker.
              The export lived only in ManageDrawer before, which meant the one
              person running the game was the only one who could keep a record
              of it. Hidden until a round has actually finished -- an empty
              keepsake is worse than no button. */}
          {onExportHistory && completedRounds > 0 && (
            <div className="rounded-lg border k-dialog-line k-dialog-inset px-3 py-2">
              {/* "Keep the game" was the section's own name and reads, on a
                  phone where the heading and the buttons are the only text
                  anyone actually scans, like a save-my-progress feature. What
                  it produces is a written record of the rounds already played
                  -- reported as needing to be described better. */}
              <div className="text-sm font-semibold text-ink">Export game history</div>
              <div className="text-xs k-dialog-sub mt-0.5">
                {completedRounds} round{completedRounds === 1 ? "" : "s"} played so far.
              </div>
              {/* Two buttons named "My results" and "Whole table" say what
                  they contain and nothing about what pressing them DOES --
                  reported as needing to tell people what they are clicking.
                  A download is not a thing anyone wants to find out by
                  trying, least of all mid-game on a phone, so each line says
                  it downloads a file and roughly what is in it. */}
              <div className="mt-2 flex flex-col gap-2.5">
                <div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => onExportHistory(playerId)}
                  >
                    <Icon name="download" size={13} />
                    My results
                  </button>
                  <div className="text-[11px] k-dialog-sub mt-1 leading-snug">
                    Downloads a page written from your seat: what you finished on, round by round.
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border k-dialog-line px-3 py-1.5 text-xs font-semibold k-dialog-strong"
                    onClick={() => onExportHistory()}
                  >
                    <Icon name="download" size={13} />
                    Whole table
                  </button>
                  <div className="text-[11px] k-dialog-sub mt-1 leading-snug">
                    Downloads the same page for everyone at the table, with the final standings.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Banker-only. Used to show the password itself, read out to late
              joiners -- but the server only ever stores a one-way hash of it
              now (security pass: a plaintext room password sat in every
              room:state broadcast to every player, and in every Postgres
              backup, in the clear). There is no value left to copy; a
              banker who needs to share it again has to remember what they
              typed at creation, same as any other password nobody stores
              in reversible form. hasPassword only ever says whether one is
              set, never what it is. */}
          {isAdmin && hasPassword && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/12 px-3 py-2 text-sm text-rose-300">
              <Icon name="info" size={14} />
              <div>This table has a password set. Share the one you chose when you created it.</div>
            </div>
          )}

          {/* Rename/chip requests no longer have a toggle button HERE --
              asked for directly, once ChromeMenu grew its own dedicated
              "Change name" / "Request chips" entries (see `focus` above,
              which those set): a second, generically-labelled way to reach
              the exact same form was the "too nested to work out" complaint
              this file's own header comment already describes, just not
              fully retired when the first fix landed. Opening this drawer
              from THOSE buttons still lands here and still shows the right
              form -- showRenameForm/showBuyInForm are driven entirely by
              the focus effect above now, with nothing left in the generic
              view to set them by hand. A standing pending-request notice
              stays regardless of how the form was reached: someone who
              already asked should see that they did, not go hunting for a
              button that no longer exists to confirm it. */}
          {!isAdmin && (
            <>
              {(showRenameForm || myRenameRequest) && (
                <div ref={selfServiceRef} className="border-t k-dialog-line pt-3 flex flex-col gap-2">
                  {showRenameForm ? (
                    <RenameRequestForm
                      pending={myRenameRequest}
                      onSubmit={onRequestRename}
                      onDone={() => setShowRenameForm(false)}
                    />
                  ) : (
                    myRenameRequest && (
                      <div className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
                        Pending banker approval for {myRenameRequest.firstName}
                        {myRenameRequest.lastName ? ` ${myRenameRequest.lastName}` : ""}.
                      </div>
                    )
                  )}
                </div>
              )}

              {(showBuyInForm || myBuyInRequest) && (
                <div className="border-t border-dashed k-dialog-line pt-3 flex flex-col gap-2">
                  {showBuyInForm ? (
                    <ChipRequestForm
                      pending={myBuyInRequest}
                      onSubmit={onRequestBuyIn}
                      onDone={() => setShowBuyInForm(false)}
                    />
                  ) : (
                    myBuyInRequest && (
                      <div className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
                        Pending banker approval for ${myBuyInRequest.amount}
                        {myBuyInRequest.note ? ` · "${myBuyInRequest.note}"` : ""}.
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </StageOverlay>
  );
}
