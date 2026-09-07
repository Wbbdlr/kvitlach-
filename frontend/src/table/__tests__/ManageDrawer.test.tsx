import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StandingRow } from "../../playerRecord";
import { LedgerEntry } from "../../types";
import { ManageDrawer } from "../ManageDrawer";
import { setNumberField } from "../../testing/numberField";

// The reshuffle control used to be disabled ("Only available between
// rounds") with a server that silently reshuffled on its own whenever the
// carried-over deck ran low, mid-hand or not. Now the dealer is the only one
// who ever brings in a new shoe (see round.ts's createRound/drawCard both
// refusing rather than reshuffling), so the button must always be usable --
// these pin that it's live either way, and that the warning actually
// changes to reflect what reshuffling mid-hand really does.
function renderDrawer(overrides: { roundActive?: boolean; onReshuffleDeck?: () => void; standings?: StandingRow[]; ledger?: LedgerEntry[]; onTopUp?: (amount: number, note?: string) => void } = {}) {
  const onReshuffleDeck = overrides.onReshuffleDeck ?? vi.fn();
  const onTopUp = overrides.onTopUp ?? vi.fn();
  render(
    <ManageDrawer
      open={true}
      onClose={vi.fn()}
      players={[]}
      wallets={{}}
      renameRequests={[]}
      buyInRequests={[]}
      roundHistoryCount={0}
      bankerWallet={500}
      onTopUp={onTopUp}
      onSetWatermark={vi.fn()}
      onApproveRename={vi.fn()}
      onRejectRename={vi.fn()}
      onApproveBuyIn={vi.fn()}
      onRejectBuyIn={vi.fn()}
      onAdjustChips={vi.fn()}
      onKick={vi.fn()}
      onExportHistory={vi.fn()}
      onCloseRoom={vi.fn()}
      roundActive={overrides.roundActive ?? false}
      onReshuffleDeck={onReshuffleDeck}
      standings={overrides.standings}
      ledger={overrides.ledger}
    />
  );
  return { onReshuffleDeck, onTopUp };
}

// The bank amount field arrived pre-filled with 500, sitting next to "+ Add"
// and "Apply to bank" -- two taps and $500 nobody decided on is in the bank.
// Nothing else in this drawer is pre-filled. A default that is also the most
// damaging value is the wrong default, and typing the number is the whole
// confirmation this action gets.
describe("the bank top-up amount", () => {
  function topUpField() {
    return screen.getByPlaceholderText("Amount") as HTMLInputElement;
  }

  it("starts empty rather than pre-loaded with 500", () => {
    renderDrawer();
    expect(topUpField().value).toBe("");
  });

  // Found bug-hunting 11.6, and introduced by 11.5's own fix: this field used
  // to arrive pre-filled with 500, so "apply an empty amount" was not a state
  // it could be in. Emptying it (correctly -- a default that is also the most
  // damaging value is the wrong default) made the silent return below
  // reachable by the ordinary route, and a banker who taps Apply and sees
  // nothing has no way to tell a no-op from a failure.
  it("says why an empty top-up went nowhere instead of silently dropping it", () => {
    const onTopUp = vi.fn();
    renderDrawer({ onTopUp });
    fireEvent.click(screen.getByText(/Apply to bank/i));
    expect(onTopUp).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter an amount/i)).toBeInTheDocument();
  });

  it("stops complaining once a real amount is applied", () => {
    const onTopUp = vi.fn();
    renderDrawer({ onTopUp });
    fireEvent.click(screen.getByText(/Apply to bank/i));
    setNumberField("Bank amount", "250");
    fireEvent.click(screen.getByText(/Apply to bank/i));
    expect(onTopUp).toHaveBeenCalledWith(250, undefined);
    expect(screen.queryByText(/Enter an amount/i)).toBeNull();
  });

  it("still applies an amount the banker actually typed", () => {
    const onTopUp = vi.fn();
    renderDrawer({ onTopUp });
    setNumberField("Bank amount", "250");
    fireEvent.click(screen.getByText(/Apply to bank/i));
    expect(onTopUp).toHaveBeenCalledWith(250, undefined);
  });

  it("empties the field again after a top-up, not back to 500", () => {
    renderDrawer();
    setNumberField("Bank amount", "250");
    fireEvent.click(screen.getByText(/Apply to bank/i));
    expect(topUpField().value).toBe("");
  });
});

describe("ManageDrawer reshuffle control -- the dealer's own choice", () => {
  it("is enabled between rounds, same as before", () => {
    renderDrawer({ roundActive: false });
    const button = screen.getByRole("button", { name: "Reshuffle deck" });
    expect(button).not.toBeDisabled();
  });

  it("is ALSO enabled mid-round -- reshuffling is no longer blocked while a hand is live", () => {
    renderDrawer({ roundActive: true });
    const button = screen.getByRole("button", { name: "Reshuffle deck" });
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/only available between rounds/i)).toBeNull();
  });

  it("warns about the live hand specifically when confirming mid-round", () => {
    renderDrawer({ roundActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    expect(screen.getByText(/hand is in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/cards already dealt stay exactly as they are/i)).toBeInTheDocument();
  });

  it("uses the plain between-round wording when no hand is live", () => {
    renderDrawer({ roundActive: false });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    expect(screen.getByText(/shuffle a fresh shoe in before the next round/i)).toBeInTheDocument();
    expect(screen.queryByText(/hand is in progress/i)).toBeNull();
  });

  it("only actually reshuffles after the confirm step, not on the first click", () => {
    const { onReshuffleDeck } = renderDrawer({ roundActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    expect(onReshuffleDeck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reshuffle" }));
    expect(onReshuffleDeck).toHaveBeenCalledTimes(1);
  });

  it("cancel backs out without reshuffling", () => {
    const { onReshuffleDeck } = renderDrawer({ roundActive: true });
    fireEvent.click(screen.getByRole("button", { name: "Reshuffle deck" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReshuffleDeck).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reshuffle deck" })).toBeInTheDocument();
  });
});

// The banker's end of the two self-service queues. QuickRequestDialog and the
// drawer's own forms put a request into room.buyInRequests/renameRequests;
// this block is the only place those are ever rendered, and its Approve/Reject
// buttons are the only way they leave. Worth pinning as one path: a form that
// files a request nobody can act on is the same failure as a form that never
// files one.
const sara = { id: "p2", firstName: "Sara", lastName: "K", type: "player" as const, presence: "online" as const };

function renderWithRequests(over: Partial<React.ComponentProps<typeof ManageDrawer>> = {}) {
  const handlers = {
    onApproveBuyIn: vi.fn(),
    onRejectBuyIn: vi.fn(),
    onApproveRename: vi.fn(),
    onRejectRename: vi.fn(),
  };
  render(
    <ManageDrawer
      open
      onClose={vi.fn()}
      players={[sara]}
      wallets={{ p2: 100 }}
      renameRequests={[]}
      buyInRequests={[]}
      roundHistoryCount={0}
      bankerWallet={500}
      onTopUp={vi.fn()}
      onSetWatermark={vi.fn()}
      onAdjustChips={vi.fn()}
      onKick={vi.fn()}
      onExportHistory={vi.fn()}
      onCloseRoom={vi.fn()}
      roundActive={false}
      onReshuffleDeck={vi.fn()}
      {...handlers}
      {...over}
    />
  );
  return handlers;
}

describe("the banker's approvals queue", () => {
  it("shows nothing at all when nobody has asked for anything", () => {
    renderWithRequests();
    expect(screen.queryByText(/approvals needed/i)).not.toBeInTheDocument();
  });

  it("names the player, the amount and the note, and counts both queues together", () => {
    renderWithRequests({
      buyInRequests: [{ playerId: "p2", amount: 250, requestedAt: 1, note: "Lost last round" }],
      renameRequests: [{ playerId: "p2", firstName: "Sarah", lastName: "K", requestedAt: 1 }],
    });
    expect(screen.getByText("Approvals needed (2)")).toBeInTheDocument();
    expect(screen.getByText(/\$250 · "Lost last round"/)).toBeInTheDocument();
    expect(screen.getByText(/Sarah K/)).toBeInTheDocument();
  });

  it("hands the right player id to each of the four actions", () => {
    const h = renderWithRequests({
      buyInRequests: [{ playerId: "p2", amount: 250, requestedAt: 1 }],
    });
    const [approve, reject] = screen.getAllByRole("button", { name: /approve|reject/i });
    fireEvent.click(approve);
    expect(h.onApproveBuyIn).toHaveBeenCalledWith("p2");
    fireEvent.click(reject);
    expect(h.onRejectBuyIn).toHaveBeenCalledWith("p2");
  });

  it("routes a rename's buttons to the rename handlers, not the chip ones", () => {
    const h = renderWithRequests({
      renameRequests: [{ playerId: "p2", firstName: "Sarah", requestedAt: 1 }],
    });
    const [approve, reject] = screen.getAllByRole("button", { name: /approve|reject/i });
    fireEvent.click(approve);
    fireEvent.click(reject);
    expect(h.onApproveRename).toHaveBeenCalledWith("p2");
    expect(h.onRejectRename).toHaveBeenCalledWith("p2");
    expect(h.onApproveBuyIn).not.toHaveBeenCalled();
    expect(h.onRejectBuyIn).not.toHaveBeenCalled();
  });
});


describe("tonight's standings", () => {
  // The banker's usual end-of-night question is "who owes what", and it should
  // not need a downloaded file to answer. Everything is shown -- the table's
  // own decision, asked and answered: "you can let the banker see everything."
  const row = (over: Partial<StandingRow> & { playerId: string; name: string }): StandingRow => ({
    isBanker: false,
    rounds: 3,
    wins: 0,
    losses: 0,
    net: 0,
    adjustments: 0,
    settle: 0,
    ...over,
  });
  const standings = [
    row({ playerId: "bk", name: "The Gabbai", isBanker: true, wins: 1, losses: 2, net: -14, settle: -14 }),
    row({ playerId: "p1", name: "Shaya", wins: 2, losses: 1, net: 9, settle: 9 }),
    row({ playerId: "p2", name: "Rivky", wins: 1, losses: 2, net: -5, settle: -5 }),
  ];

  it("lists every seat with its record and net", () => {
    renderDrawer({ standings });
    expect(screen.getByText("Tonight so far")).toBeInTheDocument();
    expect(screen.getByText("The Gabbai")).toBeInTheDocument();
    expect(screen.getByText("+$9")).toBeInTheDocument();
    expect(screen.getByText("-$14")).toBeInTheDocument();
    expect(screen.getByText("2W / 1L")).toBeInTheDocument();
  });

  // The bug this column exists for: the banker adjusted Sara +$50 and the
  // standings went on reporting her play net as if nothing had happened, so
  // the number they settle up from was short by exactly the correction.
  it("shows chips moved by hand beside the play result, and settles on the sum", () => {
    renderDrawer({
      standings: [row({ playerId: "p1", name: "Shaya", wins: 0, losses: 1, net: -10, adjustments: 50, settle: 40 })],
    });
    expect(screen.getByText("+$50 by hand")).toBeInTheDocument();
    expect(screen.getByText("+$40")).toBeInTheDocument();
    // The play result is still stated, because "he is +$40" is one number
    // nobody can check.
    expect(screen.getByText(/the cards alone would say Shaya -\$10/i)).toBeInTheDocument();
  });

  it("says nothing about hand-moved chips when none moved", () => {
    renderDrawer({ standings });
    expect(screen.queryByText(/by hand/)).not.toBeInTheDocument();
  });

  it("lists what the banker actually did, so a mistake is diagnosable later", () => {
    renderDrawer({
      standings,
      ledger: [
        {
          id: "l1",
          kind: "adjust",
          playerId: "p1",
          playerName: "Shaya",
          actorId: "bk",
          actorName: "The Gabbai",
          amount: 50,
          note: "miscounted round 3",
          at: 1,
        },
      ],
    });
    expect(screen.getByText("Chips moved by hand")).toBeInTheDocument();
    expect(screen.getByText(/banker adjusted/)).toBeInTheDocument();
    expect(screen.getByText(/miscounted round 3/)).toBeInTheDocument();
  });

  it("shows nothing at all before a round has finished", () => {
    // Not an empty table with zeroes in it -- there is genuinely nothing to
    // say yet, and a row of dashes reads like a bug.
    renderDrawer();
    expect(screen.queryByText("Tonight so far")).not.toBeInTheDocument();
  });
});
