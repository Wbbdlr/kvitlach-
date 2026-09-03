// Icon set for the "around the table" redesign — real inline SVGs, no emoji,
// ported verbatim from the verified mockup (scratchpad/build_artifact.py's
// ICONS dict). Deliberately simple primitives (circles, lines, short paths)
// rather than complex bezier art, kept easy to verify by eye.

export type IconName =
  | "bank"
  | "clock"
  | "coins"
  | "skip"
  | "chart"
  | "user-x"
  | "play"
  | "bell"
  | "check"
  | "pencil"
  | "coins-plus"
  | "user-pencil"
  | "download"
  | "door"
  | "music"
  | "speaker"
  | "info"
  | "clipboard"
  | "eye"
  | "users"
  | "book"
  | "list"
  | "link"
  | "share"
  | "thumbs-up"
  | "smile"
  | "thumbs-down"
  | "fire"
  | "wow"
  | "star"
  | "magen"
  | "laugh"
  | "heart"
  | "chevron-up"
  | "chevron-down"
  | "expand"
  | "compress"
  | "bot"
  | "more"
  | "close"
  | "motion"
  | "rotate"
  | "shuffle"
  | "swatch";

// Inner <svg> markup for each icon, static and developer-authored (no user
// data ever flows through this map) — safe to inject verbatim.
const ICON_PATHS: Record<IconName, string> = {
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9"/><path d="M3 21h18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v11.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 11.75c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  skip: '<path d="M6 5l11 7-11 7V5z"/><path d="M18 5v14"/>',
  chart: '<path d="M5 21V10"/><path d="M12 21V4"/><path d="M19 21v-8"/>',
  "user-x": '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4.4 3.1-8 7-8s7 3.6 7 8"/><path d="M17 8l4.5 4.5M21.5 8L17 12.5"/>',
  play: '<path d="M6 4l13 8-13 8V4z"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4.5 1.8 5.5 1.8 5.5H4.7S6.5 14.5 6.5 10z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.5"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14 7l3 3"/>',
  // "Ask for more chips" and "change my name". Both asked for as the plain
  // icon plus a second glyph saying what you are doing TO it -- a stack of
  // chips alone is "money", a pencil alone is "edit", and neither says which
  // of the two menus a button opens.
  //
  // Composed rather than drawn as new art: the stack is `coins` and the head
  // is `user-x`'s, shifted and shrunk to leave a corner free. So the pair
  // still reads as the same family, and a change to either base is one edit.
  // The stack stays CLOSED. A first pass clipped its right side to make room
  // for the plus, and at 4x it read as a capital E: an outline that stops
  // short is a different letterform, not a smaller drawing of the same one.
  // The plus sits clear of it in the free corner instead.
  "coins-plus":
    '<ellipse cx="9" cy="5.5" rx="5.5" ry="2"/><path d="M3.5 5.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9"/><path d="M3.5 10c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/><path d="M18.5 15v6M15.5 18h6"/>',
  // Export/save. A tray with an arrow coming down into it -- the standard
  // download idiom, so it needs no label of its own beside one.
  // Snapshot. A camera body with the lens as a plain circle -- at 13px the
  // lens is ~5px across, so anything inside it (a second ring, a highlight)
  // fills in to a dot and the whole glyph reads as a blob. Kept open.
  camera:
    '<path d="M3 8.5h3.2l1.6-2.4h8.4l1.6 2.4H21a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.6"/>',
  download: '<path d="M12 3v11"/><path d="M8 10.5l4 4 4-4"/><path d="M4 16.5v2.2A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2.3-2.3v-2.2"/>',
  "user-pencil":
    '<circle cx="8.5" cy="7" r="3.4"/><path d="M2 20c0-3.9 2.7-7 6.5-7 1 0 1.9.2 2.7.6"/><path d="M13 20h3l6.2-6.2a1.7 1.7 0 0 0-2.4-2.4L13.6 17.6z"/>',
  door: '<path d="M13 4H7a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h6"/><path d="M17 15.5l3.5-3.5L17 8.5"/><path d="M20.5 12H10.5"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  speaker: '<path d="M4 9v6h3.5L13 19V5L7.5 9H4z"/><path d="M16.5 9a5 5 0 0 1 0 6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8h.01"/><path d="M11 11.5h1.3v5"/>',
  clipboard: '<rect x="6" y="4" width="12" height="16.5" rx="2"/><path d="M9 4V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V4"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5 10 6.5 10 6.5-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  users: '<circle cx="8" cy="8.5" r="3.5"/><path d="M2 20c0-3.6 2.7-6.5 6-6.5s6 2.9 6 6.5"/><circle cx="17" cy="9.5" r="3"/><path d="M14.5 14.3c2.6.4 4.5 2.9 4.5 5.7"/>',
  book: '<path d="M12 6.2c-2-1.5-5-2-8-1.2v13.5c3-.8 6-.3 8 1.2 2-1.5 5-2 8-1.2V5c-3-.8-6-.3-8 1.2z"/><path d="M12 6.2v13.5"/>',
  list: '<path d="M8.5 6h13M8.5 12h13M8.5 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
  link: '<path d="M9 15l6-6"/><path d="M10.5 6.5l1-1a4 4 0 1 1 5.6 5.6l-1 1"/><path d="M13.5 17.5l-1 1a4 4 0 1 1-5.6-5.6l1-1"/>',
  share: '<circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="5.5" r="2.3"/><circle cx="18" cy="18.5" r="2.3"/><path d="M8.1 10.8l7.8-4.2"/><path d="M8.1 13.2l7.8 4.2"/>',
  "thumbs-up": '<path d="M7 11v9H4v-9h3z"/><path d="M7 11l2.8-6.6a1.8 1.8 0 0 1 1.7 1.8V10h5.3a2 2 0 0 1 2 2.3l-1.1 5.5a2 2 0 0 1-2 1.7H9a2 2 0 0 1-2-2v-6z"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8 14s1.6 2.3 4 2.3 4-2.3 4-2.3"/><circle cx="9" cy="9.5" r=".9"/><circle cx="15" cy="9.5" r=".9"/>',
  "thumbs-down": '<path d="M7 13V4H4v9h3z"/><path d="M7 13l2.8 6.6a1.8 1.8 0 0 0 1.7-1.8V14h5.3a2 2 0 0 0 2-2.3l-1.1-5.5a2 2 0 0 0-2-1.7H9a2 2 0 0 0-2 2v6z"/>',
  fire: '<path d="M12 3s-4.5 4.5-4.5 9a4.5 4.5 0 0 0 9 0c0-1.7-.8-2.6-.8-2.6s-.2 1.6-1.4 2c1-2.3-.5-4-2.3-8.4z"/>',
  wow: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.7" cy="10" r=".9"/><circle cx="15.3" cy="10" r=".9"/><circle cx="12" cy="15" r="2"/>',
  // Reaction glyph. Kept for the reaction row; the Eleveroon marks use `magen`
  // -- a five-point star was never the right symbol for this game's one
  // signature move.
  star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z"/>',
  // Magen David, for the Eleveroon marks. FILLED rather than stroked, unlike
  // every other icon here, and the reason is size: this renders at 8px in a
  // seat plate's corner badge, where two overlapping outlined triangles at
  // 1.8 stroke are a smudge. A solid hexagram is still unmistakably itself at
  // that size. The two triangles are one path with nonzero fill, so the
  // centre reads solid rather than as a hollow hexagon -- interlacing is
  // detail that only survives at sizes this never renders at.
  magen:
    '<path fill="currentColor" stroke="none" d="M12 3.2l7.36 12.75H4.64zM12 20.8L4.64 8.05h14.72z"/>',
  laugh: '<circle cx="12" cy="12" r="8.5"/><path d="M7.5 13.5s2 3 4.5 3 4.5-3 4.5-3"/><path d="M8 9.3l2 1.4M16 9.3l-2 1.4"/>',
  heart: '<path d="M12 19.5s-7.5-4.3-7.5-10a4.5 4.5 0 0 1 7.5-3.4 4.5 4.5 0 0 1 7.5 3.4c0 5.7-7.5 10-7.5 10z"/>',
  "chevron-up": '<path d="M5 15l7-7 7 7"/>',
  "chevron-down": '<path d="M5 9l7 7 7-7"/>',
  expand: '<path d="M9 4H4v5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M15 20h5v-5"/>',
  compress: '<path d="M4 9h5V4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M20 15h-5v5"/>',
  // An old-fashioned CRT computer -- boxy monitor, stalk, base -- marking the
  // bots at a practice table. Replaces a CPU-chip glyph (square + 8 pins) that
  // was unreadable at the 9px it rendered at: the pins merged into the body and
  // it read as a circle or a star, which is how it was reported. A monitor
  // silhouette survives the size because it is one solid shape, not eight thin
  // ticks -- the same reasoning as the `motion` icon's own three attempts.
  bot: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9.5 16v2.5M14.5 16v2.5"/><path d="M7 18.5h10"/>',
  // Three dots -- the universal "the rest of the controls are in here"
  // affordance. Solid circles rather than an ellipsis glyph so it holds up
  // at the 15px it renders in the chrome row.
  more: '<circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  // Third icon tried here. Straight equal-length lines (v1) read as a menu
  // button; a comet -- dot on a curved trail (v2) -- and wind lines (v3)
  // both still didn't land at 13px in the chrome-top row (checked in situ,
  // not just blown up in a mockup, after v3 shipped and still missed). A
  // 4-point sparkle sidesteps trying to depict motion literally -- it's the
  // same "effects/animate" shorthand a lot of software already uses (Notion,
  // editing tools), so it doesn't need to read as a trajectory or a gust of
  // wind at a glance, just as "something here is animated."
  motion: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"/>',
  // A portrait phone outline plus a curved arrow sweeping it toward
  // landscape -- used only by the rotate-hint banner (see index.css's
  // .k-rotate-hint), so it never needed to survive at chrome-top's ~13px.
  rotate:
    '<rect x="6.5" y="3" width="9" height="15" rx="1.8"/><path d="M17.5 7.5a6.5 6.5 0 0 1-5.8 10.4"/><path d="M19.3 4.8l-.7 3.2-3.2-.9"/>',
  // Classic crossed-strands shuffle glyph -- used only by the practice-mode
  // reshuffle chip (TableRoot.tsx).
  shuffle:
    '<path d="M3 7h4l12 10h2"/><path d="M15 4l4 3-4 3"/><path d="M3 17h4l12-10h2"/><path d="M15 20l4-3-4-3"/>',
  // Leading marker for FeltSwitcher/ChipSwitcher -- two overlapping outlined
  // tiles, the common "appearance/theme" idiom, chosen specifically because
  // it does NOT look like a color swatch itself: the switchers already show
  // real color dots, so a filled circle here would read as a fourth/fifth
  // option rather than a label for the row. Outlined + empty reads as "these
  // are theme choices" instead.
  swatch: '<rect x="4" y="7" width="12" height="12" rx="2.5"/><rect x="8" y="3" width="12" height="12" rx="2.5"/>',
};

export function Icon({ name, size = 15, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}
