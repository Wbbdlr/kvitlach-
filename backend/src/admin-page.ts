import { AccessControl, GATED_ACTIONS, GatedAction } from "./access.js";
import { DEFAULT_LIMITS, LIMIT_KEYS, LimitKey, RuntimeLimits, limitBounds } from "./limits.js";
import { GameStore } from "./store.js";
import { metrics } from "./metrics.js";

// The admin page's HTML. Split out of http-server.ts once it stopped being a
// room table and became a control panel -- the routes and the markup were
// crowding each other out.
//
// Still plain HTML with no JavaScript, and that is not laziness. Every control
// is a form POST followed by a redirect, so there is no client state to get
// out of step with the server, nothing to break if a request fails, and no
// script that could ever put the session cookie somewhere it should not be.
// The one concession is an optional <meta refresh>, opt-in via a link, because
// auto-refreshing while someone is typing a list of access codes would eat it.

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 1040px; margin: 1.5rem auto; padding: 0 1rem; color: #1f2937; background: #f9fafb; }
  h1 { font-size: 1.15rem; margin: 1.75rem 0 0.35rem; }
  a { color: #1d4ed8; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; background: #fff; }
  th, td { text-align: left; padding: 0.45rem 0.7rem; border-bottom: 1px solid #e5e7eb; font-size: 0.88rem; }
  th { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; }
  button { background: #374151; color: #fff; border: 0; border-radius: 4px; padding: 0.35rem 0.8rem; cursor: pointer; font-size: 0.85rem; }
  button:hover { background: #111827; }
  button.danger { background: #dc2626; } button.danger:hover { background: #b91c1c; }
  button.save { background: #1d4ed8; } button.save:hover { background: #1e40af; }
  button.on { background: #047857; cursor: default; }
  .meta { color: #6b7280; font-size: 0.82rem; }
  fieldset { border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.6rem 1rem 1rem; margin: 0 0 1.25rem; background: #fff; }
  legend { font-size: 0.7rem; text-transform: uppercase; color: #6b7280; font-weight: 600; letter-spacing: 0.04em; }
  textarea, input[type=text], input[type=password], input[type=number], select { font: inherit; font-size: 0.88rem; padding: 0.35rem; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: inherit; }
  textarea { width: 100%; font-family: ui-monospace, monospace; }
  .tiles { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .tile { flex: 1 1 7.2rem; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.55rem 0.7rem; background: #fff; }
  .tile .v { font-size: 1.5rem; font-weight: 600; line-height: 1.1; }
  .tile .k { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .ok { color: #047857; } .warn { color: #b45309; } .bad { color: #b91c1c; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin: 0.35rem 0; }
  .row label { min-width: 5.5rem; font-size: 0.88rem; }
  .grid3 { display: flex; flex-wrap: wrap; gap: 1.25rem; }
  .topbar { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
  code { font-size: 0.85em; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b1220; color: #e5e7eb; }
    table, fieldset, .tile { background: #111827; }
    th, td, fieldset, .tile, .topbar { border-color: #1f2937; }
    textarea, input, select { background: #0b1220; border-color: #374151; color: #e5e7eb; }
    a { color: #93c5fd; }
  }
`;

function shell(title: string, body: string, refresh: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
${refresh ? '<meta http-equiv="refresh" content="15" />' : ""}
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderLoginPage(error?: string): string {
  return shell(
    "Kvitlach admin",
    `<h1>Kvitlach admin</h1>
    ${error ? `<p class="bad">${escapeHtml(error)}</p>` : ""}
    <form method="post" action="/admin/login">
      <div class="row"><label for="u">Username</label><input id="u" type="text" name="username" autocomplete="username" autofocus /></div>
      <div class="row"><label for="p">Password</label><input id="p" type="password" name="password" autocomplete="current-password" /></div>
      <div class="row"><label></label><button type="submit" class="save">Sign in</button></div>
    </form>
    <p class="meta">Sessions last 12 hours and are not shared between browsers.</p>`,
    false
  );
}

// `idle` and `uptime` want different words for the same small number: a room
// last touched 12 seconds ago is "just now", but a server that has been up for
// 12 seconds is emphatically not -- that is the interesting case, because it
// means something restarted.
function formatDuration(ms: number, under1m: string): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return under1m === "" ? `${Math.max(Math.floor(ms / 1000), 0)}s` : under1m;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const formatIdle = (ms: number) => formatDuration(ms, "just now");
const formatUptime = (ms: number) => formatDuration(ms, "");

function tile(key: string, value: string | number, cls = ""): string {
  return `<div class="tile"><div class="v ${cls}">${escapeHtml(String(value))}</div><div class="k">${escapeHtml(key)}</div></div>`;
}

// Thresholds match the Uptime Kuma monitors in docs/OPERATIONS.md on purpose:
// the page and the alert should not disagree about what "bad" means.
function band(value: number, warn: number, bad: number): string {
  return value >= bad ? "bad" : value >= warn ? "warn" : "ok";
}

export interface AdminPageDeps {
  store: GameStore;
  access: AccessControl;
  limits: RuntimeLimits;
  /** Appended to every form action so token-authenticated sessions keep working. */
  query: string;
  refresh: boolean;
  notice?: string;
}

export function renderAdminPage({ store, access, limits, query, refresh, notice }: AdminPageDeps): string {
  const load = store.loadSnapshot();
  const lag = Math.round(metrics.eventLoopLagMs);
  const conns = metrics.currentWsConnections;
  const rss = Math.round(process.memoryUsage().rss / 1048576);
  const snap = access.snapshot();
  const act = (path: string) => `${path}${query}`;

  const tiles = [
    tile("rooms", `${load.rooms} / ${limits.maxRooms}`, band(load.rooms, limits.maxRooms * 0.7, limits.maxRooms * 0.9)),
    tile("players", load.players),
    tile("rounds live", load.activeRounds),
    tile("ws conns", conns, band(conns, 200, 300)),
    tile("loop lag", `${lag} ms`, band(lag, 100, 250)),
    tile("memory", `${rss} MB`, band(rss, 600, 850)),
    tile("uptime", formatUptime(process.uptime() * 1000)),
  ].join("");

  const presetButton = (mode: string, label: string, hint: string) => `
    <form method="post" action="${act("/admin/access")}" class="row">
      <input type="hidden" name="mode" value="${mode}" />
      <button type="submit" class="${snap.mode === mode ? "on" : ""}"${snap.mode === mode ? " disabled" : ""}>${escapeHtml(label)}</button>
      <span class="meta">${escapeHtml(hint)}</span>
    </form>`;

  const actionLabels: Record<GatedAction, string> = {
    create: "Start a table",
    join: "Join a table",
    practice: "Practice vs bots",
  };
  const actionRows = GATED_ACTIONS.map((action) => {
    const current = snap.modes[action];
    const option = (v: string, text: string) =>
      `<option value="${v}"${current === v ? " selected" : ""}>${escapeHtml(text)}</option>`;
    return `<form method="post" action="${act("/admin/access")}" class="row">
      <input type="hidden" name="action" value="${action}" />
      <label for="m-${action}">${escapeHtml(actionLabels[action])}</label>
      <select id="m-${action}" name="actionMode">
        ${option("open", "Anyone")}${option("code", "Needs a code")}${option("closed", "Nobody")}
      </select>
      <button type="submit" class="save">Apply</button>
    </form>`;
  }).join("");

  const limitRows = LIMIT_KEYS.map((key: LimitKey) => {
    const [min, max] = limitBounds(key);
    const labels: Record<LimitKey, string> = {
      maxRooms: "Max rooms",
      maxPracticeRooms: "Max practice rooms",
      maxPlayersPerRoom: "Max players per room",
    };
    return `<form method="post" action="${act("/admin/limits")}" class="row">
      <label for="l-${key}">${escapeHtml(labels[key])}</label>
      <input id="l-${key}" type="number" name="value" value="${limits.get(key)}" min="${min}" max="${max}" step="1" style="width:6rem" />
      <input type="hidden" name="key" value="${key}" />
      <button type="submit" class="save">Set</button>
      <span class="meta">${min}&ndash;${max}${limits.isDefault(key) ? " &middot; default" : ` &middot; default ${DEFAULT_LIMITS[key]}`}</span>
    </form>`;
  }).join("");

  const rooms = store.listRoomsForAdmin();
  const rows = rooms
    .map((r) => {
      const idle = Date.now() - r.lastActivityAt;
      const humans = r.playerCount - r.botCount;
      return `<tr>
        <td><code>${escapeHtml(r.roomId)}</code>${r.hasPassword ? ' <span class="meta" title="password protected">&#128274;</span>' : ""}</td>
        <td>${escapeHtml(r.name ?? "")}${r.practice ? ' <span class="meta">(practice)</span>' : ""}</td>
        <td>${escapeHtml(r.bankerName ?? "—")}</td>
        <td>${humans}${r.botCount ? ` <span class="meta">+${r.botCount} bot</span>` : ""}${r.waitingCount ? ` <span class="meta">, ${r.waitingCount} waiting</span>` : ""}</td>
        <td>${r.completedRounds}</td>
        <td>${r.hasActiveRound ? '<span class="ok">yes</span>' : "no"}</td>
        <td>${formatIdle(idle)}</td>
        <td>
          <form method="post" action="/admin/rooms/${encodeURIComponent(r.roomId)}/delete${query}"
                data-room="${escapeHtml(r.roomId)}"
                onsubmit="return confirm('Delete room ' + this.dataset.room + '? This frees the Game ID immediately and cannot be undone.');">
            <button type="submit" class="danger">Delete</button>
          </form>
        </td>
      </tr>`;
    })
    .join("\n");

  return shell(
    "Kvitlach admin",
    `<div class="topbar">
      <h1 style="margin:0">Kvitlach admin</h1>
      <span class="meta">
        <a href="${act(refresh ? "/admin" : "/admin?refresh=1")}">${refresh ? "stop auto-refresh" : "auto-refresh"}</a>
        &middot; <a href="/health/detail">raw JSON</a>
        &middot; <form method="post" action="/admin/logout" style="display:inline"><button type="submit">Sign out</button></form>
      </span>
    </div>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}

    <h1>Load</h1>
    <div class="tiles">${tiles}</div>
    <p class="meta">Loop lag is the one that matters: everything here runs on one event loop, so it climbs
    while players are already seeing turns land late &mdash; well before memory or room count look alarming.</p>

    <fieldset>
      <legend>Who can play &mdash; currently <b>${escapeHtml(snap.mode)}</b></legend>
      <p class="meta">Applies immediately, no restart, and survives one. <b>Never</b> affects a game already in
      progress: reconnecting to a table you are already seated at is not gated, in any mode.</p>
      <div class="grid3">
        <div style="flex:1 1 22rem">
          <p class="meta"><b>Presets</b> &mdash; set all three at once.</p>
          ${presetButton("open", "Open", "Anyone can start, join and practise.")}
          ${presetButton("invite", "Invite only", `A code is needed for everything. ${snap.codeCount} code(s) set.`)}
          ${presetButton("closed", "Closed", "No new games at all. For when the box is struggling.")}
        </div>
        <div style="flex:1 1 22rem">
          <p class="meta"><b>Per action</b> &mdash; e.g. anyone may join, only you may start a table.</p>
          ${actionRows}
        </div>
      </div>
      <form method="post" action="${act("/admin/access")}" style="margin-top:0.75rem">
        <label class="meta" for="codes">Access codes &mdash; one per line, case-insensitive, spaces trimmed.</label>
        <textarea id="codes" name="codes" rows="3" placeholder="one code per line"></textarea>
        <button type="submit" class="save">Replace codes</button>
        <span class="meta">Existing codes are never shown. Saving replaces the whole list; ${snap.codeCount} set now.</span>
      </form>
    </fieldset>

    <fieldset>
      <legend>Capacity</legend>
      <p class="meta">Throttle load without a rebuild. Lowering a cap never evicts anyone &mdash; it only refuses
      the next one over the line.</p>
      ${limitRows}
      <form method="post" action="${act("/admin/limits")}" class="row">
        <input type="hidden" name="reset" value="1" />
        <button type="submit">Reset to defaults</button>
      </form>
    </fieldset>

    <fieldset>
      <legend>Broadcast</legend>
      <p class="meta">Pushes a banner to everyone currently at a table. Not stored &mdash; someone who joins
      afterwards will not see it.</p>
      <form method="post" action="${act("/admin/broadcast")}" class="row">
        <input type="text" name="text" maxlength="200" placeholder="Server restarting in 5 minutes" style="flex:1 1 22rem" />
        <select name="level"><option value="info">Info</option><option value="warning">Warning</option></select>
        <button type="submit" class="save">Send</button>
      </form>
    </fieldset>

    <h1>Rooms (${rooms.length})</h1>
    <p class="meta">Busiest first. Rooms auto-expire after 3 days idle; deleting one frees its Game ID at once.</p>
    ${rooms.length === 0 ? '<p class="meta">No active rooms.</p>' : `
    <table>
      <thead><tr><th>Game ID</th><th>Name</th><th>Banker</th><th>Players</th><th>Rounds</th><th>Live</th><th>Idle</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}`,
    refresh
  );
}
