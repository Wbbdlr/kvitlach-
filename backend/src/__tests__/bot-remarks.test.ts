import { describe, expect, it, vi, afterEach } from "vitest";
import { GameStore } from "../store.js";
import { botRemark, REMARK_CHANCE, REMARK_COOLDOWN_MS } from "../bot-remarks.js";
import type { BotMoment } from "../bot-remarks.js";

// What the computer players say, and -- more importantly -- how often they do
// not. These ride the reaction channel, so a bug here is twenty bubbles over
// the cards rather than a wrong number somewhere quiet.

const MOMENTS: BotMoment[] = ["futched", "won", "stood", "bigBet", "bankFutched"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what a bot can say", () => {
  it("gives the same bot the same voice every time", () => {
    // The property that makes a table read as populated rather than as one
    // person in five chairs -- the same reason bot.ts hashes its betting
    // temperaments off the id instead of storing them.
    for (const moment of MOMENTS) {
      const first = botRemark(moment, "bot-3", 0.5);
      for (let i = 0; i < 20; i += 1) expect(botRemark(moment, "bot-3", 0.5)).toBe(first);
    }
  });

  it("does not give every bot the same voice", () => {
    // If the hash ever collapses, this is the only thing that would notice:
    // every assertion above still passes with one voice.
    const heard = new Set<string>();
    for (let i = 0; i < 40; i += 1) heard.add(String(botRemark("stood", `bot-${i}`, 0)));
    expect(heard.size, "every bot said the same thing").toBeGreaterThan(1);
  });

  it("stays inside the list at both ends of the roll", () => {
    // Math.random() can return 0 and can return 0.9999..., and an index of
    // lines.length is undefined rendered as an empty bubble.
    for (const moment of MOMENTS) {
      for (const roll of [0, 0.0001, 0.5, 0.999999, 1]) {
        const line = botRemark(moment, "bot-7", roll);
        expect(typeof line, `${moment} at roll ${roll}`).toBe("string");
        expect(line!.length).toBeGreaterThan(0);
      }
    }
  });

  it("never says anything with an emoji in it", () => {
    // Not a style nit -- this project's no-emoji rule has one deliberate
    // exception, player reactions, on the grounds that those are USER content.
    // A bot remark is copy we wrote, so the exception does not cover it, and
    // the remarks happen to travel down the very channel that exception was
    // written for. Nothing else would catch a stray emoji added here.
    for (const moment of MOMENTS) {
      for (let i = 0; i < 40; i += 1) {
        for (const roll of [0, 0.34, 0.67, 0.99]) {
          const line = botRemark(moment, `bot-${i}`, roll)!;
          for (const ch of [...line]) {
            const cp = ch.codePointAt(0)!;
            const pictographic =
              cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) || cp === 0xfe0f;
            expect(pictographic, `${line} contains an emoji`).toBe(false);
          }
        }
      }
    }
  });
});

describe("how often the table hears one", () => {
  type Speaker = { maybeBotRemark(roomId: string, playerId: string, moment: BotMoment): void };
  function table() {
    const store = new GameStore();
    const heard: { playerId: string; text: string }[] = [];
    store.setReactionListener((_roomId, playerId, text) => heard.push({ playerId, text }));
    return { store, heard, speak: store as unknown as Speaker };
  }

  it("says nothing at all when nobody is listening", () => {
    // The default in every other test in this suite, and the reason adding
    // remarks did not need 74 test files updated.
    const store = new GameStore();
    const speak = store as unknown as Speaker;
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(() => speak.maybeBotRemark("ROOM", "bot-1", "futched")).not.toThrow();
  });

  it("speaks when the roll goes its way", () => {
    const { heard, speak } = table();
    vi.spyOn(Math, "random").mockReturnValue(0);
    speak.maybeBotRemark("ROOM", "bot-1", "futched");
    expect(heard).toHaveLength(1);
    expect(heard[0]!.playerId).toBe("bot-1");
  });

  it("stays quiet when it does not", () => {
    const { heard, speak } = table();
    // Exactly at the threshold, which must NOT pass -- the check is `>=`.
    vi.spyOn(Math, "random").mockReturnValue(REMARK_CHANCE);
    speak.maybeBotRemark("ROOM", "bot-1", "futched");
    expect(heard).toHaveLength(0);
  });

  it("will not let a second bot talk over the first", () => {
    // The half that actually stops a pile-up. Probability alone still lets
    // three bots speak in the same second, and three bubbles at once over a
    // crowded felt is the failure this feature has to avoid.
    const { heard, speak } = table();
    vi.spyOn(Math, "random").mockReturnValue(0);
    speak.maybeBotRemark("ROOM", "bot-1", "futched");
    speak.maybeBotRemark("ROOM", "bot-2", "won");
    speak.maybeBotRemark("ROOM", "bot-3", "stood");
    expect(heard).toHaveLength(1);
  });

  it("holds the cooldown per table, not globally", () => {
    // Two practice tables running at once must not mute each other.
    const { heard, speak } = table();
    vi.spyOn(Math, "random").mockReturnValue(0);
    speak.maybeBotRemark("ROOM-A", "bot-1", "futched");
    speak.maybeBotRemark("ROOM-B", "bot-1", "futched");
    expect(heard).toHaveLength(2);
  });

  it("talks again once the cooldown has passed", () => {
    const { heard, speak } = table();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    speak.maybeBotRemark("ROOM", "bot-1", "futched");
    vi.spyOn(Date, "now").mockReturnValue(now + REMARK_COOLDOWN_MS - 1);
    speak.maybeBotRemark("ROOM", "bot-1", "futched");
    expect(heard).toHaveLength(1);
    vi.spyOn(Date, "now").mockReturnValue(now + REMARK_COOLDOWN_MS);
    speak.maybeBotRemark("ROOM", "bot-1", "futched");
    expect(heard).toHaveLength(2);
  });

  it("arms the cooldown even if the listener throws", () => {
    // A broken socket must not turn into a remark attempt on every single
    // turn for the rest of the night.
    const store = new GameStore();
    let calls = 0;
    store.setReactionListener(() => {
      calls += 1;
      throw new Error("socket gone");
    });
    const speak = store as unknown as Speaker;
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(() => speak.maybeBotRemark("ROOM", "bot-1", "futched")).toThrow("socket gone");
    expect(() => speak.maybeBotRemark("ROOM", "bot-2", "won")).not.toThrow();
    expect(calls).toBe(1);
  });
});
