// A picture of the table exactly as this player is looking at it.
//
// The first version of this DREW the table: a canvas, seat positions read from
// layout.ts, plates and pills painted by hand. It was faithful to the data and
// nothing like the game -- reported as "produces something nothing like the
// game looks", which it was, because a second renderer only ever reproduces
// what someone remembered to reimplement. Felt gradients, card art, fanned
// hands, the dock, the chrome, every one of the measured offsets this codebase
// is full of: all of it would have had to be built twice and kept in step
// forever.
//
// So this rasterizes the real DOM instead, through an SVG <foreignObject>.
// The browser's own engine does the layout and painting, which is what makes
// it a picture of the game rather than a picture of a model of the game.
//
// No dependency. html2canvas reimplements CSS layout in JavaScript and is at
// its worst on exactly what this table is made of -- gradients, box shadows
// and transformed ancestors -- and the stage is a `transform: scale()`
// surface. foreignObject has the opposite profile: perfect fidelity, because
// it IS the engine, in exchange for strictness about external resources.
// Everything it needs is same-origin here (card PNGs in /public, both font
// files), so the strictness costs an inlining pass and nothing else.
//
// Nothing is concealed on the way through, and nothing needs to be: this
// captures the player's own screen, so it cannot show them anything they are
// not already looking at. That is a real simplification over the drawn
// version, which had to route every total through totalDisplay to avoid
// inventing a leak that the screen itself does not have.

const PIXEL_RATIO = 2;

// Same-origin only, and that is the point rather than a limitation: an
// external URL would taint the canvas and make toBlob throw, so anything that
// cannot be inlined must not reach the SVG at all.
async function toDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Every rule the page actually has, as text.
//
// Cross-origin sheets throw on .cssRules and are skipped: the app serves its
// own CSS, so in practice this is the whole of index.css plus Tailwind, and a
// skipped sheet degrades to "that rule did not apply in the picture" rather
// than to a failure.
function collectCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText);
    } catch {
      continue;
    }
  }
  return out.join("\n");
}

// url(...) targets inside the collected CSS -- @font-face sources and any
// background images. Relative and root-relative only; anything absolute is
// left alone, because it is either already a data: URI or something that must
// not be fetched.
async function inlineCssUrls(css: string): Promise<string> {
  const seen = new Map<string, string | null>();
  const urls = new Set<string>();
  const pattern = /url\(\s*(['"]?)(\/[^'")]+|[^'")/][^'")]*)\1\s*\)/g;
  for (const match of css.matchAll(pattern)) {
    const raw = match[2];
    if (raw.startsWith("data:") || raw.startsWith("http")) continue;
    urls.add(raw);
  }
  await Promise.all(
    [...urls].map(async (url) => {
      seen.set(url, await toDataUri(url));
    })
  );
  return css.replace(pattern, (whole, _quote, raw: string) => {
    const replacement = seen.get(raw);
    return replacement ? `url("${replacement}")` : whole;
  });
}

// <img> in the clone, and the form state the DOM keeps in properties rather
// than attributes.
//
// Cloning a node copies attributes, not live properties, so a cloned <input>
// serializes with whatever value the markup had -- for the bet field, empty --
// and a cloned checkbox comes out unchecked no matter what the player set.
// Both would be silently wrong in the picture rather than obviously broken,
// which is worse.
async function inlineNodes(clone: HTMLElement, source: HTMLElement): Promise<void> {
  const images = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      const uri = await toDataUri(src);
      if (uri) img.setAttribute("src", uri);
      // A face that will not load is removed rather than left as a broken
      // image icon in the middle of someone's hand.
      else img.remove();
    })
  );

  const sourceFields = source.querySelectorAll("input, textarea, select");
  const cloneFields = clone.querySelectorAll("input, textarea, select");
  sourceFields.forEach((field, i) => {
    const target = cloneFields[i];
    if (!target) return;
    if (field instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      if (field.type === "checkbox" || field.type === "radio") {
        if (field.checked) target.setAttribute("checked", "checked");
        else target.removeAttribute("checked");
      } else {
        target.setAttribute("value", field.value);
      }
    } else if (field instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
      target.textContent = field.value;
    }
  });
}

export interface CaptureOptions {
  /** Painted behind the capture, since the page's own ground is on <body>. */
  background?: string;
  /**
   * Removed from the clone before rasterizing. For the transient chrome that
   * is on screen only because the player was reaching for this feature -- the
   * overflow menu the Snapshot button lives in on a phone would otherwise be
   * sitting over the table in every picture taken from it.
   */
  omit?: string[];
}

/**
 * Rasterizes an element exactly as rendered, and hands back a PNG blob.
 *
 * Returns null rather than throwing on the paths that are a normal part of
 * life -- a browser that will not rasterize the SVG, an element with no size
 * yet. The caller decides what to say about it.
 */
export async function captureElement(el: HTMLElement, opts: CaptureOptions = {}): Promise<Blob | null> {
  const rect = el.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  if (width === 0 || height === 0) return null;

  const clone = el.cloneNode(true) as HTMLElement;
  for (const selector of opts.omit ?? []) {
    clone.querySelectorAll(selector).forEach((node) => node.remove());
  }
  // The original may be positioned by its own layout; inside the foreignObject
  // it is the only thing there and starts at the origin.
  clone.style.margin = "0";
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const [css] = await Promise.all([inlineCssUrls(collectCss()), inlineNodes(clone, el)]);

  const style = document.createElement("style");
  style.textContent = css;
  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.appendChild(style);
  wrapper.appendChild(clone);

  // XMLSerializer, not innerHTML: the SVG payload has to be well-formed XML,
  // and innerHTML happily emits HTML that is not (unclosed <br>, bare &).
  const markup = new XMLSerializer().serializeToString(wrapper);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject>` +
    `</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
  if (!loaded) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width * PIXEL_RATIO;
  canvas.height = height * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  // The page's ground colour lives on <body>, which is not inside the captured
  // element -- without this the picture comes out on transparency and looks
  // washed out the moment anyone views it on a light background.
  ctx.fillStyle = opts.background ?? "#0b1a12";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

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
