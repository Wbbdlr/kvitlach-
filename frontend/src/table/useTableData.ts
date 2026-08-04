import { useMemo } from "react";
import { Player, ReactionEvent, RoomState, RoundState, Turn } from "../types";
import { CompletedRoundSummary } from "../state";
import { statusDisplay, betDisplay, fullName, formatNames, isPushTurn, reservedAgainst } from "./selectors";

// Must match the server's own BANKER_ABANDON_MS (store.ts). Offering the
// escape hatch earlier than the server honours it would just produce an error
// toast; offering it later would strand the table for longer than necessary.
const BANKER_ABANDON_MS = 2 * 60 * 1000;

export interface StatsEntry {
  roundNumber: number;
  status: string;
  statusClass: string;
  bet: string;
  betClass: string;
}

export interface StatsData {
  name: string;
  entries: StatsEntry[];
  wins: number;
  losses: number;
  pushes: number;
  isBanker: boolean;
  netTotal: number;
}

// Mirrors betDisplay's own amount selection (selectors.ts) so the summed
// total always agrees with what each individual round row already shows.
function netAmount(turn: Turn): number {
  if (turn.player.type === "admin") return turn.bet ?? 0; // already the signed net balance post-resolution
  if (isPushTurn(turn)) return 0;
  const baseBet = turn.bet ?? 0;
  const amount = baseBet > 0 ? baseBet : turn.settledBet ?? baseBet;
  if (turn.state === "won") return amount;
  if (turn.state === "lost") return -amount;
  return 0;
}

export interface TableDataInput {
  room?: RoomState;
  round?: RoundState;
  playerId?: string;
  reactions: ReactionEvent[];
  nowTs: number;
  statsPlayerId?: string;
  roundHistory: CompletedRoundSummary[];
}

export function useTableData({
  room,
  round,
  playerId,
  reactions,
  nowTs,
  statsPlayerId,
  roundHistory,
}: TableDataInput) {
  const turns = round?.turns?.filter(Boolean) ?? [];

  const latestReactionByPlayer = useMemo(() => {
    const map: Record<string, ReactionEvent> = {};
    reactions.forEach((r) => {
      const prev = map[r.playerId];
      if (!prev || r.reactedAt > prev.reactedAt) map[r.playerId] = r;
    });
    return map;
  }, [reactions]);

  const pendingTurns = useMemo(() => turns.filter((t) => t.state === "pending"), [turns]);
  const overviewTurns = useMemo(() => {
    const banker = turns.filter((t) => t.player.type === "admin");
    const others = turns.filter((t) => t.player.type !== "admin");
    return [...banker, ...others];
  }, [turns]);

  const bankLock = round?.bankLock;
  const bankerTurns = turns.filter((t) => t.player?.type === "admin");
  const primaryBankerTurn = bankerTurns[0];
  const activeTurnId = useMemo(() => {
    if (round?.state === "final" && primaryBankerTurn?.player?.id) return primaryBankerTurn.player.id;
    if (bankLock?.stage === "banker" && primaryBankerTurn?.player?.id) return primaryBankerTurn.player.id;
    if (bankLock?.stage === "player" && bankLock.playerId) return bankLock.playerId;
    return pendingTurns[0]?.player.id;
  }, [round?.state, bankLock?.playerId, bankLock?.stage, pendingTurns, primaryBankerTurn?.player?.id]);
  const nextTurnId = useMemo(() => {
    if (bankLock?.stage === "banker") return pendingTurns[0]?.player.id;
    return pendingTurns[1]?.player.id;
  }, [bankLock?.stage, pendingTurns]);

  const activeTimerPlayerId = round?.turnTimerPlayerId;
  const activeTimerRemainingMs = round?.turnTimerExpiresAt ? Math.max(round.turnTimerExpiresAt - nowTs, 0) : undefined;
  const turnTimerDurationMs = round?.turnTimerDurationMs ?? 90_000;
  const activeTurnTimer = useMemo(() => {
    if (!activeTimerPlayerId || activeTimerRemainingMs === undefined) return undefined;
    const percent = Math.max(0, Math.min(100, (activeTimerRemainingMs / turnTimerDurationMs) * 100));
    return { playerId: activeTimerPlayerId, remainingMs: activeTimerRemainingMs, percent, durationMs: turnTimerDurationMs };
  }, [activeTimerPlayerId, activeTimerRemainingMs, turnTimerDurationMs]);

  const bankerPlayer = useMemo(() => room?.players.find((p) => p.type === "admin"), [room?.players]);

  // Players cut from this round by the seat cap (store.ts's
  // MAX_SEATED_PLAYERS_PER_ROUND) or who joined mid-round -- both land in
  // room.waitingPlayerIds and are seated automatically next round.
  const waitingInfo = useMemo(() => {
    const ids = room?.waitingPlayerIds ?? [];
    if (!round || ids.length === 0) return undefined;
    const isViewerWaiting = Boolean(playerId && ids.includes(playerId));
    const otherNames = ids
      .filter((id) => id !== playerId)
      .map((id) => room?.players.find((p) => p.id === id))
      .filter((p): p is Player => Boolean(p))
      .map((p) => fullName(p) || "New player");
    const namesLabel = formatNames([...(isViewerWaiting ? ["You"] : []), ...otherNames]);
    return { count: ids.length, isViewerWaiting, namesLabel };
  }, [room?.waitingPlayerIds, room?.players, round, playerId]);

  const playerTurns = turns.filter((t) => t.player?.type !== "admin");
  const myPlayerTurn = playerTurns.find((t) => t.player?.id === playerId);
  const bankInfo = useMemo(() => {
    if (!round || !bankerPlayer || !myPlayerTurn) return undefined;
    const bankerWallet = room?.wallets?.[bankerPlayer.id] ?? 0;
    const playerIndex = round.turns.findIndex((turn) => turn.player.id === myPlayerTurn.player.id);
    if (playerIndex < 0) return undefined;
    // Only wagers made BEFORE this seat tie up the bank for it -- the players
    // after you haven't committed anything yet.
    const outstanding = round.turns
      .slice(0, playerIndex)
      .reduce((sum, turn) => sum + reservedAgainst(turn), 0);
    const available = Math.max(bankerWallet - outstanding, 0);
    return { available, outstanding, bankerWallet, playerIndex };
  }, [round, bankerPlayer, myPlayerTurn, room?.wallets]);

  const currentBetAmount = myPlayerTurn?.bet ?? 0;
  const bankIncrement = useMemo(() => {
    if (!bankInfo) return 0;
    return Math.max(bankInfo.available - currentBetAmount, 0);
  }, [bankInfo, currentBetAmount]);
  const bankDisabledReason = useMemo(() => {
    if (!bankInfo) return "Bank unavailable.";
    if (bankInfo.available <= 0) return "Bank is empty.";
    if (bankIncrement <= 0) return "Current wager already matches the bank.";
    return undefined;
  }, [bankInfo, bankIncrement]);

  const totalStakes = useMemo(
    () =>
      turns
        .filter((t) => t.player.type !== "admin")
        .reduce((sum, turn) => sum + Math.max(0, turn.bet ?? 0), 0),
    [turns]
  );

  const statsData = useMemo(() => {
    if (!statsPlayerId) return undefined;
    const rounds = roundHistory ?? [];
    let netTotal = 0;
    const entries = rounds
      .map((r) => {
        const turn = r.turns.find((t) => t.player.id === statsPlayerId);
        if (!turn) return undefined;
        const status = statusDisplay(turn);
        const betInfo = betDisplay(turn, true);
        netTotal += netAmount(turn);
        return {
          roundNumber: r.roundNumber,
          status: status.label || "",
          statusClass: status.className,
          bet: betInfo.label,
          betClass: betInfo.className,
        };
      })
      .filter(Boolean) as {
      roundNumber: number;
      status: string;
      statusClass: string;
      bet: string;
      betClass: string;
    }[];
    if (!entries.length) return { name: "", entries: [], wins: 0, losses: 0, pushes: 0, isBanker: false, netTotal: 0 };
    const wins = entries.filter((e) => e.status === "WON").length;
    const losses = entries.filter((e) => e.status === "LOST" || e.status === "FUTCHED!").length;
    const pushes = entries.filter((e) => e.status === "PUSH").length;
    const playerRecord = room?.players.find((p) => p.id === statsPlayerId);
    const playerName =
      playerRecord?.firstName ??
      rounds.find((r) => r.turns.some((t) => t.player.id === statsPlayerId))?.turns.find((t) => t.player.id === statsPlayerId)?.player
        ?.firstName ?? "Player";
    const isBanker = playerRecord?.type === "admin";
    // Every entry is shown now, not just the last 10 -- already bounded
    // upstream (roundHistory is capped at 50 client-side / 200 server-side).
    return { name: playerName, entries, wins, losses, pushes, isBanker, netTotal };
  }, [statsPlayerId, roundHistory, room?.players]);

  // The banker has no turn timer -- they're the dealer, not a seat being
  // waited on -- so when they drop while the table is waiting on them, nothing
  // moves the round along and nobody else can act. This mirrors the server's
  // GameStore.abandonedBankerInfo exactly (including the two-minute grace), so
  // the escape hatch is only ever offered when the server would honour it.
  const abandonedBanker = useMemo(() => {
    if (!round || round.state === "terminate" || !primaryBankerTurn) return undefined;
    const banker = room?.players.find((p) => p.id === primaryBankerTurn.player.id);
    if (!banker || banker.presence === "online" || banker.isBot) return undefined;
    const waitingOnBanker =
      bankLock?.stage === "decision" ||
      bankLock?.stage === "banker" ||
      (round.state === "final" && primaryBankerTurn.state === "pending") ||
      activeTurnId === primaryBankerTurn.player.id;
    if (!waitingOnBanker) return undefined;
    const since = banker.offlineSince ?? nowTs;
    const eligibleAt = since + BANKER_ABANDON_MS;
    return {
      name: fullName(banker) || banker.firstName || "The banker",
      since,
      eligibleAt,
      canVoid: nowTs >= eligibleAt,
      secondsLeft: Math.max(0, Math.ceil((eligibleAt - nowTs) / 1000)),
    };
  }, [round, primaryBankerTurn, room?.players, bankLock?.stage, activeTurnId, nowTs]);

  return {
    latestReactionByPlayer,
    pendingTurns,
    overviewTurns,
    activeTurnId,
    nextTurnId,
    activeTurnTimer,
    bankerPlayer,
    bankInfo,
    bankIncrement,
    bankDisabledReason,
    totalStakes,
    statsData,
    waitingInfo,
    abandonedBanker,
  };
}
