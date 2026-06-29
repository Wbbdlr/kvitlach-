import { Pool } from "pg";
import type { RoomState } from "./types.js";

export interface ConnectionSummary {
  playerId: string;
  roomId: string;
  ip?: string;
  userAgent?: string;
  connectedAt?: number;
  lastSeenAt?: number;
}

export interface RoomRow {
  roomId: string;
  roomState: RoomState;
  rounds: Array<{ roundId: string; roundState: Record<string, unknown> }>;
}

export class Database {
  private pool: Pool;

  constructor(url = process.env.DATABASE_URL) {
    if (!url) throw new Error("DATABASE_URL is required for database operations");
    this.pool = new Pool({ connectionString: url });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS connections (
        id SERIAL PRIMARY KEY,
        room_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        disconnected_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_connections_room_player ON connections (room_id, player_id);
      CREATE INDEX IF NOT EXISTS idx_connections_room ON connections (room_id);

      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_rooms_last_active ON rooms (last_active_at);

      CREATE TABLE IF NOT EXISTS rounds (
        round_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds (room_id);
    `);
  }

  async logConnection(params: { roomId: string; playerId: string; ip?: string; userAgent?: string }) {
    const { roomId, playerId, ip, userAgent } = params;
    const result = await this.pool.query(
      `INSERT INTO connections (room_id, player_id, ip, user_agent)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [roomId, playerId, ip ?? null, userAgent ?? null]
    );
    return result.rows[0]?.id as number | undefined;
  }

  async markSeen(connectionId: number) {
    await this.pool.query(`UPDATE connections SET last_seen_at = now() WHERE id = $1`, [connectionId]);
  }

  async logDisconnection(connectionId: number) {
    await this.pool.query(
      `UPDATE connections SET disconnected_at = COALESCE(disconnected_at, now()), last_seen_at = now() WHERE id = $1`,
      [connectionId]
    );
  }

  async getRoomConnectionSummaries(roomId: string): Promise<ConnectionSummary[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (player_id)
         player_id,
         room_id,
         ip,
         user_agent,
         connected_at,
         COALESCE(disconnected_at, last_seen_at, connected_at) AS last_seen
       FROM connections
       WHERE room_id = $1
       ORDER BY player_id, connected_at DESC`,
      [roomId]
    );
    return result.rows.map((row) => ({
      playerId: row.player_id,
      roomId: row.room_id,
      ip: row.ip ?? undefined,
      userAgent: row.user_agent ?? undefined,
      connectedAt: row.connected_at ? new Date(row.connected_at).getTime() : undefined,
      lastSeenAt: row.last_seen ? new Date(row.last_seen).getTime() : undefined,
    }));
  }

  async saveRoom(roomId: string, state: RoomState): Promise<void> {
    await this.pool.query(
      `INSERT INTO rooms (room_id, state, last_active_at)
       VALUES ($1, $2, now())
       ON CONFLICT (room_id) DO UPDATE
         SET state = EXCLUDED.state, last_active_at = now()`,
      [roomId, JSON.stringify(state)]
    );
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.pool.query(`DELETE FROM rooms WHERE room_id = $1`, [roomId]);
    await this.pool.query(`DELETE FROM rounds WHERE room_id = $1`, [roomId]);
  }

  async saveRound(roundId: string, roomId: string, state: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO rounds (round_id, room_id, state, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (round_id) DO UPDATE
         SET state = EXCLUDED.state, updated_at = now()`,
      [roundId, roomId, JSON.stringify(state)]
    );
  }

  async deleteRound(roundId: string): Promise<void> {
    await this.pool.query(`DELETE FROM rounds WHERE round_id = $1`, [roundId]);
  }

  async loadActiveRooms(): Promise<RoomRow[]> {
    const roomsResult = await this.pool.query(
      `SELECT room_id, state FROM rooms ORDER BY last_active_at DESC`
    );
    const rows: RoomRow[] = [];
    for (const roomRow of roomsResult.rows) {
      const roomId: string = roomRow.room_id;
      const roomState: RoomState = roomRow.state as RoomState;
      const roundsResult = await this.pool.query(
        `SELECT round_id, state FROM rounds WHERE room_id = $1`,
        [roomId]
      );
      const rounds = roundsResult.rows.map((r) => ({
        roundId: r.round_id as string,
        roundState: r.state as Record<string, unknown>,
      }));
      rows.push({ roomId, roomState, rounds });
    }
    return rows;
  }

  async dispose() {
    await this.pool.end();
  }
}
