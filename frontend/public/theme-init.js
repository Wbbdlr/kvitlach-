/* Stamps the reader's saved light/dark choice onto <html> before the app's
 * stylesheet is applied, so an explicitly-dark page never paints light first.
 *
 * A SEPARATE FILE, not an inline <script>, and that is a CSP decision rather
 * than a style one: frontend/nginx.conf serves `script-src 'self'` with no
 * 'unsafe-inline', so an inline script here would be silently blocked in
 * production while working perfectly in dev -- the worst possible direction.
 * The alternative, a 'sha256-...' allowance in the CSP, has to be recomputed
 * every time this text changes and re-blocks itself the first time somebody
 * forgets. One tiny same-origin request, cached forever, is the cheaper trade.
 *
 * Deliberately duplicates two constants from pageTheme.ts (the storage key and
 * the attribute name) rather than importing them: this must run before the
 * module graph exists at all. index.html's own test pins the duplication.
 *
 * Only an EXPLICIT choice is written. "system" is the absence of the
 * attribute, and index.html's inline <style> already paints the right ground
 * for a system-dark device with no JavaScript involved -- so the common case
 * never depends on this file loading at all.
 */
(function () {
  try {
    var saved = window.localStorage.getItem("kvitlach.pageTheme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-page-theme", saved);
      document.documentElement.style.colorScheme = saved;
    }
  } catch (e) {
    /* private mode, or storage disabled. The page still renders; it just
       follows the device instead of the stored choice for this load. */
  }
})();
