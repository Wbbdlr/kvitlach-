import { describe, expect, it } from "vitest";
import { GameStore } from "../store.js";

// The single most damaging defect the product review found, reproduced live:
// Rivka had $75, tapped Leave, rejoined with the same name, and the table
// showed TWO "Rivka S" rows -- the old seat holding $75 and unreachable, the
// new one handed a fresh $100. One tap invented $100 and orphaned $75, and
// the banker's only tools were Kick (destroys the $75) or Adjust (fabricates
// more). Reload-and-resume was always fine; it is Leave that drops the
// session token, after which nothing could recognise a returning player.
function table() {
  const store = new GameStore();
  const { room, player: admin } = store.createRoom({ firstName: "Banker", buyIn: 100, bankerBankroll: 400 });
  const rivka = store.joinRoom(room.roomId, { firstName: "Rivka", lastName: "S" });
  return { store, roomId: room.roomId, adminId: admin.id, rivka: rivka.player };
}

function goOffline(store: GameStore, roomId: string, playerId: string) {
  store.setPresence(roomId, playerId, "offline");
}

describe("claiming a seat back", () => {
  it("refuses a plain rejoin under a name already at the table", () => {
    const { store, roomId, rivka } = table();
    goOffline(store, roomId, rivka.id);
    expect(() => store.joinRoom(roomId, { firstName: "Rivka", lastName: "S" })).toThrow("seat_claimable");
    // Nothing was created by the refusal -- no second seat, no second wallet.
    expect(store.getRoom(roomId)!.players.filter((p) => p.type === "player")).toHaveLength(1);
  });

  it("returns the ORIGINAL seat and its chips, not a fresh buy-in", () => {
    const { store, roomId, adminId, rivka } = table();
    store.getRoom(roomId)!.wallets[rivka.id] = 75;
    goOffline(store, roomId, rivka.id);

    const { claim, wallet } = store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" });
    expect(wallet).toBe(75);

    const approved = store.approveSeatClaim(roomId, adminId, claim.id);
    expect(approved.player.id).toBe(rivka.id);
    const room = store.getRoom(roomId)!;
    expect(room.wallets[rivka.id]).toBe(75);
    expect(room.players.filter((p) => p.type === "player")).toHaveLength(1);
    expect(room.players.find((p) => p.id === rivka.id)!.presence).toBe("online");
    expect(room.seatClaims ?? []).toHaveLength(0);
  });

  it("matches a name the way a person would, not byte for byte", () => {
    const { store, roomId, rivka } = table();
    goOffline(store, roomId, rivka.id);
    expect(store.findClaimableSeat(roomId, "  rivka ", "s")?.id).toBe(rivka.id);
  });

  // The other half of the same coin. Handing a stack to whoever typed the
  // name second is the original bug in the opposite direction.
  it("will not claim a seat whose player is still connected", () => {
    const { store, roomId } = table();
    expect(store.findClaimableSeat(roomId, "Rivka", "S")).toBeUndefined();
    expect(() => store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" })).toThrow("no_seat_to_claim");
  });

  // This is a family game. Three cousins called Rivka is the NORMAL case, not
  // an edge case, and a table that will not seat them is broken in a worse
  // way than one that seats them confusingly. So a name is never refused
  // while its owner is still connected -- it is made unambiguous instead.
  it("seats a second Rivka without asking anybody anything", () => {
    const { store, roomId } = table();
    const second = store.joinRoom(roomId, { firstName: "Rivka", lastName: "S" });
    expect(second.player.nameTag).toBe(2);
    expect(store.getRoom(roomId)!.players.filter((p) => p.type === "player")).toHaveLength(2);
  });

  it("leaves the first one untagged and counts up from there", () => {
    const { store, roomId, rivka } = table();
    const second = store.joinRoom(roomId, { firstName: "Rivka", lastName: "S" });
    const third = store.joinRoom(roomId, { firstName: "rivka", lastName: " s " });
    expect(store.getRoom(roomId)!.players.find((p) => p.id === rivka.id)!.nameTag).toBeUndefined();
    expect(second.player.nameTag).toBe(2);
    expect(third.player.nameTag).toBe(3);
  });

  // A number handed back when a seat leaves, rather than climbing all night.
  it("reuses the lowest free number after somebody leaves", () => {
    const { store, roomId, adminId } = table();
    const second = store.joinRoom(roomId, { firstName: "Rivka", lastName: "S" });
    store.joinRoom(roomId, { firstName: "Rivka", lastName: "S" });
    store.kickPlayer(roomId, adminId, second.player.id);
    const replacement = store.joinRoom(roomId, { firstName: "Rivka", lastName: "S" });
    expect(replacement.player.nameTag).toBe(2);
  });

  it("does not tag a name nobody else is using", () => {
    const { store, roomId } = table();
    expect(store.joinRoom(roomId, { firstName: "Moshe" }).player.nameTag).toBeUndefined();
  });

  // Different surnames already tell two Rivkas apart, so there is nothing to
  // disambiguate and no tag should appear.
  it("does not tag two people who share only a first name", () => {
    const { store, roomId } = table();
    expect(store.joinRoom(roomId, { firstName: "Rivka", lastName: "B" }).player.nameTag).toBeUndefined();
  });

  // The claim prompt is a fork in the road, not a wall: the other branch is
  // "I am a different Rivka", which comes back through here.
  it("lets a different person of the same name past the claim prompt", () => {
    const { store, roomId, rivka } = table();
    goOffline(store, roomId, rivka.id);
    const second = store.joinRoom(roomId, { firstName: "Rivka", lastName: "S", allowDuplicateName: true });
    expect(second.player.id).not.toBe(rivka.id);
    expect(second.player.nameTag).toBe(2);
    expect(store.getRoom(roomId)!.players.filter((p) => p.type === "player")).toHaveLength(2);
  });

  it("never blocks a spectator, who takes no seat and no chips", () => {
    const { store, roomId } = table();
    const watcher = store.joinRoom(roomId, { firstName: "Rivka", lastName: "S", spectator: true });
    expect(watcher.player.type).toBe("spectator");
  });

  // Server authority: the banker is the check, so only the banker can be it.
  it("refuses approval and rejection from anyone but the banker", () => {
    const { store, roomId, rivka } = table();
    goOffline(store, roomId, rivka.id);
    const { claim } = store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" });
    expect(() => store.approveSeatClaim(roomId, rivka.id, claim.id)).toThrow("forbidden");
    expect(() => store.rejectSeatClaim(roomId, rivka.id, claim.id)).toThrow("forbidden");
    expect(store.getRoom(roomId)!.seatClaims).toHaveLength(1);
  });

  // A claim is a way INTO a room, so it must not be a way around its door.
  it("applies the room password to a claim, same as a join", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", buyIn: 100, password: "latkes" });
    const rivka = store.joinRoom(room.roomId, { firstName: "Rivka", password: "latkes" });
    store.setPresence(room.roomId, rivka.player.id, "offline");
    expect(() => store.requestSeatClaim(room.roomId, { firstName: "Rivka" })).toThrow("invalid_password");
    expect(() => store.requestSeatClaim(room.roomId, { firstName: "Rivka", password: "wrong" })).toThrow(
      "invalid_password"
    );
    expect(store.requestSeatClaim(room.roomId, { firstName: "Rivka", password: "latkes" }).claim).toBeTruthy();
  });

  it("does not stack duplicate claims on one seat", () => {
    const { store, roomId, rivka } = table();
    goOffline(store, roomId, rivka.id);
    store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" });
    expect(() => store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" })).toThrow("seat_claim_pending");
    expect(store.getRoom(roomId)!.seatClaims).toHaveLength(1);
  });

  // The seat can be gone by the time the banker taps approve.
  it("drops a claim whose seat was kicked rather than issuing a session for it", () => {
    const { store, roomId, adminId, rivka } = table();
    goOffline(store, roomId, rivka.id);
    const { claim } = store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" });
    store.kickPlayer(roomId, adminId, rivka.id);
    expect(() => store.approveSeatClaim(roomId, adminId, claim.id)).toThrow("request_not_found");
    expect(store.getRoom(roomId)!.seatClaims ?? []).toHaveLength(0);
  });

  it("clears a rejected claim without touching the seat", () => {
    const { store, roomId, adminId, rivka } = table();
    store.getRoom(roomId)!.wallets[rivka.id] = 75;
    goOffline(store, roomId, rivka.id);
    const { claim } = store.requestSeatClaim(roomId, { firstName: "Rivka", lastName: "S" });
    store.rejectSeatClaim(roomId, adminId, claim.id);
    expect(store.getRoom(roomId)!.seatClaims ?? []).toHaveLength(0);
    expect(store.getRoom(roomId)!.wallets[rivka.id]).toBe(75);
  });
});
