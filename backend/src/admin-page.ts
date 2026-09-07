import { AccessControl, GATED_ACTIONS, GatedAction } from "./access.js";
import { DEFAULT_LIMITS, LIMIT_KEYS, LimitKey, RuntimeLimits, limitBounds } from "./limits.js";
import { BotNames, BOT_NAME_MAX, DEFAULT_BANKER_NAMES, DEFAULT_PLAYER_NAMES } from "./bot-names.js";
import { AboutContent, ABOUT_MAX } from "./about.js";
import { ContactContent, CONTACT_MAX } from "./contact.js";
import { DisclaimerContent, DISCLAIMER_HEADINGS, DISCLAIMER_MAX, DISCLAIMER_SLUGS } from "./disclaimer.js";
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
// The one concession is a <meta refresh>, now ON by default: an operator opens
// this page to watch load, and a page showing stale numbers is worse than
// useless, it is misleading. It was opt-in originally for a real reason -- a
// refresh mid-typing eats a half-written list of access codes -- so the codes
// field says to stop the refresh first, and "stop auto-refresh" is one click
// away in the top bar. `?refresh=0` is the off switch.

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
  /* The login gets its own sizing rather than the dense control-panel scale.
     It is typed once, often on a phone over Tailscale, and a password you
     cannot read is a password you retype four times. Stacked labels and full
     -width fields; 1.05rem also clears the 16px threshold below which iOS
     Safari zooms the whole page on focus. */
  .login { max-width: 21rem; margin: 1.5rem 0; }
  .login .row { display: block; margin: 0 0 0.9rem; }
  .login label { display: block; min-width: 0; margin-bottom: 0.3rem; font-size: 0.8rem; font-weight: 600;
                 text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .login input { width: 100%; box-sizing: border-box; font-size: 1.05rem; padding: 0.6rem 0.65rem; letter-spacing: 0.01em; }
  .login input:focus { outline: 2px solid #1d4ed8; outline-offset: 1px; border-color: #1d4ed8; }
  .login button { width: 100%; font-size: 1rem; padding: 0.65rem; }
  @media (prefers-color-scheme: dark) {
    .login label { color: #9ca3af; }
    .login input { background: #111827; border-color: #4b5563; }
    .login input:focus { outline-color: #93c5fd; border-color: #93c5fd; }
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
    <form method="post" action="/admin/login" class="login">
      <div class="row"><label for="u">Username</label><input id="u" type="text" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" autofocus /></div>
      <div class="row"><label for="p">Password</label><input id="p" type="password" name="password" autocomplete="current-password" /></div>
      <div class="row"><button type="submit" class="save">Sign in</button></div>
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
  /** Operator-authored copy for the public About page. */
  about: AboutContent;
  /** Same, for the Contact page. */
  contact: ContactContent;
  /** Per-section overrides for the Disclaimer page. */
  disclaimer: DisclaimerContent;
  /** Names the practice-mode computer players and their banker draw from. */
  botNames: BotNames;
  /** Appended to every form action so token-authenticated sessions keep working. */
  query: string;
  refresh: boolean;
  /** Origin of the player-facing app, for Watch links. Omitted, they are hidden. */
  appUrl?: string;
  /** Mints the per-room grant a Watch link carries. Omitted, links are hidden:
   *  a link without one lands on the lobby and seats the operator as a player,
   *  which is the bug this exists to prevent. */
  watchToken?: (roomId: string) => string;
  notice?: string;
}

/**
 * The About copy gets its own page for one reason: this panel auto-refreshes
 * every 15 seconds, and a <meta refresh> cannot be cancelled without script.
 *
 * A refresh mid-typing eats what you have written. That was already known --
 * the access-codes field carries a warning telling the operator to stop the
 * refresh first -- and the About body is a much longer field to lose, so it was
 * reported within a day of shipping. A warning is a workaround pushed onto the
 * person; taking the field off the refreshing page is the fix.
 *
 * Deliberately still no JavaScript (see the note at the top of this file): the
 * alternative was a script cancelling the reload while a field is dirty, which
 * is a second concession to solve what a second page solves for free. Any other
 * long-text field belongs here for the same reason.
 */
export function renderAboutEditor({
  about,
  query,
  notice,
}: {
  about: AboutContent;
  query: string;
  notice?: string;
}): string {
  const record = about.toRecord();
  const edited = record.updatedAt
    ? new Date(record.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "never";
  const act = (path: string) => `${path}${query}`;
  return shell(
    "About page - Kvitlach admin",
    `<h1>About page</h1>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a>
    &middot; this page does not auto-refresh, so nothing you type here is lost.</p>
    <fieldset>
      <legend>Extra copy for the public About page</legend>
      <p class="meta">Shown at the foot of <b>/about</b> &mdash; beta-tester credits, thanks, a note
      about the table. Plain text: a blank line starts a new paragraph, and HTML is shown as typed
      rather than rendered. Leave both blank, or use Clear, to show nothing at all.
      Last edited: ${edited}.</p>
      <form method="post" action="${act("/admin/about")}">
        <p><label>Heading<br />
          <input type="text" name="heading" maxlength="${ABOUT_MAX.heading}" style="width:100%"
            placeholder="With thanks to our beta testers" value="${escapeHtml(record.heading)}" /></label></p>
        <p><label>Body<br />
          <textarea name="body" rows="18" maxlength="${ABOUT_MAX.body}" style="width:100%"
            placeholder="Sruly, Chaim and Shmuely played the first fifty hands and found the ones we could not."
            >${escapeHtml(record.body)}</textarea></label></p>
        <button type="submit" class="save">Save</button>
        <button type="submit" name="clear" value="1">Clear</button>
      </form>
    </fieldset>`,
    false
  );
}

/** Its own page for the same reason renderAboutEditor is: /admin carries a
 *  15-second <meta refresh>, and a refresh landing mid-edit eats a textarea
 *  full of names. */
export function renderBotNamesEditor({
  botNames,
  query,
  notice,
}: {
  botNames: BotNames;
  query: string;
  notice?: string;
}): string {
  const record = botNames.toRecord();
  const edited = record.updatedAt
    ? new Date(record.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "never";
  const act = (path: string) => `${path}${query}`;
  const pool = (names: string[]) => `<span class="meta">${escapeHtml(names.join(", "))}</span>`;
  return shell(
    "Computer players - Kvitlach admin",
    `<h1>Computer players</h1>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a>
    &middot; this page does not auto-refresh, so nothing you type here is lost.</p>
    <fieldset>
      <legend>Names for &ldquo;Play Against the Computer&rdquo;</legend>
      <p class="meta">One name per line (commas work too). Duplicates and blank lines are dropped,
      and each name is trimmed to ${BOT_NAME_MAX.name} characters so it still fits a seat plate on a
      phone. Up to ${BOT_NAME_MAX.pool} names per list. Changing these affects tables started from
      now on &mdash; a practice table already in play keeps the names it was dealt.
      Last edited: ${edited}.</p>
      <form method="post" action="${act("/admin/bot-names")}">
        <p><label>Banker names<br />
          <span class="meta">The computer banker picks one of these per table, so the dealer is not
          the same character every single time. One name here means it never changes.</span><br />
          <textarea name="banker" rows="6" style="width:100%"
            placeholder="${escapeHtml(DEFAULT_BANKER_NAMES.join(", "))}"
            >${escapeHtml(botNames.customText("banker"))}</textarea></label></p>
        <p class="meta">In use now: ${pool(botNames.bankerNames())}${
          botNames.isDefault("banker") ? " &middot; built-in list" : ""
        }</p>

        <p><label>Computer player names<br />
          <span class="meta">Each table draws as many of these as it has computer seats (2&ndash;10).
          A list shorter than the table is fine &mdash; the extra seats reuse a name with a number
          after it rather than going unfilled.</span><br />
          <textarea name="players" rows="12" style="width:100%"
            placeholder="${escapeHtml(DEFAULT_PLAYER_NAMES.join(", "))}"
            >${escapeHtml(botNames.customText("players"))}</textarea></label></p>
        <p class="meta">In use now: ${pool(botNames.playerNames())}${
          botNames.isDefault("players") ? " &middot; built-in list" : ""
        }</p>

        <button type="submit" class="save">Save</button>
        <button type="submit" name="reset" value="1">Reset to the built-in names</button>
      </form>
      <p class="meta">Clearing a box has the same effect as Reset for that list: with nothing set,
      the built-in names are used. A pool cannot be empty &mdash; a table with no names to give its
      seats could not be dealt.</p>
    </fieldset>`,
    false
  );
}

/** Same reasoning as renderAboutEditor's own doc comment: its own page so a
 *  <meta refresh> on the panel can never eat what is half-typed here. */
export function renderContactEditor({
  contact,
  query,
  notice,
}: {
  contact: ContactContent;
  query: string;
  notice?: string;
}): string {
  const record = contact.toRecord();
  const edited = record.updatedAt
    ? new Date(record.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "never";
  const act = (path: string) => `${path}${query}`;
  return shell(
    "Contact page - Kvitlach admin",
    `<h1>Contact page</h1>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a>
    &middot; this page does not auto-refresh, so nothing you type here is lost.</p>
    <fieldset>
      <legend>Extra copy for the public Contact page</legend>
      <p class="meta">Shown at the foot of <b>/contact</b> &mdash; a holiday closure notice, a
      different reply-time estimate, anything you want to say without shipping a build. Plain
      text: a blank line starts a new paragraph, and HTML is shown as typed rather than rendered.
      Leave both blank, or use Clear, to show nothing at all. Last edited: ${edited}.</p>
      <form method="post" action="${act("/admin/contact")}">
        <p><label>Heading<br />
          <input type="text" name="heading" maxlength="${CONTACT_MAX.heading}" style="width:100%"
            placeholder="We're slower to reply during the holiday" value="${escapeHtml(record.heading)}" /></label></p>
        <p><label>Body<br />
          <textarea name="body" rows="10" maxlength="${CONTACT_MAX.body}" style="width:100%"
            placeholder="We're a small team; replies may take a few extra days this week."
            >${escapeHtml(record.body)}</textarea></label></p>
        <button type="submit" class="save">Save</button>
        <button type="submit" name="clear" value="1">Clear</button>
      </form>
    </fieldset>`,
    false
  );
}

/**
 * One fieldset per legal section, each its own <form> posting only its own
 * `slug` and `body` -- saving one section can never touch another's wording,
 * and there is no field here that adds, removes or renames a section (see
 * disclaimer.ts). Same own-page-no-refresh reasoning as the other two
 * editors.
 */
export function renderDisclaimerEditor({
  disclaimer,
  query,
  notice,
}: {
  disclaimer: DisclaimerContent;
  query: string;
  notice?: string;
}): string {
  const record = disclaimer.toRecord();
  const act = (path: string) => `${path}${query}`;
  const sections = DISCLAIMER_SLUGS.map((slug) => {
    const section = record[slug];
    const edited = section.updatedAt
      ? new Date(section.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
      : "never";
    return `<fieldset>
      <legend>${escapeHtml(DISCLAIMER_HEADINGS[slug])}</legend>
      <p class="meta">${section.body
        ? `Overridden. Last edited: ${edited}.`
        : "Showing the built-in wording for this section -- nothing overrides it."}</p>
      <form method="post" action="${act("/admin/disclaimer")}">
        <input type="hidden" name="slug" value="${slug}" />
        <p><label>Override text<br />
          <textarea name="body" rows="6" maxlength="${DISCLAIMER_MAX.body}" style="width:100%"
            placeholder="Leave blank to keep the built-in wording for this section."
            >${escapeHtml(section.body)}</textarea></label></p>
        <button type="submit" class="save">Save</button>
        <button type="submit" name="clear" value="1">Clear</button>
      </form>
    </fieldset>`;
  }).join("\n");
  return shell(
    "Disclaimer page - Kvitlach admin",
    `<h1>Disclaimer page</h1>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a>
    &middot; this page does not auto-refresh, so nothing you type here is lost.</p>
    <p class="meta">Each section below replaces that section's built-in bullet points on the public
    <b>/disclaimer</b> page with the plain text you enter here (a blank line starts a new
    paragraph). The heading and which sections exist are fixed by the app, not by this form --
    only the wording of a section you choose to override changes.</p>
    ${sections}`,
    false
  );
}

export function renderAdminPage({ store, access, limits, about, contact, disclaimer, botNames, query, refresh, appUrl, watchToken, notice }: AdminPageDeps): string {
  const aboutRecord = about.toRecord();
  const aboutEdited = aboutRecord.updatedAt ? new Date(aboutRecord.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never";
  const contactRecord = contact.toRecord();
  const contactEdited = contactRecord.updatedAt ? new Date(contactRecord.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never";
  const disclaimerRecord = disclaimer.toRecord();
  const disclaimerOverrideCount = DISCLAIMER_SLUGS.filter((slug) => disclaimerRecord[slug].body).length;
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
  // Opens the real table rather than re-rendering the game server-side: a
  // second renderer here would be a second thing to keep true to round state.
  //
  // `?watch=<token>` is load-bearing, not decoration. Without it this was a
  // plain link to the table, which put the operator on the lobby's join form
  // and seated them as an ordinary PLAYER at the table they meant to observe
  // -- visible to everyone and holding a wallet. The token makes the client
  // send room:watch instead, which subscribes without creating a Player.
  //
  // The path must be /table/<id>: App.tsx matches `^/table/([^/]+)/?$` and
  // nothing else, so a bare `/<id>` silently lands on the lobby instead. That
  // shipped once in this very function and was caught only by clicking it.
  const watchLink = (roomId: string) =>
    appUrl && watchToken
      ? `<a href="${escapeHtml(appUrl.replace(/\/$/, ""))}/table/${encodeURIComponent(roomId)}?watch=${encodeURIComponent(watchToken(roomId))}" target="_blank" rel="noopener">Watch</a>`
      : '<span class="meta" title="Set PUBLIC_APP_URL to enable">&mdash;</span>';
  const rows = rooms
    .map((r) => {
      const idle = Date.now() - r.lastActivityAt;
      const humans = r.playerCount - r.botCount;
      return `<tr>
        <td><code>${escapeHtml(r.roomId)}</code>${r.hasPassword ? ' <span class="meta" title="password protected">&#128274;</span>' : ""}</td>
        <td>${escapeHtml(r.name ?? "")}${r.practice ? ' <span class="meta">(practice)</span>' : ""}</td>
        <td>${escapeHtml(r.bankerName ?? "-")}</td>
        <td>${humans}${r.botCount ? ` <span class="meta">+${r.botCount} bot</span>` : ""}${r.waitingCount ? ` <span class="meta">, ${r.waitingCount} waiting</span>` : ""}</td>
        <td>${r.completedRounds}</td>
        <td>${r.hasActiveRound ? '<span class="ok">yes</span>' : "no"}</td>
        <td>${formatIdle(idle)}</td>
        <td>${watchLink(r.roomId)}</td>
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
        <a href="${act(refresh ? "/admin?refresh=0" : "/admin")}">${refresh ? "stop auto-refresh" : "start auto-refresh"}</a>
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
        <label class="meta" for="codes">Access codes &mdash; one per line, case-insensitive, spaces trimmed.
        <b>Stop auto-refresh above before typing a long list</b>, or a refresh will clear what you have typed.</label>
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
      <legend>Computer players</legend>
      <p class="meta">The names used by &ldquo;Play Against the Computer&rdquo; &mdash; the bots at the
      seats, and the computer banker, which picks a different one of its names per table.</p>
      <p><span class="meta">Banker: ${escapeHtml(botNames.bankerNames().join(", "))}${
        botNames.isDefault("banker") ? " (built-in)" : ""
      }</span><br />
      <span class="meta">Players: ${botNames.playerNames().length} name(s)${
        botNames.isDefault("players") ? ", built-in" : ", custom"
      }</span></p>
      <p><a href="${act("/admin/bot-names")}">Edit the computer players&rsquo; names&hellip;</a></p>
    </fieldset>

    <fieldset>
      <legend>About page</legend>
      <p class="meta">Extra copy shown at the foot of the public <b>About</b> page &mdash; beta-tester
      credits, thanks, a note about the table. Last edited: ${aboutEdited}.</p>
      <p>${aboutRecord.heading || aboutRecord.body
          ? `<b>${escapeHtml(aboutRecord.heading) || "(no heading)"}</b><br />
             <span class="meta">${escapeHtml(aboutRecord.body.slice(0, 160))}${aboutRecord.body.length > 160 ? "&hellip;" : ""}</span>`
          : `<span class="meta">Nothing set &mdash; the About page shows only its built-in copy.</span>`}</p>
      <p><a href="${act("/admin/about")}">Edit the About copy&hellip;</a></p>
    </fieldset>

    <fieldset>
      <legend>Contact page</legend>
      <p class="meta">Extra copy shown at the foot of the public <b>Contact</b> page. Last edited: ${contactEdited}.</p>
      <p>${contactRecord.heading || contactRecord.body
          ? `<b>${escapeHtml(contactRecord.heading) || "(no heading)"}</b><br />
             <span class="meta">${escapeHtml(contactRecord.body.slice(0, 160))}${contactRecord.body.length > 160 ? "&hellip;" : ""}</span>`
          : `<span class="meta">Nothing set &mdash; the Contact page shows only its built-in copy.</span>`}</p>
      <p><a href="${act("/admin/contact")}">Edit the Contact copy&hellip;</a></p>
    </fieldset>

    <fieldset>
      <legend>Disclaimer page</legend>
      <p class="meta">Per-section wording overrides for the public <b>Disclaimer</b> page &mdash;
      the six legal sections there (no-gambling, liability, ownership and so on) each keep their
      built-in wording unless overridden individually.</p>
      <p>${disclaimerOverrideCount > 0
          ? `<span class="meta">${disclaimerOverrideCount} of ${DISCLAIMER_SLUGS.length} section(s) overridden.</span>`
          : `<span class="meta">Nothing overridden &mdash; the Disclaimer page shows only its built-in wording.</span>`}</p>
      <p><a href="${act("/admin/disclaimer")}">Edit the Disclaimer sections&hellip;</a></p>
    </fieldset>

    <fieldset>
      <legend>Broadcast</legend>
      <p class="meta">Pushes a banner to people currently at a table. Not stored &mdash; someone who joins
      afterwards will not see it. Pick one table to reach only that game.</p>
      <form method="post" action="${act("/admin/broadcast")}" class="row">
        <input type="text" name="text" maxlength="200" placeholder="Server restarting in 5 minutes" style="flex:1 1 20rem" />
        <select name="roomId">
          <option value="">All tables</option>
          ${rooms.map((r) => `<option value="${escapeHtml(r.roomId)}">${escapeHtml(r.roomId)}${r.name ? ` &mdash; ${escapeHtml(r.name)}` : ""}</option>`).join("")}
        </select>
        <select name="level"><option value="info">Info</option><option value="warning">Warning</option></select>
        <button type="submit" class="save">Send</button>
      </form>
    </fieldset>

    <h1>Rooms (${rooms.length})</h1>
    <p class="meta">Busiest first. Rooms auto-expire after 3 days idle; deleting one frees its Game ID at once.</p>
    ${rooms.length === 0 ? '<p class="meta">No active rooms.</p>' : `
    <table>
      <thead><tr><th>Game ID</th><th>Name</th><th>Banker</th><th>Players</th><th>Rounds</th><th>Live</th><th>Idle</th><th></th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}`,
    refresh
  );
}
