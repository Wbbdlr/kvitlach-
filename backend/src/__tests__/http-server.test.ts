import { createHttpServer } from "../http-server.js";
import { GameStore } from "../store.js";

describe("admin HTTP routes", () => {
  const originalToken = process.env.ADMIN_TOKEN;
  afterEach(() => {
    process.env.ADMIN_TOKEN = originalToken;
  });

  it("404s on /admin with no token configured", async () => {
    delete process.env.ADMIN_TOKEN;
    const app = createHttpServer(new GameStore());
    const res = await app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(404);
  });

  it("404s on /admin with a wrong token", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore());
    const res = await app.inject({ method: "GET", url: "/admin?token=wrong" });
    expect(res.statusCode).toBe(404);
  });

  it("200s on /admin with the correct token and lists rooms", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const store = new GameStore();
    store.createRoom({ firstName: "Banker", roomId: "SHOWME" });
    const app = createHttpServer(store);
    const res = await app.inject({ method: "GET", url: "/admin?token=correct-secret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("SHOWME");
  });

  it("deletes a room via POST with the correct token, freeing its Game ID", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const store = new GameStore();
    store.createRoom({ firstName: "Banker", roomId: "DELETEME" });
    const app = createHttpServer(store);

    const res = await app.inject({ method: "POST", url: "/admin/rooms/DELETEME/delete?token=correct-secret" });
    expect(res.statusCode).toBe(302);
    expect(store.listRoomsForAdmin()).toHaveLength(0);
    expect(() => store.createRoom({ firstName: "Banker", roomId: "DELETEME" })).not.toThrow();
  });

  it("refuses to delete without a valid token", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const store = new GameStore();
    store.createRoom({ firstName: "Banker", roomId: "KEEPME" });
    const app = createHttpServer(store);

    const res = await app.inject({ method: "POST", url: "/admin/rooms/KEEPME/delete?token=wrong" });
    expect(res.statusCode).toBe(404);
    expect(store.listRoomsForAdmin()).toHaveLength(1);
  });

  it("throttles repeated wrong-token guesses from the same IP, even once they guess right", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore());
    const ip = "203.0.113.42"; // unique to this test so it can't share attempt counts with the others above

    for (let i = 0; i < 20; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: "/admin?token=wrong",
        headers: { "x-forwarded-for": ip },
      });
      expect(res.statusCode).toBe(404);
    }

    // The 21st attempt is rate-limited outright -- even the CORRECT token now 404s.
    const res = await app.inject({
      method: "GET",
      url: "/admin?token=correct-secret",
      headers: { "x-forwarded-for": ip },
    });
    expect(res.statusCode).toBe(404);
  });

  it("never throttles a legitimate admin making repeated correct-token requests", async () => {
    process.env.ADMIN_TOKEN = "correct-secret";
    const app = createHttpServer(new GameStore());
    const ip = "203.0.113.99";

    for (let i = 0; i < 30; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: "/admin?token=correct-secret",
        headers: { "x-forwarded-for": ip },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
