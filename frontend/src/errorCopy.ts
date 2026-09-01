// Player-facing copy for the backend's error codes.
//
// The backend throws bare snake_case codes (`throw new Error("room_full")`)
// and ws-server forwards them verbatim; anything that is NOT one of those
// codes is replaced with `server_error` there, so a pg or TypeError message
// can never reach a player. This is the other half of that: turning the code
// into a sentence.
//
// Lives in its own module, as a map rather than the ternary chain this used to
// be, for one reason -- the chain made it impossible to see what was MISSING.
// Eleven codes the backend throws had no copy at all and fell through to the
// fallback, so players hitting ordinary situations got "insufficient funds"
// and "invalid bet" in bare lowercase.
//
// Keeping it honest: the backend is the source of truth, and
// `error-copy.test.ts` reads the codes straight out of backend/src and fails
// if one has no entry here.
export const ERROR_COPY: Record<string, string> = {
  // Server-side trouble, not the player's doing.
  server_error: "Something went wrong on our end. Please try again.",
  invalid_payload: "Something went wrong. Please try again.",
  // Sent directly by ws-server rather than thrown, but reaches the client
  // through the same envelope, so it needs copy like any other code.
  invalid_json: "Something went wrong. Please try again.",
  unknown_type: "Something went wrong. Please try again.",
  maintenance_mode:
    "New games are temporarily paused for maintenance. Existing games are unaffected. Check back soon.",
  // The three access-control refusals (backend/src/access.ts). All three say
  // "existing games are unaffected" because that is literally true -- resume
  // is never gated -- and it is the first thing someone mid-game will want
  // to know when a friend tells them the site turned them away.
  locked_down:
    "The tables are closed to new games right now. Games already in progress are unaffected.",
  invite_required: "This table is invite-only right now. Enter your access code to play.",
  invalid_invite: "That access code isn't right. Check it and try again.",
  room_capacity:
    "The server is hosting as many tables as it can right now. Existing games are unaffected — try again in a few minutes.",
  practice_capacity:
    "All practice tables are busy right now. Try again in a few minutes.",
  rate_limited: "Too many requests. Please slow down.",

  // Getting to a table.
  room_not_found: "Room not found. Check the room ID and try again.",
  room_full: "This table is full (100 players max). Try a different room.",
  invalid_password: "Incorrect password.",
  invalid_session: "Your session has expired. Please rejoin the table.",

  // Money.
  insufficient_bank: "Cannot remove more chips than the bank holds.",
  insufficient_funds: "You don't have enough chips for that.",
  invalid_bet: "That bet isn't valid for this hand.",
  invalid_bankroll: "Enter a valid starting amount for the bank.",
  invalid_buyin: "Enter a valid buy-in — whole chips, at least 1.",
  invalid_bank_amount: "Bank wager must equal the remaining bank.",
  bank_empty: "The bank has no chips left.",
  bank_locked: "Bank showdown in progress. Please wait.",
  bank_not_in_decision: "No bank decision is pending.",
  banker_deciding: "The banker must decide how to proceed.",

  // Taking a turn.
  not_your_turn: "It's not your turn yet.",
  turn_not_pending: "That action already went through.",
  turn_not_found: "That hand is no longer in play.",
  round_not_found: "That round has already ended.",
  round_terminated: "That round has already finished.",
  not_enough_players: "You need at least one other player to start a round.",
  deck_empty: "The shoe is out of cards. Reshuffle to keep playing.",
  deck_low: "The shoe is running low. Reshuffle to keep playing.",

  // The banker, and being acted on by the banker.
  forbidden: "Only the banker can perform that action.",
  banker_missing: "The banker isn't at the table right now.",
  banker_not_absent: "The banker is back — the round can carry on.",
  banker_not_absent_long_enough: "Give the banker another moment to reconnect.",
  buyin_blocked: "The banker has turned off buy-in requests for you.",
  rename_blocked: "The banker has turned off name changes for you.",

  // Acting on someone/something that moved on.
  player_not_found: "That player is no longer at the table.",
  request_not_found: "That request has already been handled.",
  invalid_target: "That action doesn't apply to that player.",
};

// Last resort. A code with no entry still beats a blank message, and the
// underscore swap at least makes it readable -- but the test above means a
// code from the backend should never actually land here.
export function errorCopy(code: string | undefined): string {
  if (!code) return "Something went wrong.";
  return ERROR_COPY[code] ?? code.replace(/_/g, " ");
}
