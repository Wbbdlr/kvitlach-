// The client half of family profiles: kvitlach.us/m/dov.
//
// A family opens their link once. This reads the slug off the pathname, stores
// it, fetches the profile, and rewrites the address bar back to "/" so the link
// is a door rather than a place. From then on their lobby is theirs, and any
// table they host is stamped with it for everyone at it.
//
// NOT A ROUTE, deliberately. router.tsx is a single catch-all `*` on purpose --
// two route objects rendering the same element remount it on every path change,
// which re-runs App's WebSocket connect effect and leaves the status stuck on
// "connecting". So this reads the pathname the same way state.ts's
// getUrlRoomId already does. The room-id matcher is anchored to /table/:id, so
// a family link falls through to the lobby cleanly.
//
// Precedence, decided rather than fallen into:
//   a player's own saved felt  >  the table's profile  >  this device's profile
//   >  the house look
// A family look never overrules somebody's own choice. See theme.ts.

import { useEffect, useState } from "react";
import { applyChip, applyFelt, loadChip, loadFelt, setFamilyTheme } from "./theme";
import { DEFAULT_MARK, type MarkSettings } from "./table/cardMark";

/** Mirrors FamilyProfile in backend/src/family-profiles.ts. */
export interface FamilyProfile {
  slug: string;
  name: string;
  greeting: string;
  feltPrint: string;
  cardMark: string;
  felt: string;
  chip: string;
  accessCode: string;
}

const STORAGE_KEY = "kvitlach.family";
/** Same shape the backend accepts. A slug that fails this is never fetched. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PATH_RE = /^\/m\/([^/]+)\/?$/;

/** Fires when a profile lands, so anything already mounted can catch up. */
export const FAMILY_PROFILE_EVENT = "kvitlach:family-profile";

let active: FamilyProfile | null = null;

/** The profile this client is on, or null for the house look. */
export function activeProfile(): FamilyProfile | null {
  return active;
}

/** The slug this device remembers, or "" -- exported for the tests. */
export function storedSlug(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? "";
    return SLUG_RE.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

function remember(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    /* private mode; the profile still applies for this page's lifetime */
  }
}

/** Reads /m/<slug> off the pathname. Returns "" for every other path. */
export function slugFromPath(pathname: string): string {
  const raw = PATH_RE.exec(pathname)?.[1];
  if (!raw) return "";
  const slug = decodeURIComponent(raw).toLowerCase();
  return SLUG_RE.test(slug) ? slug : "";
}

/**
 * Applies a profile to this client.
 *
 * The felt and chips go through loadFelt()/loadChip() rather than being set
 * directly, because those own the precedence rule: a player who has picked
 * their own felt keeps it, and the profile only reaches somebody who never
 * chose. Exported for the tests and for the table, which calls it again with
 * the room's own profile once room state arrives.
 */
export function applyProfile(profile: FamilyProfile | null): void {
  active = profile;
  setFamilyTheme(profile?.felt, profile?.chip);
  applyFelt(loadFelt());
  applyChip(loadChip());
  try {
    window.dispatchEvent(new Event(FAMILY_PROFILE_EVENT));
  } catch {
    /* no window (tests, SSR) -- `active` is still set */
  }
}

function usable(doc: unknown): FamilyProfile | null {
  if (!doc || typeof doc !== "object") return null;
  const p = doc as Partial<FamilyProfile>;
  return typeof p.slug === "string" && SLUG_RE.test(p.slug)
    ? {
        slug: p.slug,
        name: typeof p.name === "string" ? p.name : p.slug,
        greeting: typeof p.greeting === "string" ? p.greeting : "",
        feltPrint: typeof p.feltPrint === "string" ? p.feltPrint : "",
        cardMark: typeof p.cardMark === "string" ? p.cardMark : "",
        felt: typeof p.felt === "string" ? p.felt : "",
        chip: typeof p.chip === "string" ? p.chip : "",
        accessCode: typeof p.accessCode === "string" ? p.accessCode : "",
      }
    : null;
}

/**
 * Fetches one profile by slug. Never rejects.
 *
 * A 404 is the ordinary answer for a mistyped link and is not an error worth
 * showing anybody: the lobby simply looks like the house, which is what a
 * stranger following a bad link should see anyway.
 */
export async function fetchProfile(slug: string): Promise<FamilyProfile | null> {
  if (!SLUG_RE.test(slug)) return null;
  try {
    const res = await fetch(`/api/family?slug=${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
    });
    return res.ok ? usable(await res.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Called once at boot, before React mounts. Never awaited.
 *
 * The address bar is rewritten with replaceState rather than a navigation: the
 * app is a single catch-all route, so pushing /m/dov into history would give
 * the family a back button that lands them on a path the lobby has to handle
 * again. The link is a door, not a place.
 */
export function loadFamilyProfile(): void {
  let slug = "";
  try {
    slug = slugFromPath(window.location.pathname);
    if (slug) {
      remember(slug);
      window.history.replaceState(null, "", "/");
    } else {
      slug = storedSlug();
    }
  } catch {
    return;
  }
  if (!slug) return;

  void fetchProfile(slug).then((profile) => {
    // A slug that no longer resolves is forgotten rather than retried on every
    // load: a family whose profile was removed should stop being told about it.
    if (!profile) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to clear */
      }
      return;
    }
    applyProfile(profile);
  });
}

/**
 * The active profile, re-read whenever one lands.
 *
 * A hook rather than a prop threaded down: the profile can arrive after mount
 * (the fetch is not awaited at boot) and again when a stamped table's room
 * state comes in, and every consumer wants the same answer.
 */
export function useFamilyProfile(): FamilyProfile | null {
  const [profile, setProfile] = useState<FamilyProfile | null>(activeProfile);
  useEffect(() => {
    const onChange = () => setProfile(activeProfile());
    window.addEventListener(FAMILY_PROFILE_EVENT, onChange);
    // The profile may have landed between the initial state above and this
    // effect running; re-reading here rather than trusting the first value.
    onChange();
    return () => window.removeEventListener(FAMILY_PROFILE_EVENT, onChange);
  }, []);
  return profile;
}

/**
 * The maker's mark settings for the active profile.
 *
 * Everything except the text is the shipped mark: which cards carry it, the
 * size, the colour and the tracking are all tuned against the card art and are
 * not a family's to change. Only the name differs.
 */
export function useFamilyMark(): MarkSettings {
  const profile = useFamilyProfile();
  const text = profile?.cardMark?.trim();
  return text ? { ...DEFAULT_MARK, text } : DEFAULT_MARK;
}

/**
 * Adopts the profile a table was stamped with.
 *
 * This is what makes it a family TABLE rather than a family device: somebody
 * who followed no link at all sees the banker's look once they sit down. The
 * table's own profile outranks whatever this device remembered, because the
 * table is the shared thing.
 *
 * A no-op when the table carries no profile, so joining a house table does not
 * strip a family member of their own look on their way back to the lobby.
 */
export function useRoomProfile(slug: string | undefined): void {
  useEffect(() => {
    if (!slug || slug === active?.slug) return;
    let cancelled = false;
    void fetchProfile(slug).then((profile) => {
      if (!cancelled && profile) applyProfile(profile);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);
}
