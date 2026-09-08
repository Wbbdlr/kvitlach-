import { AccessControl, GATED_ACTIONS, GatedAction } from "./access.js";
import { DEFAULT_LIMITS, LIMIT_GROUPS, LIMIT_META, LIMIT_KEYS, LimitKey, RuntimeLimits, limitBounds, limitsInGroup } from "./limits.js";
import { BotNames, BOT_NAME_MAX, DEFAULT_BANKER_NAMES, DEFAULT_PLAYER_NAMES } from "./bot-names.js";
import { AboutContent, ABOUT_MAX } from "./about.js";
import { ContactContent, CONTACT_MAX } from "./contact.js";
import { DisclaimerContent, DISCLAIMER_HEADINGS, DISCLAIMER_MAX, DISCLAIMER_SLUGS } from "./disclaimer.js";
import { GameStore } from "./store.js";
import type { AdminRoomDetail } from "./store.js";
import type { ConnectionSummary, LedgerEntry } from "./types.js";
import type { ProtectionKind, ProtectionSnapshot } from "./ws-server.js";
import type { AdminLoginSnapshot } from "./http-server.js";
import type { ClientErrorLog } from "./client-errors.js";
import { CARD_EFFECT_BOUNDS, CARD_EFFECT_DEFAULTS, CHIP_NAMES, ClientConfig, FELT_NAMES, THEME_DEFAULTS, type CardEffectsRecord } from "./client-config.js";
import { AUDIT_ACTIONS, type AuditEntry } from "./audit.js";
import { CHIP_NAMES as FAMILY_CHIPS, FELT_NAMES as FAMILY_FELTS, FamilyProfiles, HOUSE, MAX as FAMILY_MAX, type FamilyProfile } from "./family-profiles.js";
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
/**
 * Builds an admin URL that carries BOTH the session-carrying query and the
 * page's own parameters.
 *
 * The obvious `${path}?refresh=0${query}` is wrong, and was wrong on four
 * pages. `query` is itself "?token=..." for a token-authenticated operator, so
 * that produces `/admin?refresh=0?token=abc` -- the token is swallowed into the
 * value of `refresh`, guard() finds no token, and the page 404s. Worse, it
 * breaks the `?token=` path specifically, which is the escape hatch an operator
 * reaches for when they are locked out of the cookie login.
 *
 * Cookie sessions never saw it: `query` is empty for them, so the naive form
 * happens to produce a correct URL.
 */
function adminUrl(path: string, carried: string, params: Record<string, string> = {}): string {
  const extra = new URLSearchParams(params).toString();
  if (!extra) return `${path}${carried}`;
  return `${path}${carried}${carried ? "&" : "?"}${extra}`;
}

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
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a></p>
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
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a></p>
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
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a></p>
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
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a></p>
    <p class="meta">Each section below replaces that section's built-in bullet points on the public
    <b>/disclaimer</b> page with the plain text you enter here (a blank line starts a new
    paragraph). The heading and which sections exist are fixed by the app, not by this form --
    only the wording of a section you choose to override changes.</p>
    ${sections}`,
    false
  );
}

/** `#rrggbb` to `r, g, b`, for the rgba() in the swatches below. The value is
 *  already known-good -- normalizeHexColor is the only way one gets stored --
 *  so this parses rather than validates. */
function hexTriplet(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
}

/**
 * The win and futch card effects, which used to be literals inside @keyframes.
 *
 * Same own-page-no-refresh reasoning as the other editors. What is different
 * here is the swatch pair: a colour control whose result you cannot see until
 * somebody at a real table happens to hit 21 is exactly the "reports a colour
 * the game does not use" trap this feature was written to avoid.
 *
 * The swatches show the SETTLED state of each effect, not the animation, and
 * that is the honest thing to show for two reasons: it is the state a player
 * actually looks at (the motion is over in half a second, the rim stays for
 * the rest of the round), and it is the state a player with reduced motion or
 * the in-game Motion toggle sees for the whole of it. They are drawn from the
 * SAVED record, never from the form -- this page has no JavaScript, by the
 * same rule as the rest of the panel, so what you see is what is live.
 */
export interface ArchivedRoomSummary {
  roomId: string;
  name?: string;
  bankerName?: string;
  archivedAt: number;
  reason: string;
}

export interface ArchivePageDeps {
  rooms: ArchivedRoomSummary[];
  detail?: {
    roomId: string;
    name?: string;
    bankerName?: string;
    archivedAt: number;
    ledger: LedgerEntry[];
    roundCount: number;
    playerCount: number;
  };
  hasDatabase: boolean;
  retentionDays: number;
  query: string;
}

/**
 * Tables that were force-deleted, and the chip record they left behind.
 *
 * Force-delete used to be total: an operator clearing a stuck table took its
 * ledger with it, and that ledger is the only account of who paid whom. The
 * Game ID still frees up -- that is what deleting is for -- but the record now
 * outlives it.
 *
 * Read-only by construction. There is no un-archive and no restore button:
 * putting a room back would mean reviving sessions, timers and a round that
 * has been dead for days, and the question this page answers ("what did that
 * table look like when it ended") does not need one.
 */
export function renderArchivePage({ rooms, detail, hasDatabase, retentionDays, query }: ArchivePageDeps): string {
  const act = (path: string) => `${path}${query}`;

  const rows = rooms
    .map(
      (r) => `<tr>
        <td><a href="${adminUrl("/admin/archive", query, { roomId: r.roomId })}"><code>${escapeHtml(r.roomId)}</code></a></td>
        <td>${escapeHtml(r.name ?? "-")}</td>
        <td>${escapeHtml(r.bankerName ?? "-")}</td>
        <td class="meta">${escapeHtml(formatStamp(r.archivedAt))}</td>
        <td class="meta">${escapeHtml(r.reason)}</td>
      </tr>`
    )
    .join("\n");

  const ledgerRows = (detail?.ledger ?? [])
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

  return shell(
    "Deleted tables",
    `<div class="topbar">
      <h1 style="margin:0">Deleted tables</h1>
      <span class="meta"><a href="${act("/admin")}">&larr; panel</a></span>
    </div>

    ${
      !hasDatabase
        ? `<p class="meta">This server has no database configured, so nothing is archived and a deleted table
           is genuinely gone. Everything else here is in memory too, by the same choice.</p>`
        : ""
    }

    ${
      detail
        ? `<fieldset>
            <legend>${escapeHtml(detail.roomId)}${detail.name ? ` &middot; ${escapeHtml(detail.name)}` : ""}</legend>
            <p class="meta">Banker: ${escapeHtml(detail.bankerName ?? "unknown")} &middot;
            ${detail.playerCount} player(s) at the end &middot; ${detail.roundCount} round(s) played &middot;
            deleted ${escapeHtml(formatStamp(detail.archivedAt))}</p>
            <h1>Chip corrections (${detail.ledger.length})</h1>
            ${
              detail.ledger.length === 0
                ? '<p class="meta">No chips were ever adjusted at this table.</p>'
                : `<table>
                    <thead><tr><th>When</th><th>What</th><th>Player</th><th>By</th><th>Amount</th><th>Note</th></tr></thead>
                    <tbody>${ledgerRows}</tbody>
                  </table>`
            }
            <p class="meta"><a href="${act("/admin/archive")}">&larr; all deleted tables</a></p>
          </fieldset>`
        : rooms.length === 0
          ? '<p class="meta">Nothing archived. A table appears here when an operator force-deletes it.</p>'
          : `<table>
              <thead><tr><th>Game ID</th><th>Name</th><th>Banker</th><th>Deleted</th><th>Why</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
    }

    <p class="meta">Kept for ${retentionDays} days, then deleted permanently &mdash; the window is
    &ldquo;Deleted tables kept for&rdquo; under Gameplay timing, and the Privacy page tells players about it,
    so changing one means changing the other. The Game ID itself is freed the moment the table is deleted and
    can be handed out again; this is the record, not the table.</p>
    <p class="meta">There is deliberately no restore: bringing a room back would mean reviving sessions,
    timers and a round that has been dead for days.</p>`,
    false
  );
}

/**
 * The family looks, and the links that open them.
 *
 * One form per family plus one empty form to add another, rather than a single
 * big textarea: each field has its own bounds and its own meaning, and a JSON
 * blob in a box is how somebody eventually saves a felt name that does not
 * exist.
 *
 * The house look is not editable here. It is expressed in code as profile zero
 * (family-profiles.ts's HOUSE) precisely so that no part of this app has to ask
 * "is this a family table" -- and an operator editing the shipped defaults from
 * this page would be editing what every unstamped table in the world looks
 * like, which is the appearance page's job and already has its own controls.
 */
export function renderFamiliesEditor({
  families,
  appUrl,
  query,
  notice,
}: {
  families: FamilyProfiles;
  appUrl?: string;
  query: string;
  notice?: string;
}): string {
  const act = (path: string) => `${path}${query}`;
  const origin = (appUrl ?? "https://kvitlach.us").replace(/\/+$/, "");

  const field = (
    p: Partial<FamilyProfile>,
    key: keyof FamilyProfile,
    label: string,
    hint: string,
    max: number,
    placeholder = ""
  ) => `<p><label>${escapeHtml(label)}<br />
      <input type="text" name="${key}" maxlength="${max}" style="width:100%"
        placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(String(p[key] ?? ""))}" /></label>
      <span class="meta">${hint}</span></p>`;

  const select = (p: Partial<FamilyProfile>, key: "felt" | "chip", label: string, options: readonly string[]) =>
    `<div class="row"><label style="min-width:7rem">${escapeHtml(label)}</label>
      <select name="${key}">${options
        .map((o) => `<option value="${o}"${(p[key] ?? HOUSE[key]) === o ? " selected" : ""}>${o}</option>`)
        .join("")}</select></div>`;

  const form = (p: Partial<FamilyProfile>, isNew: boolean) => {
    const slug = p.slug ?? "";
    return `<fieldset>
      <legend>${isNew ? "Add a family" : escapeHtml(p.name || slug)}</legend>
      ${
        isNew
          ? ""
          : `<p class="meta">Their link: <code>${escapeHtml(`${origin}/m/${slug}`)}</code> &mdash; paste that
             into the family's group chat and there is nothing for anyone to type.</p>`
      }
      <form method="post" action="${act("/admin/families")}">
        ${field(p, "slug", "Web address", `The <code>${escapeHtml(`${origin}/m/`)}</code> part is fixed; this is the rest. Lowercase letters, digits and hyphens.`, FAMILY_MAX.slug, "dov")}
        ${field(p, "name", "Family name", "For this page and for crash reports. Players never see it.", FAMILY_MAX.name, "Dov")}
        ${field(p, "greeting", "Lobby greeting", "Replaces the lobby's own heading. Blank keeps it.", FAMILY_MAX.greeting, "Welcome, Dov Family")}
        ${field(p, "feltPrint", "Print on the felt", "The faint line across the table. Hebrew belongs here, not in the card mark below.", FAMILY_MAX.feltPrint, "משפחת דב קוויטלעך")}
        ${field(p, "cardMark", "Mark on the cards", "Replaces SCHLESINGER on the ace, the 8 and the 12. <b>Latin letters only</b> &mdash; the face this is set in has no Hebrew, so Hebrew here would draw nothing at all. Long names are shrunk to fit rather than refused.", FAMILY_MAX.cardMark, "DOV")}
        ${select(p, "felt", "Felt", FAMILY_FELTS)}
        ${select(p, "chip", "Chips", FAMILY_CHIPS)}
        <p><label>Computer banker's names<br />
          <textarea name="bankerNames" rows="3" style="width:100%"
            placeholder="Blank uses the built-in names">${escapeHtml(p.bankerNames ?? "")}</textarea></label></p>
        <p><label>Computer players' names<br />
          <textarea name="playerNames" rows="4" style="width:100%"
            placeholder="Blank uses the built-in names">${escapeHtml(p.playerNames ?? "")}</textarea></label>
          <span class="meta">One per line or comma separated. Blank falls back to the built-in list, the same
          as the <a href="${act("/admin/bot-names")}">computer player names</a> page.</span></p>
        ${field(p, "accessCode", "Access code to carry", "Only matters while joining or creating is gated by code. Filled in here, the family's link means they are not asked to type it. It is not a password and does not gate anything on its own.", FAMILY_MAX.accessCode)}
        <p>
          <button type="submit" class="save">${isNew ? "Add this family" : "Save"}</button>
          ${
            isNew
              ? ""
              : `<button type="submit" name="remove" value="${escapeHtml(slug)}"
                   onclick="return confirm('Remove this family? Their link stops working. Tables already dealt keep the look they have until they end.');"
                   class="danger">Remove</button>`
          }
        </p>
      </form>
    </fieldset>`;
  };

  const existing = families.list();

  return shell(
    "Families - Kvitlach admin",
    `<h1>Families</h1>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a></p>
    <p class="meta">A family opens their own link once and their device remembers it; any table they host
    is stamped with the look, so everyone who joins sees the same felt and the same cards. A player who has
    picked their own felt keeps it &mdash; a family look never overrules somebody's own choice.</p>
    <p class="meta">Changes reach a browser on its next page load. A table already in play keeps the look it
    was dealt until it ends.</p>

    ${existing.length === 0 ? '<p class="meta">No families yet.</p>' : existing.map((p) => form(p, false)).join("\n")}
    ${form({}, true)}

    <p class="meta">The shipped look is not editable here on purpose: it lives in code as the profile every
    unstamped table already uses, which is what keeps family tables from being a separate code path. To
    change what everyone sees, use <a href="${act("/admin/appearance")}">appearance</a>.</p>`,
    false
  );
}

export interface AuditPageDeps {
  entries: AuditEntry[];
  source: "database" | "memory";
  hasDatabase: boolean;
  retentionDays: number;
  filter: { roomId: string; action: string; actorId: string };
  query: string;
  refresh: boolean;
}

/**
 * The audit trail.
 *
 * Before this, every one of these actions reached console.info and nowhere
 * else, so "who deleted that table" and "who moved those chips" were both
 * unanswerable once the container had been restarted -- which, given the
 * restart is usually what you did about the problem, was most of the time.
 *
 * The source line is not decoration. An entry list read out of this process's
 * own memory covers only since the last restart, and an operator reading a
 * short list needs to know whether that means "nothing happened" or "this
 * server started an hour ago". Every deployment with a database reads the
 * table; the memory case is a server running without one, plus the fallback
 * when a query fails.
 *
 * Details are rendered as JSON rather than prose. They are already small, they
 * differ per action, and a formatter per action would be a place for the
 * display and the record to disagree -- which is the one thing an audit trail
 * may not do.
 */
export function renderAuditPage({
  entries,
  source,
  hasDatabase,
  retentionDays,
  filter,
  query,
  refresh,
}: AuditPageDeps): string {
  const act = (path: string) => `${path}${query}`;
  const tokenValue = query.startsWith("?token=") ? decodeURIComponent(query.slice("?token=".length)) : "";

  const rows = entries
    .map(
      (e) => `<tr>
        <td class="meta" style="white-space:nowrap">${escapeHtml(formatStamp(e.at))}</td>
        <td><code>${escapeHtml(e.action)}</code></td>
        <td><a href="${act(`/admin/rooms/${encodeURIComponent(e.roomId)}`)}"><code>${escapeHtml(e.roomId)}</code></a></td>
        <td class="meta"><code>${escapeHtml(e.actorId)}</code></td>
        <td class="meta"><code>${escapeHtml(JSON.stringify(e.details))}</code></td>
      </tr>`
    )
    .join("\n");

  const options = AUDIT_ACTIONS.map(
    (a) => `<option value="${a}"${filter.action === a ? " selected" : ""}>${a}</option>`
  ).join("");

  return shell(
    "Audit trail",
    `<div class="topbar">
      <h1 style="margin:0">Audit trail</h1>
      <span class="meta">
        <a href="${act("/admin")}">&larr; panel</a>
        &middot; <a href="${adminUrl("/admin/audit", query, refresh ? { refresh: "0" } : {})}">${
          refresh ? "stop auto-refresh" : "start auto-refresh"
        }</a>
      </span>
    </div>

    <form method="get" action="/admin/audit" class="row">
      ${tokenValue ? `<input type="hidden" name="token" value="${escapeHtml(tokenValue)}" />` : ""}
      ${refresh ? "" : '<input type="hidden" name="refresh" value="0" />'}
      <label for="a-room">Game ID</label>
      <input id="a-room" type="text" name="roomId" value="${escapeHtml(filter.roomId)}" placeholder="any" style="width:8rem" />
      <label for="a-action">Action</label>
      <select id="a-action" name="action"><option value="">any</option>${options}</select>
      <label for="a-actor">Actor</label>
      <input id="a-actor" type="text" name="actorId" value="${escapeHtml(filter.actorId)}" placeholder="any" style="width:12rem" />
      <button type="submit" class="save">Filter</button>
      <a class="meta" href="${act("/admin/audit")}">clear</a>
    </form>

    ${
      entries.length === 0
        ? '<p class="meta">Nothing recorded matching this filter.</p>'
        : `<table>
            <thead><tr><th>When</th><th>Action</th><th>Table</th><th>Actor</th><th>Details</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
    }

    <p class="meta">${
      source === "database"
        ? `Read from the database, so this survives restarts. Entries older than ${retentionDays} days are deleted permanently &mdash; the Privacy page tells players that window, so changing it under Gameplay timing means changing that page too.`
        : hasDatabase
          ? "The database could not be read, so this is only what THIS server process has seen since it started. Check the container logs."
          : "This server has no database configured, so this is only what it has seen since it started and none of it survives a restart. Everything else here is in memory too, by the same choice."
    }</p>
    <p class="meta">Actor is a player id, or <code>admin</code> for something done from this panel and
    <code>server</code> for something the server decided on its own, like sweeping an idle seat.</p>`,
    refresh
  );
}

export function renderAppearanceEditor({
  config,
  query,
  notice,
}: {
  config: ClientConfig;
  query: string;
  notice?: string;
}): string {
  const record = config.toRecord();
  const fx = record.cardEffects;
  const theme = record.theme;
  const act = (path: string) => `${path}${query}`;
  const edited = record.updatedAt
    ? new Date(record.updatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "never";

  const num = (name: keyof CardEffectsRecord, label: string, hint: string) => {
    const [min, max] = CARD_EFFECT_BOUNDS[name];
    return `<div class="row">
      <label style="min-width:9rem">${escapeHtml(label)}</label>
      <input type="number" name="${name}" value="${fx[name]}" min="${min}" max="${max}" step="0.01" style="width:6rem" />
      <span class="meta">${min} to ${max} &middot; default ${CARD_EFFECT_DEFAULTS[name]} &middot; ${escapeHtml(hint)}</span>
    </div>`;
  };

  const colour = (name: "winColor" | "futchColor", label: string) =>
    `<div class="row">
      <label style="min-width:9rem">${escapeHtml(label)}</label>
      <input type="color" name="${name}" value="${escapeHtml(fx[name])}" style="width:3.5rem;height:2rem;padding:1px" />
      <span class="meta"><code>${escapeHtml(fx[name])}</code> &middot; default <code>${CARD_EFFECT_DEFAULTS[name]}</code></span>
    </div>`;

  // A scrap of felt to judge a glow against. Judging it on the panel's own
  // near-white would be judging it against a background no player ever sees.
  //
  // The mock card carries a colour on purpose. A plain black-on-white rectangle
  // is achromatic, so saturate() does visibly nothing to it -- the first cut of
  // this swatch showed "keeps colour 0.05" and "keeps colour 1" as identical
  // images, which is exactly the kind of preview that lies. Real card faces are
  // coloured art; the red here stands in for that.
  const swatch = (label: string, scale: number, glow: string, saturate: number, blur: number, alpha: number) =>
    `<div style="text-align:center">
      <div style="background:linear-gradient(160deg,#1b4a6b,#123049);border-radius:8px;padding:1.6rem 1.9rem">
        <div style="width:44px;height:62px;margin:0 auto;border-radius:5px;background:#fdfcf7;border:1px solid #d8d2c2;
                    display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:600;color:#b8342f;
                    transform:scale(${scale});
                    filter:drop-shadow(0 4px 7px rgba(0,0,0,0.4)) drop-shadow(0 0 ${blur}px rgba(${hexTriplet(glow)}, ${alpha})) saturate(${saturate})">21</div>
      </div>
      <div class="meta" style="margin-top:0.35rem">${escapeHtml(label)}</div>
    </div>`;

  return shell(
    "Appearance - Kvitlach admin",
    `<h1>Appearance</h1>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta"><a href="${act("/admin")}">&larr; Back to the admin panel</a></p>

    <fieldset>
      <legend>Live right now</legend>
      <div class="grid3" style="justify-content:center;margin:0.5rem 0 0.25rem">
        ${swatch("Won a hand", fx.winScaleRest, fx.winColor, 1, 5, 0.5)}
        ${swatch("Went over 21", fx.futchScale, fx.futchColor, fx.futchSaturate, 4, 0.55)}
      </div>
      <p class="meta">Both cards are drawn at the size and colour they settle at and stay for the rest
      of the round &mdash; not the half-second of movement on the way there, which is also what a player
      with reduced motion or the in-game Motion switch sees for the whole effect. Saved values only:
      the panel runs no JavaScript, so this is what players are being shown, not a guess at what the
      boxes below would do.</p>
    </fieldset>

    <fieldset>
      <legend>House felt and chips</legend>
      <p class="meta">What a player sees who has never picked their own. <b>A player's own choice always
      wins</b> &mdash; somebody who chose burgundy in December opens their table in burgundy however this is
      set, and changing it here never overwrites anybody. It reaches a browser that has never chosen: a
      first visit, a new device, a cleared cache.</p>
      <form method="post" action="${act("/admin/appearance")}">
        <div class="row">
          <label for="t-felt" style="min-width:9rem">Felt</label>
          <select id="t-felt" name="felt">${FELT_NAMES.map(
            (name) => `<option value="${name}"${theme.felt === name ? " selected" : ""}>${name}</option>`
          ).join("")}</select>
          <span class="meta">default ${THEME_DEFAULTS.felt}</span>
        </div>
        <div class="row">
          <label for="t-chip" style="min-width:9rem">Chip chrome</label>
          <select id="t-chip" name="chip">${CHIP_NAMES.map(
            (name) => `<option value="${name}"${theme.chip === name ? " selected" : ""}>${name}</option>`
          ).join("")}</select>
          <span class="meta">default ${THEME_DEFAULTS.chip}</span>
        </div>
        <p><button type="submit" class="save">Save the house theme</button></p>
      </form>
    </fieldset>

    <fieldset>
      <legend>Winning hand</legend>
      <p class="meta">The card grows, glows, and settles slightly larger than its neighbours for the
      rest of the round. Last changed: ${edited}.</p>
      <form method="post" action="${act("/admin/appearance")}">
        ${colour("winColor", "Glow colour")}
        ${num("winScalePeak", "Grows to", "the peak of the pop, halfway through")}
        ${num("winScaleRest", "Settles at", "1 sits flush with the other cards")}
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:1rem 0" />
        <p style="font-size:0.7rem;text-transform:uppercase;color:#6b7280;font-weight:600;letter-spacing:0.04em;margin:0">Busted hand</p>
        <p class="meta">Deliberately quieter than the win and in the opposite direction &mdash; losing is
        the common outcome and this fires several times a round.</p>
        ${colour("futchColor", "Rim colour")}
        ${num("futchScale", "Shrinks to", "below 1, and it stays there")}
        ${num("futchSaturate", "Keeps colour", "1 is untouched, 0 is grey")}
        <p style="margin-top:1rem">
          <button type="submit" class="save">Save</button>
          <button type="submit" name="reset" value="1">Reset to the shipped look</button>
        </p>
      </form>
      <p class="meta">Each range is fixed in code and cannot be widened from here. These animations are
      the only signal that is not text telling a player their hand won or busted, so the ends stop short
      of "no visible difference" &mdash; and a bust must not end up looking like an Eleveroon reject,
      which is full grey with no rim at all.</p>
      <p class="meta">Players pick this up on their next page load; a table already open keeps the old
      look until it reloads. Nothing needs rebuilding or redeploying.</p>
    </fieldset>`,
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

  // One form per field, driven off LIMIT_META so a key cannot appear here
  // without a label and bounds, or be renamed in one place and not the other.
  // Per-field rather than one big Save because these are twenty-one numbers on
  // an auto-refreshing page: a single form would let a refresh land mid-edit
  // and post twenty stale values along with the one that was being changed.
  const limitRow = (key: LimitKey) => {
    const [min, max] = limitBounds(key);
    const meta = LIMIT_META[key];
    return `<form method="post" action="${act("/admin/limits")}" class="row">
      <label for="l-${key}" style="min-width:14rem">${escapeHtml(meta.label)}</label>
      <input id="l-${key}" type="number" name="value" value="${limits.get(key)}" min="${min}" max="${max}" step="1" style="width:6rem" />
      <input type="hidden" name="key" value="${key}" />
      <button type="submit" class="save">Set</button>
      <span class="meta">${min}&ndash;${max}${limits.isDefault(key) ? " &middot; default" : ` &middot; default ${DEFAULT_LIMITS[key]}`}${
        meta.note ? `<br />${escapeHtml(meta.note)}` : ""
      }</span>
    </form>`;
  };

  const limitGroups = LIMIT_GROUPS.map(
    (group) => `<fieldset>
      <legend>${escapeHtml(group.title)}</legend>
      <p class="meta">${escapeHtml(group.blurb)}</p>
      ${limitsInGroup(group.id).map(limitRow).join("")}
    </fieldset>`
  ).join("");

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
        <a href="${adminUrl("/admin", query, refresh ? { refresh: "0" } : {})}">${refresh ? "stop auto-refresh" : "start auto-refresh"}</a>
        &middot; <a href="${act("/admin/protections")}">protections</a>
        &middot; <a href="${act("/admin/errors")}">client errors</a>
        &middot; <a href="${act("/admin/audit")}">audit</a>
        &middot; <a href="${act("/admin/archive")}">deleted tables</a>
        &middot; <a href="${act("/admin/families")}">families</a>
        &middot; <a href="${act("/admin/appearance")}">appearance</a>
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

    ${limitGroups}
    <p class="meta">Every value above is read at the moment it is used, not at startup, so what is in the box
    is what is running. Lowering a capacity cap never evicts anyone &mdash; it only refuses the next one over
    the line.</p>
    <form method="post" action="${act("/admin/limits")}" class="row"
      onsubmit="return confirm('Reset every capacity, protection and timing value to its default?');">
      <input type="hidden" name="reset" value="1" />
      <button type="submit">Reset all to defaults</button>
    </form>

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
      passed its idle window and was reaped. Its Game ID is free for reuse.</p>
      <p class="meta">If it was force-deleted from here, its ledger was kept:
      <a href="${adminUrl("/admin/archive", query, { roomId })}">look for it under deleted tables</a>.
      A table that simply aged out leaves no archive &mdash; nobody decided to end it, and nothing was
      taken from anyone.</p>`,
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
        &middot; <a href="${adminUrl("/admin/protections", query, refresh ? { refresh: "0" } : {})}">${
          refresh ? "stop auto-refresh" : "start auto-refresh"
        }</a>
      </span>
    </div>
    <p class="meta">Counts are cumulative since the server started, and reset with it. The limits shown are
    the ones in force right now &mdash; read from the same settings the limiters check, not from a copy of
    them. Change any of them under Protections on the <a href="${act("/admin")}">panel</a>; it takes effect
    on the next request, with no restart.</p>

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

export interface ClientErrorsDeps {
  snapshot: ReturnType<ClientErrorLog["snapshot"]>;
  query: string;
  refresh: boolean;
  notice?: string;
}

/**
 * Render errors reported by players' browsers.
 *
 * The whole value here is that it exists at all: before this, a crash reached
 * console.error on somebody's phone and stopped there, which is why a reported
 * white-page crash survived roughly 150 attempts to reproduce it.
 *
 * Every field on this page is text a stranger POSTed to an unauthenticated
 * endpoint. It goes through escapeHtml like everything else in this file, and
 * the stack is rendered inside <pre> rather than being parsed or linkified --
 * there is nothing here that treats the content as anything but a string.
 *
 * Repeats are counted rather than listed, so the page reads as a list of
 * distinct failures. Clearing is a deliberate button rather than an expiry:
 * after a fix ships, an operator wants "is it still happening", and that
 * question is only answerable against a list they zeroed themselves.
 */
export function renderClientErrorsPage({ snapshot, query, refresh, notice }: ClientErrorsDeps): string {
  const act = (path: string) => `${path}${query}`;
  const { reports, dropped, limit, windowMs, capacity } = snapshot;

  const rows = reports
    .map(
      (r) => `<tr>
        <td>${escapeHtml(formatStamp(r.at))}<div class="meta">${escapeHtml(formatIdle(Date.now() - r.at))} ago</div></td>
        <td>${escapeHtml(r.message)}${
          r.stack
            ? `<details><summary class="meta">stack</summary><pre style="white-space:pre-wrap;font-size:0.75rem;margin:0.4rem 0 0">${escapeHtml(
                r.stack
              )}</pre></details>`
            : ""
        }</td>
        <td>${escapeHtml(r.route ?? "-")}</td>
        <td>${escapeHtml(r.version ?? "-")}</td>
        <td class="${r.count > 1 ? "warn" : ""}">${r.count}</td>
        <td class="meta"><code>${escapeHtml(r.ip)}</code><div>${escapeHtml((r.userAgent ?? "").slice(0, 60))}</div></td>
      </tr>`
    )
    .join("\n");

  return shell(
    "Client errors",
    `<div class="topbar">
      <h1 style="margin:0">Client errors</h1>
      <span class="meta">
        <a href="${act("/admin")}">&larr; panel</a>
        &middot; <a href="${adminUrl("/admin/errors", query, refresh ? { refresh: "0" } : {})}">${
          refresh ? "stop auto-refresh" : "start auto-refresh"
        }</a>
      </span>
    </div>
    ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}
    <p class="meta">What actually crashed in a player's browser, reported by the app itself. Held in memory
    only &mdash; the last ${capacity} distinct messages, cleared by a restart. Identical messages are counted
    rather than repeated, so a crash loop is one row.</p>

    ${
      reports.length === 0
        ? '<p class="meta">Nothing reported since the last restart.</p>'
        : `<table>
            <thead><tr><th>When</th><th>Error</th><th>Route</th><th>Version</th><th>Seen</th><th>From</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <form method="post" action="${act("/admin/errors/clear")}"
                onsubmit="return confirm('Clear all ${reports.length} report(s)? This is how you check whether a fix worked.');">
            <p><button type="submit" class="danger">Clear the list</button></p>
          </form>`
    }
    <p class="meta">A browser may report at most ${limit} distinct errors per ${Math.round(
      windowMs / 1000
    )}s; ${dropped} report(s) have been refused by that throttle since the last restart. A number climbing
    here usually means one device in a crash loop rather than an attack.</p>`,
    refresh
  );
}
