import { useMemo } from "react";
import { ReactionEvent, RoomState, RoundState } from "../types";
import { CompletedRoundSummary } from "../state";
import { statusDisplay, betDisplay } from "./selectors";

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

  const playerTurns = turns.filter((t) => t.player?.type !== "admin");
  const myPlayerTurn = playerTurns.find((t) => t.player?.id === playerId);
  const bankInfo = useMemo(() => {
    if (!round || !bankerPlayer || !myPlayerTurn) return undefined;
    const bankerWallet = room?.wallets?.[bankerPlayer.id] ?? 0;
    const playerIndex = round.turns.findIndex((turn) => turn.player.id === myPlayerTurn.player.id);
    if (playerIndex < 0) return undefined;
    const outstanding = round.turns
      .slice(0, playerIndex)
      .filter((turn) => turn.player.type !== "admin" && turn.state !== "lost" && turn.state !== "skipped" && !turn.settled)
      .reduce((sum, turn) => sum + (turn.bet ?? 0), 0);
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
    const entries = rounds
      .map((r) => {
        const turn = r.turns.find((t) => t.player.id === statsPlayerId);
        if (!turn) return undefined;
        const status = statusDisplay(turn);
        const betInfo = betDisplay(turn, true);
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
    if (!entries.length) return { name: "", entries: [], wins: 0, losses: 0, pushes: 0, isBanker: false };
    const wins = entries.filter((e) => e.status === "WON").length;
    const losses = entries.filter((e) => e.status === "LOST" || e.status === "FUTCHED!").length;
    const pushes = entries.filter((e) => e.status === "PUSH").length;
    const playerRecord = room?.players.find((p) => p.id === statsPlayerId);
    const playerName =
      playerRecord?.firstName ??
      rounds.find((r) => r.turns.some((t) => t.player.id === statsPlayerId))?.turns.find((t) => t.player.id === statsPlayerId)?.player
        ?.firstName ?? "Player";
    const isBanker = playerRecord?.type === "admin";
    return { name: playerName, entries: entries.slice(0, 10), wins, losses, pushes, isBanker };
  }, [statsPlayerId, roundHistory, room?.players]);

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
  };
}
