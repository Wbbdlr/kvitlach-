import { BuyInRequest, RenameRequest } from "../types";
import { Icon, IconName } from "./icons";
import { StageOverlay } from "./StageOverlay";
import { useEscapeKey } from "../useEscapeKey";
import { useDialogFocus } from "../useDialogFocus";
import { ChipRequestForm, RenameRequestForm } from "./SelfServiceForms";

export type QuickRequestKind = "chips" | "rename";

export interface QuickRequestDialogProps {
  kind?: QuickRequestKind;
  onClose: () => void;
  renameRequest?: RenameRequest;
  buyInRequest?: BuyInRequest;
  onRequestRename: (firstName: string, lastName?: string) => void;
  onRequestBuyIn: (amount: number, note?: string) => void;
}

// One purpose, one small menu.
//
// "Ask for chips" and "Change my name" used to open the whole Table Info
// drawer with the right section pre-expanded and scrolled to. That was an
// improvement on what came before it -- the forms had been reachable only by
// opening a drawer labelled with the room's NAME and hunting -- but it still
// answered a one-line question by putting the room's ID, invite link,
// password, share buttons and export controls on screen first. Reported as
// the buttons taking you to the table settings menu rather than doing the
// thing they name.
//
// The forms themselves are shared with that drawer (SelfServiceForms.tsx),
// which is still where they belong when you are already looking at the room's
// details. This is the direct route, not a second copy of them.
const COPY: Record<QuickRequestKind, { icon: IconName; title: string; blurb: string }> = {
  chips: {
    icon: "coins-plus",
    title: "Ask for chips",
    blurb: "The banker has to approve this. You can keep playing while it is pending.",
  },
  rename: {
    icon: "user-pencil",
    title: "Change my name",
    blurb: "The banker has to approve this. Your name at the table changes once they do.",
  },
};

export function QuickRequestDialog({
  kind,
  onClose,
  renameRequest,
  buyInRequest,
  onRequestRename,
  onRequestBuyIn,
}: QuickRequestDialogProps) {
  useEscapeKey(onClose, Boolean(kind));
  const dialogRef = useDialogFocus<HTMLDivElement>(Boolean(kind));

  if (!kind) return null;
  const copy = COPY[kind];

  return (
    <StageOverlay>
      <div className="k-dialog-scrim" ref={dialogRef} role="dialog" aria-modal="true" onClick={onClose}>
        <div className="k-dialog max-w-xs" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-base font-semibold k-dialog-strong min-w-0">
              <Icon name={copy.icon} size={16} className="text-amber-300 flex-none" />
              <span className="truncate">{copy.title}</span>
            </div>
            <button
              type="button"
              className="k-dialog-sub hover:text-amber-200 flex-none"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="close" size={15} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs k-dialog-sub">{copy.blurb}</p>
            {/* autoFocus on the first field: this dialog exists to be typed
                into, and it was opened by a button that says so. The drawer's
                copies do not take it -- there the form is one section among
                several and stealing focus would scroll the room's own details
                out from under someone who came to copy the invite link. */}
            {kind === "chips" ? (
              <ChipRequestForm autoFocus pending={buyInRequest} onSubmit={onRequestBuyIn} onDone={onClose} />
            ) : (
              <RenameRequestForm autoFocus pending={renameRequest} onSubmit={onRequestRename} onDone={onClose} />
            )}
          </div>
        </div>
      </div>
    </StageOverlay>
  );
}
