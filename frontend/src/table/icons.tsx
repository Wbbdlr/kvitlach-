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
  | "laugh"
  | "heart"
  | "chevron-up"
  | "chevron-down";

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
  star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z"/>',
  laugh: '<circle cx="12" cy="12" r="8.5"/><path d="M7.5 13.5s2 3 4.5 3 4.5-3 4.5-3"/><path d="M8 9.3l2 1.4M16 9.3l-2 1.4"/>',
  heart: '<path d="M12 19.5s-7.5-4.3-7.5-10a4.5 4.5 0 0 1 7.5-3.4 4.5 4.5 0 0 1 7.5 3.4c0 5.7-7.5 10-7.5 10z"/>',
  "chevron-up": '<path d="M5 15l7-7 7 7"/>',
  "chevron-down": '<path d="M5 9l7 7 7-7"/>',
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
