import { describe, it, expect } from "vitest";
import { GameStore } from "../store.js";

// Regression coverage for a real finding from a security pass: a room's
// password was stored and compared in plain text (`roomRec.room.password !==
// info.password`). Every Postgres backup of a password-protected room
// carried it in the clear, and the comparison itself was not constant-time.
// Fixed by routing it through admin-auth.ts's own hashPassword/verifyPassword
// (scrypt, same as the admin panel's credential) -- reused rather than
// reinvented, since it already does exactly this.

describe("room passwords are hashed, not stored or compared in plain text", () => {
  it("never stores the room password itself -- only a scrypt hash of it", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", password: "farbrengen" });
    const stored = store.getRoom(room.roomId)!;

    expect((stored as any).password).toBeUndefined();
    expect(stored.passwordHash).toBeDefined();
    expect(stored.passwordHash).not.toBe("farbrengen");
    // admin-auth.ts's own format -- see hashPassword.
    expect(stored.passwordHash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it("lets a joiner in with the correct password", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", password: "farbrengen" });
    expect(() => store.joinRoom(room.roomId, { firstName: "Player", password: "farbrengen" })).not.toThrow();
  });

  it("refuses the wrong password", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", password: "farbrengen" });
    expect(() => store.joinRoom(room.roomId, { firstName: "Player", password: "wrong" })).toThrow(
      "invalid_password",
    );
  });

  it("refuses a missing password on a protected room, rather than crashing on the hash compare", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker", password: "farbrengen" });
    expect(() => store.joinRoom(room.roomId, { firstName: "Player" })).toThrow("invalid_password");
  });

  it("leaves an unprotected room's join unaffected -- no password set, none required", () => {
    const store = new GameStore();
    const { room } = store.createRoom({ firstName: "Banker" });
    expect(store.getRoom(room.roomId)!.passwordHash).toBeUndefined();
    expect(() => store.joinRoom(room.roomId, { firstName: "Player" })).not.toThrow();
  });

  it("reports hasPassword to the admin summary from the hash, not a plaintext field", () => {
    const store = new GameStore();
    store.createRoom({ firstName: "Banker", password: "farbrengen" });
    store.createRoom({ firstName: "Banker2" });
    const rooms = store.listRoomsForAdmin();
    expect(rooms.find((r) => r.hasPassword)).toBeDefined();
    expect(rooms.filter((r) => !r.hasPassword)).toHaveLength(1);
  });
});
