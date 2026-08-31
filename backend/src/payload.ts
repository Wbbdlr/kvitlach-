// Single validation point for everything arriving on a WebSocket message.
//
// Handlers destructure straight out of `payload` and hand the fields to the
// store, and their checks were only ever truthiness (`if (!firstName)`) or a
// one-off `typeof amount !== "number"`. Truthiness does not catch type
// confusion: `firstName: {}` is truthy, sails past that guard, and reaches
// store.ts's sanitizeName, which calls .trim() on it and throws a TypeError
// -- surfacing as an opaque "server_error" rather than a real rejection.
// Objects and arrays could reach anywhere a string was assumed.
//
// Deliberately ONE universal rule rather than a per-message-type schema
// table: there are 30-odd message types and the table would drift out of
// sync with the handlers the first time a field was added. Every field the
// protocol actually uses is a scalar, so "scalars only" covers the whole
// class at the boundary and needs no upkeep. Per-field meaning (is this
// amount positive? is this name too long?) stays where it already lives --
// store.ts's normalizeMoney and sanitizeName -- which is the layer that
// knows what those answers should be.
//
// This is why `zod` isn't here: it was removed as an unused dependency, and
// re-adding it to express "must be a scalar" would be a lot of weight for
// one rule.

// Generous on purpose. The store already caps the fields with real limits
// (MAX_NAME_LEN 40, MAX_ROOM_NAME_LEN 80, MAX_NOTE_LEN 160,
// MAX_WATERMARK_LEN 60); this is the backstop for the ones with no cap of
// their own -- password, token -- so nothing unbounded reaches a hash, a
// comparison, or the database.
const MAX_FIELD_LEN = 2000;

export function validatePayload(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return {};
  // A non-object payload (a bare string, a number) means the client is
  // speaking a different protocol than we are -- nothing to destructure.
  if (typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_payload");

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const kind = typeof value;
    if (kind === "string") {
      if ((value as string).length > MAX_FIELD_LEN) throw new Error("invalid_payload");
      continue;
    }
    // NaN and Infinity are rejected here rather than deeper in: they survive
    // every `typeof x === "number"` check downstream and turn wallets into
    // NaN on the first addition.
    if (kind === "number") {
      if (!Number.isFinite(value as number)) throw new Error("invalid_payload");
      continue;
    }
    if (kind === "boolean") continue;
    throw new Error("invalid_payload");
  }

  return payload as Record<string, unknown>;
}
