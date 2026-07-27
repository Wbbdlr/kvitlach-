import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import type { GameStore } from "./store.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function isValidToken(provided: unknown): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch rather than just returning
  // false -- a real match requires equal length anyway, so bail out first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function renderAdminPage(store: GameStore, token: string): string {
  const rooms = store.listRoomsForAdmin().sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  const rows = rooms
    .map((r) => {
      const idleMs = Date.now() - r.lastActivityAt;
      return `<tr>
        <td><code>${escapeHtml(r.roomId)}</code></td>
        <td>${escapeHtml(r.name ?? "")}</td>
        <td>${r.playerCount}</td>
        <td>${r.completedRounds}</td>
        <td>${r.hasActiveRound ? "yes" : "no"}</td>
        <td>${formatIdle(idleMs)}</td>
        <td>
          <form method="post" action="/admin/rooms/${encodeURIComponent(r.roomId)}/delete?token=${encodeURIComponent(token)}"
                onsubmit="return confirm('Delete room ${escapeHtml(r.roomId)}? This frees the Game ID immediately and cannot be undone.');">
            <button type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Kvitlach admin</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.25rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e7eb; font-size: 0.9rem; }
  th { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
  button { background: #dc2626; color: white; border: none; border-radius: 4px; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.85rem; }
  button:hover { background: #b91c1c; }
  .empty { color: #6b7280; margin-top: 1rem; }
  .meta { color: #6b7280; font-size: 0.85rem; }
</style>
</head>
<body>
  <h1>Active rooms (${rooms.length})</h1>
  <p class="meta">Rooms auto-expire after 3 days of inactivity. Deleting one here frees its Game ID immediately.</p>
  ${rooms.length === 0 ? '<p class="empty">No active rooms.</p>' : `
  <table>
    <thead>
      <tr><th>Game ID</th><th>Name</th><th>Players</th><th>Rounds</th><th>Round active</th><th>Idle</th><th></th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`}
</body>
</html>`;
}

export function createHttpServer(store: GameStore) {
  const app = Fastify({ logger: true });
  app.get("/health", async () => ({ status: "ok" }));

  // Token-gated admin tooling for freeing up stuck/stale Game IDs -- routes
  // only do anything useful when ADMIN_TOKEN is set. Requests without a
  // valid token get a plain 404 rather than 401/403, so an unauthenticated
  // probe can't even confirm the route exists.
  app.get("/admin", async (request, reply) => {
    const token = (request.query as Record<string, unknown>)?.token;
    if (!isValidToken(token)) return reply.code(404).send("Not found");
    reply.type("text/html").send(renderAdminPage(store, token as string));
  });

  app.post<{ Params: { roomId: string } }>("/admin/rooms/:roomId/delete", async (request, reply) => {
    const token = (request.query as Record<string, unknown>)?.token;
    if (!isValidToken(token)) return reply.code(404).send("Not found");
    store.forceDeleteRoom(request.params.roomId);
    reply.redirect(`/admin?token=${encodeURIComponent(token as string)}`);
  });

  return app;
}
