import { Pool } from "pg";

export interface ConnectionSummary {
  playerId: string;
  roomId: string;
  ip?: string;
  userAgent?: string;
  connectedAt?: number;
  lastSeenAt?: number;
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

  async dispose() {
    await this.pool.end();
  }
}
