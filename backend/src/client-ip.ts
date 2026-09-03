// Resolves the real client IP for a request reaching this process through
// Cloudflare's tunnel.
//
// CF-Connecting-IP first, not X-Forwarded-For: Cloudflare's edge sets
// CF-Connecting-IP itself, from the TCP connection IT terminated, and
// overwrites it on every request regardless of what the client sent for
// that header name -- a client cannot make it lie. X-Forwarded-For is the
// opposite: Cloudflare APPENDS the real IP to whatever chain arrived
// already in the header rather than replacing it, so `.split(",")[0]` (the
// obvious way to read it, and the way this file used to) returns the FIRST
// entry in that chain -- which is whatever the client itself put there.
// Both the WS per-IP connection cap and the admin-login brute-force
// throttle keyed off exactly that value, so both were bypassable by
// sending a different spoofed X-Forwarded-For per request.
//
// X-Forwarded-For stays as the fallback, not removed: something has to
// answer for local dev and a direct Tailscale connection, both of which
// bypass Cloudflare and never carry CF-Connecting-IP at all. Per-IP limits
// degrade to "whoever set the header" there, same as before -- acceptable,
// because neither of those paths is the public internet.
export function resolveClientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress?: string
): string {
  const cf = headers["cf-connecting-ip"];
  const cfIp = Array.isArray(cf) ? cf[0] : cf;
  if (cfIp) return cfIp.trim();

  const xff = headers["x-forwarded-for"];
  const xffFirst = Array.isArray(xff) ? xff[0] : typeof xff === "string" ? xff.split(",")[0]?.trim() : undefined;
  if (xffFirst) return xffFirst;

  return socketAddress ?? "unknown";
}
