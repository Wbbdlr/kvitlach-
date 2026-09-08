import { AccessControl, GATED_ACTIONS, GatedAction } from "./access.js";
import { DEFAULT_LIMITS, LIMIT_KEYS, LimitKey, RuntimeLimits, limitBounds } from "./limits.js";
import { BotNames, BOT_NAME_MAX, DEFAULT_BANKER_NAMES, DEFAULT_PLAYER_NAMES } from "./bot-names.js";
import { AboutContent, ABOUT_MAX } from "./about.js";
import { ContactContent, CONTACT_MAX } from "./contact.js";
import { DisclaimerContent, DISCLAIMER_HEADINGS, DISCLAIMER_MAX, DISCLAIMER_SLUGS } from "./disclaimer.js";
import { GameStore } from "./store.js";
import type { AdminRoomDetail } from "./store.js";
import type { ConnectionSummary, LedgerEntry } from "./types.js";
import type { ProtectionKind, ProtectionSnapshot } from "./ws-server.js";
import type { AdminLoginSnapshot } from "./http-server.js";
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
// "3d 4h" answers "is this stale", and nothing else -- it cannot answer "was
// that before or after Tuesday's game", which is the question actually being
// asked of this table. Both are shown: the relative one to scan, the absolute
// one to reason about. UTC and explicit about it, because the operator reading
// this and the box writing it are not reliably in the same zone, and a bare
// naked local-looking time is how you end up off by five hours with nothing on
// screen admitting it.
const formatStamp = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
};
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
  /** Room table search and ordering. Applied here, over listRoomsForAdmin's
   *  output -- see the route's comment on why it is not a store concern. */
  filter?: RoomFilter;
}

export interface RoomFilter {
  /** Matched against Game ID, room name and banker name, case-insensitively. */
  q: string;
  kind: "all" | "real" | "practice";
  sort: "players" | "idle" | "rounds" | "id";
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

export function renderAdminPage({ store, access, limits, about, contact, disclaimer, botNames, query, refresh, appUrl, watchToken, notice, filter }: AdminPageDeps): string {
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

  const activeFilter: RoomFilter = filter ?? { q: "", kind: "all", sort: "players" };
  const allRooms = store.listRoomsForAdmin();
  const needle = activeFilter.q.trim().toLowerCase();
  // Game ID, room name and banker are the three things an operator has in
  // hand when someone says "our table is stuck": the code off the player's
  // screen, the name they picked, or whose table it is.
  const rooms = allRooms
    .filter((r) => (activeFilter.kind === "all" ? true : activeFilter.kind === "practice" ? r.practice : !r.practice))
    .filter((r) =>
      !needle ||
      r.roomId.toLowerCase().includes(needle) ||
      (r.name ?? "").toLowerCase().includes(needle) ||
      (r.bankerName ?? "").toLowerCase().includes(needle)
    )
    .sort((a, b) => {
      // listRoomsForAdmin already sorted busiest-first, so "players" re-sorts
      // to the same order rather than skipping the sort -- the array has been
      // filtered, not reordered, and leaving it alone here would make the
      // default depend on that staying true.
      if (activeFilter.sort === "idle") return a.lastActivityAt - b.lastActivityAt;
      if (activeFilter.sort === "rounds") return b.completedRounds - a.completedRounds;
      if (activeFilter.sort === "id") return a.roomId.localeCompare(b.roomId);
      return b.playerCount - a.playerCount || b.lastActivityAt - a.lastActivityAt;
    });

  // A GET form drops everything not in its own fields, so a token session
  // would filter itself straight back out to the login 404, and `?refresh=0`
  // would quietly come back on. Both ride along as hidden inputs.
  const tokenValue = query.startsWith("?token=") ? decodeURIComponent(query.slice("?token=".length)) : "";
  const carryFields =
    (tokenValue ? `<input type="hidden" name="token" value="${escapeHtml(tokenValue)}" />` : "") +
    (refresh ? "" : '<input type="hidden" name="refresh" value="0" />');

  const sortOption = (v: RoomFilter["sort"], text: string) =>
    `<option value="${v}"${activeFilter.sort === v ? " selected" : ""}>${escapeHtml(text)}</option>`;
  const kindOption = (v: RoomFilter["kind"], text: string) =>
    `<option value="${v}"${activeFilter.kind === v ? " selected" : ""}>${escapeHtml(text)}</option>`;
  const roomFilterForm = `
    <form method="get" action="/admin" class="row">
      ${carryFields}
      <label for="q">Find</label>
      <input id="q" type="text" name="q" value="${escapeHtml(activeFilter.q)}" placeholder="Game ID, name or banker" style="width:14rem" autocapitalize="none" autocorrect="off" spellcheck="false" />
      <select name="kind" aria-label="Room kind">${kindOption("all", "All tables")}${kindOption("real", "Real only")}${kindOption("practice", "Practice only")}</select>
      <select name="sort" aria-label="Sort by">${sortOption("players", "Busiest first")}${sortOption("idle", "Most idle first")}${sortOption("rounds", "Most rounds first")}${sortOption("id", "Game ID")}</select>
      <button type="submit" class="save">Apply</button>
      ${needle || activeFilter.kind !== "all" || activeFilter.sort !== "players" ? `<a href="${act("/admin")}#rooms">clear</a>` : ""}
    </form>`;
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
        <td><a href="${act(`/admin/rooms/${encodeURIComponent(r.roomId)}`)}"><code>${escapeHtml(r.roomId)}</code></a>${r.hasPassword ? ' <span class="meta" title="password protected">&#128274;</span>' : ""}</td>
        <td>${escapeHtml(r.name ?? "")}${r.practice ? ' <span class="meta">(practice)</span>' : ""}</td>
        <td>${escapeHtml(r.bankerName ?? "-")}</td>
        <td>${humans}${r.botCount ? ` <span class="meta">+${r.botCount} bot</span>` : ""}${r.waitingCount ? ` <span class="meta">, ${r.waitingCount} waiting</span>` : ""}</td>
        <td>${r.completedRounds}</td>
        <td>${r.hasActiveRound ? '<span class="ok">yes</span>' : "no"}</td>
        <td>${formatIdle(idle)}<div class="meta">${escapeHtml(formatStamp(r.lastActivityAt))}</div></td>
        <td>${watchLink(r.roomId)}</td>
        <td><label class="meta"><input type="checkbox" name="roomId" value="${escapeHtml(r.roomId)}"> delete</label></td>
      </tr>`;
    })
    .join("\n");

  return shell(
    "Kvitlach admin",
    `<div class="topbar">
      <h1 style="margin:0">Kvitlach admin</h1>
      <span class="meta">
        <a href="${act(refresh ? "/admin?refresh=0" : "/admin")}">${refresh ? "stop auto-refresh" : "start auto-refresh"}</a>
        &middot; <a href="${act("/admin/protections")}">protections</a>
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

    <h1 id="rooms">Rooms (${rooms.length}${rooms.length === allRooms.length ? "" : ` of ${allRooms.length}`})</h1>
    <p class="meta">Idle is measured from the room's own last activity and survives a restart.
    Rooms auto-expire after 3 days idle; deleting one frees its Game ID at once.
    A Game ID opens that table's detail: who is connected, every chip correction, every round played.</p>
    ${roomFilterForm}
    ${rooms.length === 0 ? `<p class="meta">${allRooms.length === 0 ? "No active rooms." : "No rooms match that filter."}</p>` : `
    <form method="post" action="${act("/admin/rooms/delete")}#rooms"
          onsubmit="var n=this.querySelectorAll('input[name=roomId]:checked').length; if(!n){alert('Tick at least one room to delete.');return false;} return confirm('Delete '+n+' room'+(n>1?'s':'')+'? This frees the Game ID'+(n>1?'s':'')+' immediately and cannot be undone.');">
      <table>
        <thead><tr><th>Game ID</th><th>Name</th><th>Banker</th><th>Players</th><th>Rounds</th><th>Live</th><th>Idle / last active</th><th></th><th>Select</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><button type="submit" class="danger">Delete selected</button></p>
    </form>`}`,
    refresh
  );
}

export interface RoomDetailDeps {
  roomId: string;
  /** Undefined when the room is gone -- reaped, deleted, or never existed.
   *  The page still renders, because the operator arrived from a link that
   *  was true 15 seconds ago and deserves to be told which. */
  room?: AdminRoomDetail;
  connections: ConnectionSummary[];
  /** False on an in-memory deploy, where connection history is not recorded
   *  at all. Distinguishes "nobody connected" from "nothing is written down". */
  hasDb: boolean;
  query: string;
  appUrl?: string;
  watchToken?: (roomId: string) => string;
  notice?: string;
}

const LEDGER_LABELS: Record<LedgerEntry["kind"], string> = {
  adjust: "Adjustment",
  "buy-in": "Buy-in",
  "bank-topup": "Bank top-up",
  kick: "Removed",
  leave: "Left",
  undo: "Undo",
};

const chips = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * One room, in full.
 *
 * Read-only by design, and that is the whole reason this page could be built
 * in an afternoon: every number here is already maintained by gameplay, so
 * there is nothing to keep in step and nothing that can be wrong in a way the
 * game would disagree with. The delete control deliberately stays on the room
 * table -- a page showing a night's ledger is not where a destructive button
 * belongs.
 *
 * No <meta refresh>. The room list refreshes because it is a load display;
 * this is a thing you read, and a page that reloads under you halfway down a
 * ledger is the same complaint that moved the About editor onto its own page.
 */
export function renderRoomDetail({ roomId, room, connections, hasDb, query, appUrl, watchToken, notice }: RoomDetailDeps): string {
  const act = (path: string) => `${path}${query}`;
  const back = `<a href="${act("/admin")}#rooms">&larr; all rooms</a>`;

  if (!room) {
    return shell(
      "Room not found",
      `<div class="topbar"><h1 style="margin:0">Room <code>${escapeHtml(roomId)}</code></h1><span class="meta">${back}</span></div>
      <p class="meta">This room is no longer on the server. It was either deleted from the panel, or it
      passed its idle window and was reaped. Its Game ID is free for reuse.</p>`,
      false
    );
  }

  const idle = Date.now() - room.lastActivityAt;
  const tiles = [
    tile("players", `${room.playerCount - room.botCount}${room.botCount ? ` +${room.botCount}` : ""}`),
    tile("rounds", room.completedRounds),
    tile("live round", room.hasActiveRound ? "yes" : "no", room.hasActiveRound ? "ok" : ""),
    tile("idle", formatIdle(idle)),
    tile("buy-in", room.buyIn),
    tile("bank", room.bankerBuyIn),
    tile("turn clock", `${room.turnSeconds ?? 60}s`),
    tile("decks", room.deckCount ? String(room.deckCount) : "auto"),
  ].join("");

  const seatRows = room.seats
    .map((seat) => {
      const offline =
        seat.presence === "offline" && seat.offlineSince
          ? `<div class="meta">${escapeHtml(formatIdle(Date.now() - seat.offlineSince))}</div>`
          : "";
      return `<tr>
        <td>${escapeHtml(seat.name)}${seat.isBot ? ' <span class="meta">(bot)</span>' : ""}</td>
        <td>${seat.role === "admin" ? "Banker" : seat.role === "spectator" ? "Spectator" : "Player"}</td>
        <td>${seat.presence === "online" ? '<span class="ok">online</span>' : '<span class="warn">offline</span>'}${offline}</td>
        <td>${seat.wallet}</td>
        <td>${seat.waiting ? '<span class="meta">waiting for next round</span>' : ""}</td>
        <td class="meta"><code>${escapeHtml(seat.id)}</code></td>
      </tr>`;
    })
    .join("\n");

  // A wallet with no seat behind it is money the room still thinks it holds
  // for somebody who is not there. removePlayerCompletely deletes the two
  // together, so this list should always be empty -- which is exactly why it
  // is worth showing when it is not.
  const orphans = room.orphanWallets.length
    ? `<p class="bad">${room.orphanWallets.length} wallet(s) with no seat: ${escapeHtml(
        room.orphanWallets.map((w) => `${w.playerId} (${w.amount})`).join(", ")
      )}</p>`
    : "";

  const connectionRows = connections
    .map(
      (c) => `<tr>
        <td class="meta"><code>${escapeHtml(c.playerId)}</code></td>
        <td><code>${escapeHtml(c.ip ?? "-")}</code></td>
        <td>${escapeHtml(c.connectedAt ? formatStamp(c.connectedAt) : "-")}</td>
        <td>${escapeHtml(c.lastSeenAt ? formatStamp(c.lastSeenAt) : "still open")}</td>
        <td class="meta">${escapeHtml((c.userAgent ?? "").slice(0, 90))}</td>
      </tr>`
    )
    .join("\n");

  const ledgerRows = room.ledger
    .map(
      (e) => `<tr${e.undoneAt ? ' class="meta"' : ""}>
        <td>${escapeHtml(formatStamp(e.at))}</td>
        <td>${escapeHtml(LEDGER_LABELS[e.kind] ?? e.kind)}${e.undoneAt ? " &middot; undone" : ""}</td>
        <td>${escapeHtml(e.playerName)}</td>
        <td>${escapeHtml(e.actorName)}</td>
        <td class="${e.amount < 0 ? "bad" : "ok"}">${escapeHtml(chips(e.amount))}</td>
        <td class="meta">${escapeHtml(e.note ?? "")}</td>
      </tr>`
    )
    .join("\n");

  const historyRows = room.roundHistory
    .map((h) => {
      const played = h.entries
        .filter((e) => e.role !== "admin")
        .map((e) => `${escapeHtml(e.name)} ${escapeHtml(chips(e.net))}`)
        .join(", ");
      return `<tr>
        <td>#${h.roundNumber}</td>
        <td>${escapeHtml(formatStamp(h.completedAt))}</td>
        <td>${h.voided ? '<span class="warn">voided</span>' : `${h.entries.length} hand(s)`}</td>
        <td class="meta">${played}</td>
      </tr>`;
    })
    .join("\n");

  const watch =
    appUrl && watchToken
      ? ` &middot; <a href="${escapeHtml(appUrl.replace(/\/$/, ""))}/table/${encodeURIComponent(room.roomId)}?watch=${encodeURIComponent(
          watchToken(room.roomId)
        )}" target="_blank" rel="noopener">Watch this table</a>`
      : "";

  const pending = [
    room.pendingRenames ? `${room.pendingRenames} rename request(s)` : "",
    room.pendingBuyIns ? `${room.pendingBuyIns} buy-in request(s)` : "",
    room.pendingSeatClaims ? `${room.pendingSeatClaims} seat claim(s)` : "",
  ].filter(Boolean);

  return shell(
    `Room ${roomId}`,
    `<div class="topbar">
      <h1 style="margin:0">${escapeHtml(room.name ?? "Untitled table")} <code>${escapeHtml(room.roomId)}</code></h1>
      <span class="meta">${back}${watch}</span>
    </div>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta">Banker: ${escapeHtml(room.bankerName ?? "none")}${room.practice ? " &middot; practice table" : ""}${
      room.hasPassword ? " &middot; password protected" : ""
    }${room.feltWatermark ? ` &middot; felt reads &ldquo;${escapeHtml(room.feltWatermark)}&rdquo;` : ""} &middot; last active ${escapeHtml(
      formatStamp(room.lastActivityAt)
    )}</p>
    <div class="tiles">${tiles}</div>
    ${pending.length ? `<p class="warn">Waiting on the banker: ${escapeHtml(pending.join(", "))}.</p>` : ""}
    ${orphans}

    <h1>Seats (${room.seats.length})</h1>
    <table>
      <thead><tr><th>Name</th><th>Role</th><th>Presence</th><th>Chips</th><th></th><th>Player ID</th></tr></thead>
      <tbody>${seatRows}</tbody>
    </table>

    <h1>Connections (${connections.length})</h1>
    ${
      !hasDb
        ? '<p class="meta">This deploy has no database, so connections are not recorded. Rooms live in memory only.</p>'
        : connections.length === 0
          ? '<p class="meta">No connections recorded for this room.</p>'
          : `<p class="meta">Every socket ever opened against this room. Addresses are kept until the room is
             deleted &mdash; the Privacy page says so.</p>
            <table>
              <thead><tr><th>Player ID</th><th>IP</th><th>Connected</th><th>Last seen</th><th>User agent</th></tr></thead>
              <tbody>${connectionRows}</tbody>
            </table>`
    }

    <h1>Chip corrections (${room.ledger.length})</h1>
    ${
      room.ledger.length === 0
        ? '<p class="meta">No chips have moved outside of play at this table.</p>'
        : `<p class="meta">Money that moved without a hand being played. Newest first; the same list the banker
           sees in their own drawer.</p>
          <table>
            <thead><tr><th>When</th><th>What</th><th>Player</th><th>By</th><th>Chips</th><th>Note</th></tr></thead>
            <tbody>${ledgerRows}</tbody>
          </table>`
    }

    <h1>Rounds (${room.roundHistory.length})</h1>
    ${
      room.roundHistory.length === 0
        ? '<p class="meta">No completed rounds.</p>'
        : `<p class="meta">Newest first, capped at the last 200 the room keeps.</p>
          <table>
            <thead><tr><th>Round</th><th>Finished</th><th>Hands</th><th>Result</th></tr></thead>
            <tbody>${historyRows}</tbody>
          </table>`
    }`,
    false
  );
}

export interface ProtectionsDeps {
  login: AdminLoginSnapshot;
  /** Absent when no WS server was wired in (every test that builds a bare
   *  HTTP server). Three of the four limiters live there, so the page says so
   *  rather than rendering four zeroes that look like a quiet night. */
  ws?: ProtectionSnapshot;
  query: string;
  refresh: boolean;
}

const PROTECTION_LABELS: Record<ProtectionKind, string> = {
  connections: "Sockets per IP",
  messages: "Messages per socket",
  roomCreates: "Tables created per IP",
  practiceCreates: "Practice tables per IP",
};

/**
 * The four throttles, live.
 *
 * Every number here is read off the same map or counter the limiter itself
 * consults, so there is no second copy that could disagree with what is being
 * enforced. The limits come from the module constants for the same reason: a
 * remembered limit next to a live count is exactly the disconnected control
 * this panel exists not to have.
 *
 * The rejection counters are cumulative since boot and are the point of the
 * page. The maps hold only what is happening right now, so without them a
 * connection refused an hour ago is indistinguishable from a quiet hour.
 */
export function renderProtectionsPage({ login, ws, query, refresh }: ProtectionsDeps): string {
  const act = (path: string) => `${path}${query}`;
  // formatUptime, not formatIdle: these are both durations that spend most of
  // their life under a minute, and formatIdle's "just now" renders as "just
  // now ago" and "just now left". Caught by reading the page, not the code.
  const since = (ms: number) => (ms > 0 ? `${formatUptime(Date.now() - ms)} ago` : "never");
  const remaining = (resetAt: number) => `${formatUptime(Math.max(resetAt - Date.now(), 0))} left`;

  const kindRows = (ws?.kinds ?? [])
    .map(
      (k) => `<tr>
        <td>${escapeHtml(PROTECTION_LABELS[k.kind])}</td>
        <td>${k.limit}${k.windowMs ? ` <span class="meta">per ${Math.round(k.windowMs / 1000)}s</span>` : ""}</td>
        <td class="${k.rejected > 0 ? "warn" : ""}">${k.rejected}</td>
        <td>${escapeHtml(since(k.lastAt))}${k.lastIp ? ` <span class="meta"><code>${escapeHtml(k.lastIp)}</code></span>` : ""}</td>
      </tr>`
    )
    .join("\n");

  const connRows = (ws?.connectionsByIp ?? [])
    .map((c) => `<tr><td><code>${escapeHtml(c.ip)}</code></td><td>${c.count}</td></tr>`)
    .join("\n");

  const windowRows = (ws?.createWindows ?? [])
    .map(
      (w) => `<tr>
        <td><code>${escapeHtml(w.ip)}</code></td>
        <td>${w.kind === "practiceCreates" ? "practice" : "real"}</td>
        <td>${w.count}</td>
        <td>${escapeHtml(remaining(w.resetAt))}</td>
      </tr>`
    )
    .join("\n");

  const loginRows = login.ips
    .map(
      (row) => `<tr>
        <td><code>${escapeHtml(row.ip)}</code></td>
        <td class="${row.blocked ? "bad" : ""}">${row.count}${row.blocked ? " &middot; blocked" : ""}</td>
        <td>${escapeHtml(remaining(row.resetAt))}</td>
      </tr>`
    )
    .join("\n");

  return shell(
    "Protections",
    `<div class="topbar">
      <h1 style="margin:0">Protections</h1>
      <span class="meta">
        <a href="${act("/admin")}">&larr; panel</a>
        &middot; <a href="${act(refresh ? "/admin/protections?refresh=0" : "/admin/protections")}">${
          refresh ? "stop auto-refresh" : "start auto-refresh"
        }</a>
      </span>
    </div>
    <p class="meta">Counts are cumulative since the server started, and reset with it. The limits shown are
    the ones in force right now &mdash; read from the same constants the limiters check, not from a copy.
    Changing one is still a code change.</p>

    <h1>Rejections</h1>
    ${
      ws
        ? `<table>
            <thead><tr><th>Protection</th><th>Limit</th><th>Rejected</th><th>Last</th></tr></thead>
            <tbody>${kindRows}</tbody>
          </table>
          <p class="meta">Tracking ${ws.trackedIps.connections} connected address(es),
          ${ws.trackedIps.roomCreates} inside a table-creation window and ${ws.trackedIps.practiceCreates}
          inside a practice one.</p>`
        : '<p class="meta">No WebSocket server is wired into this panel, so its three throttles cannot be read here.</p>'
    }

    <h1>Admin sign-in</h1>
    <div class="tiles">
      ${tile("wrong credentials", login.failures, login.failures > 0 ? "warn" : "")}
      ${tile("requests blocked", login.blocked, login.blocked > 0 ? "bad" : "")}
      ${tile("last attempt", since(login.lastAt))}
      ${tile("limit", `${login.limit} / ${Math.round(login.windowMs / 60000)}m`)}
    </div>
    <p class="meta">A wrong password and a wrong token count the same. ${login.tracked} address(es) tracked;
    one is forgotten when its window rolls over.${
      login.lastIp ? ` The last was <code>${escapeHtml(login.lastIp)}</code>.` : ""
    }</p>
    ${
      login.ips.length === 0
        ? '<p class="meta">No failed sign-ins inside the current window.</p>'
        : `<table>
            <thead><tr><th>IP</th><th>Failures</th><th>Window</th></tr></thead>
            <tbody>${loginRows}</tbody>
          </table>`
    }

    ${
      ws
        ? `<h1>Open sockets by IP</h1>
          ${
            connRows
              ? `<table><thead><tr><th>IP</th><th>Sockets</th></tr></thead><tbody>${connRows}</tbody></table>
                 <p class="meta">One player normally holds one socket. A household, or everyone arriving
                 through the same tunnel, can legitimately hold many &mdash; which is why the cap is high.</p>`
              : '<p class="meta">Nobody is connected.</p>'
          }
          <h1>Open creation windows</h1>
          ${
            windowRows
              ? `<table><thead><tr><th>IP</th><th>Kind</th><th>Created</th><th>Window</th></tr></thead><tbody>${windowRows}</tbody></table>`
              : '<p class="meta">No table has been created recently enough to still be inside a window.</p>'
          }`
        : ""
    }`,
    refresh
  );
}
