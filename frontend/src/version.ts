// Bumped by 0.1 every time a new tarball goes out to testers. The only
// point of this number is letting a tester glance at the footer badge
// (SiteFooter.tsx) and confirm they're actually on a build that includes
// whatever just changed -- not tracking real semver compatibility.
//
// Single source of truth on purpose: this badge used to be hand-copied into
// three near-duplicate header/footer blocks (lobby, About, Disclaimer,
// Contact) and they drifted -- one page sat on v1.5 for a release after the
// others were bumped to v2.5. SiteHeader/SiteFooter fixed the duplication;
// this constant is what keeps the number itself from drifting the same way
// again now that there's only ever one place to bump it.
export const APP_VERSION = "10.5";

export interface VersionHistoryEntry {
  version: string;
  /** YYYY-MM-DD, the day the tarball carrying this version was built. */
  date: string;
}

// One entry per bump, oldest first. Append the new version here in the SAME
// edit that bumps APP_VERSION above -- see the deploy skill, which does both
// as one step for exactly this reason. Without a table like this, "what date
// did we ship the fix for X" only ever had one answer: go read git log
// yourself, which a tester asking the footer's own version badge cannot do.
//
// Starts at 2.6, not 1.0: this file's own first commit begins there, because
// the version number existed before this file did -- hand-copied into three
// near-duplicate header/footer blocks that drifted (see the comment above).
// Nothing before this file was created can be dated with any confidence, so
// nothing before it is claimed here.
//
// Everything from 2.6 through 10.2 was backfilled once, from this file's own
// git history (`git log -p -- frontend/src/version.ts`) rather than typed by
// hand -- the commit date of the diff that set APP_VERSION to a given value
// IS the date that value first shipped, since the bump and the build happen
// in the same turn. From here on, each entry is added by hand at bump time.
export const VERSION_HISTORY: VersionHistoryEntry[] = [
  { version: "2.6", date: "2026-08-05" },
  { version: "2.7", date: "2026-08-05" },
  { version: "2.8", date: "2026-08-05" },
  { version: "2.9", date: "2026-08-05" },
  { version: "3.0", date: "2026-08-09" },
  { version: "3.1", date: "2026-08-09" },
  { version: "3.2", date: "2026-08-09" },
  { version: "3.3", date: "2026-08-09" },
  { version: "3.4", date: "2026-08-09" },
  { version: "3.5", date: "2026-08-09" },
  { version: "3.6", date: "2026-08-10" },
  { version: "3.7", date: "2026-08-10" },
  { version: "3.8", date: "2026-08-10" },
  { version: "3.9", date: "2026-08-10" },
  { version: "4.0", date: "2026-08-10" },
  { version: "4.1", date: "2026-08-10" },
  { version: "4.2", date: "2026-08-10" },
  { version: "4.3", date: "2026-08-10" },
  { version: "4.4", date: "2026-08-10" },
  { version: "4.5", date: "2026-08-10" },
  { version: "4.6", date: "2026-08-10" },
  { version: "4.7", date: "2026-08-10" },
  { version: "4.8", date: "2026-08-11" },
  { version: "4.9", date: "2026-08-11" },
  { version: "5.0", date: "2026-08-11" },
  { version: "5.1", date: "2026-08-11" },
  { version: "5.2", date: "2026-08-11" },
  { version: "5.3", date: "2026-08-11" },
  { version: "5.4", date: "2026-08-11" },
  { version: "5.5", date: "2026-08-11" },
  { version: "5.6", date: "2026-08-11" },
  { version: "5.7", date: "2026-08-11" },
  { version: "5.8", date: "2026-08-11" },
  { version: "5.9", date: "2026-08-11" },
  { version: "6.0", date: "2026-08-27" },
  { version: "6.1", date: "2026-08-27" },
  { version: "6.2", date: "2026-08-27" },
  { version: "6.3", date: "2026-08-27" },
  { version: "6.4", date: "2026-08-28" },
  { version: "6.5", date: "2026-08-28" },
  { version: "6.6", date: "2026-08-28" },
  { version: "6.7", date: "2026-08-28" },
  { version: "6.8", date: "2026-08-28" },
  { version: "6.9", date: "2026-08-28" },
  { version: "7.0", date: "2026-08-28" },
  { version: "7.1", date: "2026-08-28" },
  { version: "7.2", date: "2026-08-28" },
  { version: "7.3", date: "2026-08-29" },
  { version: "7.4", date: "2026-08-30" },
  { version: "7.5", date: "2026-08-31" },
  { version: "7.6", date: "2026-08-31" },
  { version: "7.7", date: "2026-08-31" },
  { version: "7.8", date: "2026-08-31" },
  { version: "7.9", date: "2026-09-01" },
  { version: "8.0", date: "2026-09-01" },
  { version: "8.1", date: "2026-09-01" },
  { version: "8.2", date: "2026-09-01" },
  { version: "8.3", date: "2026-09-01" },
  { version: "8.4", date: "2026-09-01" },
  { version: "8.5", date: "2026-09-01" },
  { version: "8.6", date: "2026-09-01" },
  { version: "8.7", date: "2026-09-01" },
  { version: "8.8", date: "2026-09-01" },
  { version: "9.0", date: "2026-09-01" },
  { version: "9.1", date: "2026-09-01" },
  { version: "9.2", date: "2026-09-01" },
  { version: "9.3", date: "2026-09-02" },
  { version: "9.4", date: "2026-09-02" },
  { version: "9.5", date: "2026-09-02" },
  { version: "9.6", date: "2026-09-02" },
  { version: "9.7", date: "2026-09-02" },
  { version: "9.8", date: "2026-09-03" },
  { version: "9.9", date: "2026-09-03" },
  { version: "10.0", date: "2026-09-03" },
  { version: "10.1", date: "2026-09-03" },
  { version: "10.2", date: "2026-09-03" },
  { version: "10.3", date: "2026-09-03" },
  { version: "10.4", date: "2026-09-03" },
  { version: "10.5", date: "2026-09-03" },
];

export function firstPushedDate(version: string): string | undefined {
  return VERSION_HISTORY.find((entry) => entry.version === version)?.date;
}
