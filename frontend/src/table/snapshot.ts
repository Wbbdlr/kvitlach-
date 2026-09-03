import { RoundState, Turn } from "../types";
import { cardImages, fullName, statusDisplay, totalDisplay } from "./selectors";
import { STAGE_HEIGHT, STAGE_WIDTH, seatPositions } from "./layout";

// A shareable picture of the table as it stands, drawn onto a canvas rather
// than rasterized off the DOM.
//
// The obvious route was html2canvas over .felt-table. Two reasons it isn't:
// the stage is a `transform: scale()` surface and DOM rasterizers handle a
// scaled ancestor badly (offset and blurred, then fought forever), and it
// would be a dependency this project has a standing rule against adding. The
// less obvious reason is the one that actually settles it: a rasterizer copies
// whatever pixels are there, and "what is on screen" is not the same question
// as "what is safe to put in a group chat". Drawing it deliberately means the
// hole card is concealed here because THIS code concealed it, not because it
// happened to be face-down in the DOM at the time.
//
// Positions come from layout.ts -- the same seatPositions() the felt itself
// uses, not a second set of coordinates that would drift the first time a seat
// moved. What IS genuinely duplicated is the painting (plate fills, pill radii,
// the felt gradient), which lives in index.css and cannot be read from here.
// That is the real cost of this approach and it is worth naming rather than
// discovering: a new felt colour has to be added in two places, or the
// snapshot quietly keeps drawing the old one.

const BG = "#0b1a12";
const FELT_EDGE = "rgba(230, 164, 75, 0.55)";
const PLATE = "rgba(247, 243, 234, 0.94)";
const PLATE_INK = "#1f2937";
const PLATE_SUB_INK = "#5d5139";
const PILL_BG = "rgba(10, 20, 14, 0.72)";
const PILL_INK = "#e7ede6";
const GOLD = "#e6a44b";
const MUTED = "#9aa79c";
const BUST = "#f0b4b4";

const CARD_W = 46;
const CARD_H = 70;
// Cards overlap here for the same reason they overlap on the felt: a seven-card
// hand laid out flat is wider than the seat it belongs to.
const CARD_STEP = 26;

export interface SnapshotOptions {
  turns: Turn[];
  bankerTurn?: Turn;
  viewerId?: string;
  roundState?: RoundState;
  roomName: string;
  roundNumber?: number;
  bankerWallet?: number;
  takenAt?: Date;
}

// Same-origin PNGs (see cardImages), so nothing here taints the canvas and
// toBlob keeps working. Loaded once per snapshot and reused across seats -- a
// full table draws the same face several times.
async function loadCards(names: string[]): Promise<Map<string, HTMLImageElement>> {
  const unique = [...new Set(names)];
  const entries = await Promise.all(
    unique.map(
      (name) =>
        new Promise<[string, HTMLImageElement] | null>((resolve) => {
          const src = cardImages[name];
          if (!src) return resolve(null);
          const img = new Image();
          img.onload = () => resolve([name, img]);
          // A missing face must not lose the whole snapshot -- it draws as a
          // back instead, and everything else in the picture survives.
          img.onerror = () => resolve(null);
          img.src = src;
        })
    )
  );
  return new Map(entries.filter(Boolean) as [string, HTMLImageElement][]);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pill(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, ink: string, bold = false): number {
  ctx.font = `${bold ? "700" : "600"} 15px "Segoe UI", system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = PILL_BG;
  roundRect(ctx, cx - w / 2, y, w, 24, 12);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y + 13);
  return 24;
}

function nameplate(ctx: CanvasRenderingContext2D, cx: number, y: number, name: string, sub?: string): number {
  ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
  const nameW = ctx.measureText(name).width;
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
  const subW = sub ? ctx.measureText(sub).width : 0;
  const w = Math.max(nameW, subW) + 26;
  const h = sub ? 44 : 30;
  ctx.fillStyle = PLATE;
  roundRect(ctx, cx - w / 2, y, w, h, 9);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = PLATE_INK;
  ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(name, cx, y + 15);
  if (sub) {
    ctx.fillStyle = PLATE_SUB_INK;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(sub, cx, y + 32);
  }
  return h;
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  cards: Turn["cards"],
  images: Map<string, HTMLImageElement>,
  cx: number,
  y: number,
  hideFirst: boolean
): number {
  if (cards.length === 0) return 0;
  const width = CARD_W + (cards.length - 1) * CARD_STEP;
  let x = cx - width / 2;
  cards.forEach((card, i) => {
    const img = hideFirst && i === 0 ? undefined : images.get(card.name);
    if (img) {
      ctx.drawImage(img, x, y, CARD_W, CARD_H);
    } else {
      // Face-down, or a face that failed to load. Same treatment on purpose:
      // in both cases the honest thing to draw is "a card you cannot see".
      ctx.fillStyle = "#1e3a5f";
      roundRect(ctx, x, y, CARD_W, CARD_H, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(230, 164, 75, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    x += CARD_STEP;
  });
  return CARD_H;
}

function inkFor(value: string, busted: boolean): string {
  if (busted) return BUST;
  return /^\d/.test(value) ? PILL_INK : MUTED;
}

/**
 * Draws the table and hands back a PNG blob.
 *
 * Concealment routes through totalDisplay -- the same function the felt uses --
 * so a snapshot can never show more than the person taking it could already
 * see. Someone taking one mid-round and sending it to a player still deciding
 * their hand is the exact leak that matters here, and this closes it by
 * construction rather than by remembering to check.
 */
export async function renderSnapshot(opts: SnapshotOptions): Promise<Blob | null> {
  const { turns, bankerTurn, viewerId, roundState, roomName, roundNumber, bankerWallet } = opts;
  const canvas = document.createElement("canvas");
  // Fixed 2x, deliberately not devicePixelRatio: the file should not come out
  // sharper or softer depending on whose phone took it.
  const dpr = 2;
  canvas.width = STAGE_WIDTH * dpr;
  canvas.height = STAGE_HEIGHT * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  const seatTurns = turns.filter((t) => t.player.type !== "admin");
  const allCards = [...seatTurns, ...(bankerTurn ? [bankerTurn] : [])].flatMap((t) => t.cards.map((c) => c.name));
  const images = await loadCards(allCards);

  const bg = ctx.createRadialGradient(STAGE_WIDTH / 2, 300, 80, STAGE_WIDTH / 2, 380, 780);
  bg.addColorStop(0, "#16321f");
  bg.addColorStop(1, BG);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  ctx.strokeStyle = FELT_EDGE;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(STAGE_WIDTH / 2, 400, 540, 250, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = GOLD;
  ctx.font = '800 26px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(roomName, 40, 48);
  ctx.fillStyle = MUTED;
  ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
  const when = (opts.takenAt ?? new Date()).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  ctx.fillText(roundNumber ? `Round ${roundNumber} - ${when}` : when, 40, 72);

  if (bankerTurn) {
    const cx = STAGE_WIDTH / 2;
    const info = totalDisplay(bankerTurn, viewerId, roundState);
    const status = statusDisplay(bankerTurn);
    const isOwner = viewerId === bankerTurn.player.id;
    const resolved = bankerTurn.state !== "pending";
    let y = 108;
    y += nameplate(
      ctx,
      cx,
      y,
      fullName(bankerTurn.player) || "Bank",
      bankerWallet !== undefined ? `BANK $${bankerWallet.toLocaleString()}` : undefined
    );
    y += 8;
    y += drawHand(ctx, bankerTurn.cards, images, cx, y, !isOwner && !resolved);
    y += 8;
    y += pill(ctx, cx, y, `${info.prefix} ${info.value}`, inkFor(info.value, Boolean(info.valueClassName?.includes("rose"))), true);
    if (status.label) {
      y += 6;
      pill(ctx, cx, y, status.label, GOLD);
    }
  }

  const positions = seatPositions(seatTurns.length);
  seatTurns.forEach((turn, i) => {
    const pos = positions[i];
    if (!pos) return;
    const info = totalDisplay(turn, viewerId, roundState);
    const status = statusDisplay(turn);
    const stake = turn.settledBet ?? turn.bet ?? 0;
    let y = pos.y - 90;
    y += nameplate(ctx, pos.x, y, fullName(turn.player) || "Player", stake > 0 ? `$${stake.toLocaleString()}` : "blatt");
    y += 8;
    y += drawHand(ctx, turn.cards, images, pos.x, y, false);
    y += 8;
    y += pill(ctx, pos.x, y, `${info.prefix} ${info.value}`, inkFor(info.value, status.label === "FUTCHED!"), true);
    if (status.label) {
      y += 6;
      pill(ctx, pos.x, y, status.label, status.label === "FUTCHED!" ? BUST : GOLD);
    }
  });

  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
  ctx.fillText("kvitlach.us", STAGE_WIDTH / 2, STAGE_HEIGHT - 26);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export function snapshotFilename(roomName: string, roundNumber?: number, now = new Date()): string {
  // Same rules as the history export's fileSafe(): Windows rejects these
  // outright, and a download that silently fails to save is worse than an
  // ugly filename.
  const safe = (roomName || "Kvitlach").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `Kvitlach - ${safe}${roundNumber ? ` - round ${roundNumber}` : ""} - ${date}.png`;
}
