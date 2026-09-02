import { useState } from "react";
import { BuyInRequest, RenameRequest } from "../types";

// The two things a seated player can ask the banker for: a spelling fix on
// their name, and more chips. Both need banker approval, so both are a form
// plus a "pending" state rather than a direct action.
//
// They live here rather than inside RoomInfoDrawer because they are now
// reachable from two places: that drawer (where they have always been, next
// to the room's own details) and a one-purpose menu opened straight from the
// chrome (QuickRequestDialog). A second copy of a form is how two copies
// drift -- the same reason AppearanceMenu is one component and not a row
// duplicated per switcher.
//
// Deliberately just the form. The heading, the framing and the dismiss belong
// to whoever is hosting it, because those differ: in the drawer this is one
// section among several and gets a divider; in the quick menu it IS the
// dialog and gets a title.

export interface PendingNoticeProps {
  children: React.ReactNode;
}

function Pending({ children }: PendingNoticeProps) {
  return (
    <div className="text-xs text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
      {children}
    </div>
  );
}

export interface RenameRequestFormProps {
  pending?: RenameRequest;
  onSubmit: (firstName: string, lastName?: string) => void;
  /** Called after a successful submit, so a host that is a dialog can close. */
  onDone?: () => void;
  autoFocus?: boolean;
}

export function RenameRequestForm({ pending, onSubmit, onDone, autoFocus }: RenameRequestFormProps) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  return (
    <>
      {pending && (
        <Pending>
          Pending banker approval for {pending.firstName}
          {pending.lastName ? ` ${pending.lastName}` : ""}.
        </Pending>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(first, last || undefined);
          setFirst("");
          setLast("");
          onDone?.();
        }}
      >
        <div className="flex flex-col gap-2">
          <label className="text-xs">
            First name (required)
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              required
              autoFocus={autoFocus}
              autoComplete="given-name"
              autoCapitalize="words"
            />
          </label>
          <label className="text-xs">
            Last name (optional)
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              autoComplete="family-name"
              autoCapitalize="words"
            />
          </label>
        </div>
        <button type="submit" className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold">
          Submit rename request
        </button>
      </form>
    </>
  );
}

export interface ChipRequestFormProps {
  pending?: BuyInRequest;
  onSubmit: (amount: number, note?: string) => void;
  onDone?: () => void;
  autoFocus?: boolean;
}

export function ChipRequestForm({ pending, onSubmit, onDone, autoFocus }: ChipRequestFormProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <>
      {pending && (
        <Pending>
          Pending banker approval for ${pending.amount}
          {pending.note ? ` · "${pending.note}"` : ""}.
        </Pending>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = Number(amount);
          // Silently ignored rather than reported: `required` and min=1 keep
          // the browser from submitting anything else, so reaching here with
          // a bad value means the field was bypassed, not mistyped.
          if (!Number.isFinite(parsed) || parsed <= 0) return;
          onSubmit(parsed, note || undefined);
          setAmount("");
          setNote("");
          onDone?.();
        }}
      >
        <div className="flex flex-col gap-2">
          <label className="text-xs">
            Amount (required)
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus={autoFocus}
            />
          </label>
          <label className="text-xs">
            Note (optional)
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Lost last round"
            />
          </label>
        </div>
        <button type="submit" className="bg-accent text-white rounded px-3 py-2 text-sm font-semibold">
          Submit chip request
        </button>
      </form>
    </>
  );
}
