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
export const APP_VERSION = "7.1";
