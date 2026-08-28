import { useState } from "react";
import { BuyInRequest, RenameRequest } from "../types";
import { Icon } from "./icons";
import { StageOverlay } from "./StageOverlay";

export interface RoomInfoDrawerProps {
  open: boolean;
  onClose: () => void;
  roomName?: string;
  roomId: string;
  roomPassword?: string;
  buyIn?: number;
  isAdmin: boolean;
  playerId?: string;
  renameRequests: RenameRequest[];
  buyInRequests: BuyInRequest[];
  onRequestRename: (firstName: string, lastName?: string) => void;
  onRequestBuyIn: (amount: number, note?: string) => void;
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
  roomPassword,
  buyIn,
  isAdmin,
  playerId,
  renameRequests,
  buyInRequests,
  onRequestRename,
  onRequestBuyIn,
}: RoomInfoDrawerProps) {
  const [showRenameForm, setShowRenameForm] = useState(false);
  const [renameFirst, setRenameFirst] = useState("");
  const [renameLast, setRenameLast] = useState("");
  const [showBuyInForm, setShowBuyInForm] = useState(false);
  const [buyInAmount, setBuyInAmount] = useState("");
  const [buyInNote, setBuyInNote] = useState("");
  const [copied, setCopied] = useState<"id" | "link" | "password" | null>(null);
  const [copyFailed, setCopyFailed] = useState<"id" | "link" | "password" | null>(null);

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
  const copy = async (text: string, which: "id" | "link" | "password") => {
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-3"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-4 flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold text-slate-800 min-w-0">
              <Icon name="info" size={16} className="text-blue-600 flex-none" />
              <span className="truncate">{roomName || "Kvitlach table"}</span>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-600 flex-none" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-sm">
              Game ID: <code className="font-semibold">{roomId}</code>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-amber-300 bg-amber-50 p-1.5 text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
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
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 shadow-sm transition-colors hover:bg-slate-50"
              onClick={() => void copy(inviteLink, "link")}
            >
              <Icon name="link" size={13} />
              {copied === "link" ? "Copied!" : copyFailed === "link" ? "Copy it manually" : "Copy invite link"}
            </button>
            <a
              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 shadow-sm transition-colors hover:bg-emerald-100"
              href={`https://wa.me/?text=${encodeURIComponent(`Join our Kvitlach game: ${roomName || roomId} (ID: ${roomId}) ${inviteLink}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="share" size={13} className="text-emerald-600" />
              Share via WhatsApp
            </a>
          </div>
          {copied === "id" && <div className="text-xs text-emerald-700 -mt-2">Game ID copied.</div>}
          {copyFailed === "id" && (
            <div className="text-xs text-amber-700 -mt-2">Couldn't copy automatically — select the ID above and copy it.</div>
          )}
          {copyFailed === "link" && (
            <div className="text-xs text-amber-700 -mt-2">Couldn't copy automatically — the invite link is {inviteLink}</div>
          )}

          {typeof buyIn === "number" && (
            <div className="text-xs text-slate-500 -mt-1">
              Buy-in per player: <span className="font-semibold text-slate-700">${buyIn.toLocaleString()}</span>
            </div>
          )}

          {/* Banker-only: the password is what they read out to late joiners,
              so it has to live somewhere reachable from the table itself. */}
          {isAdmin && roomPassword && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <div>
                Password: <code className="font-semibold">{roomPassword}</code>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white p-1.5 text-rose-700 shadow-sm transition-colors hover:bg-rose-100"
                onClick={() => void copy(roomPassword, "password")}
                title="Copy room password"
                aria-label="Copy room password"
              >
                <Icon name="clipboard" size={14} />
              </button>
            </div>
          )}
          {copied === "password" && <div className="text-xs text-emerald-700 -mt-2">Password copied.</div>}
          {copyFailed === "password" && (
            <div className="text-xs text-amber-700 -mt-2">Couldn't copy automatically — select the password and copy it.</div>
          )}

          {!isAdmin && (
            <>
              <div className="border-t border-slate-200 pt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Banker approval required for name changes.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-accent text-accent px-3 py-1 text-[11px] font-semibold transition-colors hover:bg-accent hover:text-white flex-none"
                    onClick={() => setShowRenameForm((prev) => !prev)}
                  >
                    {showRenameForm ? "Hide" : "Request name change"}
                  </button>
                </div>
                {myRenameRequest && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Pending banker approval for {myRenameRequest.firstName}
                    {myRenameRequest.lastName ? ` ${myRenameRequest.lastName}` : ""}.
                  </div>
                )}
                {showRenameForm && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onRequestRename(renameFirst, renameLast || undefined);
                      setRenameFirst("");
                      setRenameLast("");
                      setShowRenameForm(false);
                    }}
                  >
                    <div className="flex flex-col gap-2">
                      <label className="text-xs">
                        First name (required)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          value={renameFirst}
                          onChange={(e) => setRenameFirst(e.target.value)}
                          required
                          autoComplete="given-name"
                          autoCapitalize="words"
                        />
                      </label>
                      <label className="text-xs">
                        Last name (optional)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          value={renameLast}
                          onChange={(e) => setRenameLast(e.target.value)}
                          autoComplete="family-name"
                          autoCapitalize="words"
                        />
                      </label>
                    </div>
                    <button type="submit" className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold">
                      Submit rename request
                    </button>
                  </form>
                )}
              </div>

              <div className="border-t border-dashed border-slate-200 pt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Need more chips? Ask the Banker for a top-up.</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-accent text-accent px-3 py-1 text-[11px] font-semibold transition-colors hover:bg-accent hover:text-white flex-none"
                    onClick={() => setShowBuyInForm((prev) => !prev)}
                  >
                    {showBuyInForm ? "Hide" : "Request more chips"}
                  </button>
                </div>
                {myBuyInRequest && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    Pending banker approval for ${myBuyInRequest.amount}
                    {myBuyInRequest.note ? ` · "${myBuyInRequest.note}"` : ""}.
                  </div>
                )}
                {showBuyInForm && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const parsed = Number(buyInAmount);
                      if (!Number.isFinite(parsed) || parsed <= 0) return;
                      onRequestBuyIn(parsed, buyInNote || undefined);
                      setBuyInAmount("");
                      setBuyInNote("");
                      setShowBuyInForm(false);
                    }}
                  >
                    <div className="flex flex-col gap-2">
                      <label className="text-xs">
                        Amount (required)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          type="number"
                          min={1}
                          value={buyInAmount}
                          onChange={(e) => setBuyInAmount(e.target.value)}
                          required
                        />
                      </label>
                      <label className="text-xs">
                        Note (optional)
                        <input
                          className="mt-1 w-full rounded border px-3 py-2"
                          value={buyInNote}
                          onChange={(e) => setBuyInNote(e.target.value)}
                          placeholder="e.g. Lost last round"
                        />
                      </label>
                    </div>
                    <button type="submit" className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold">
                      Submit chip request
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </StageOverlay>
  );
}
