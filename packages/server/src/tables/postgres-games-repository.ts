// Postgres-backed `GamesRepository`, written against
// packages/db/migrations/0001_initial_schema.sql's `games` table. Not
// exercised against a live database in this environment — same scope note
// as every other `postgres-repository.ts` in this codebase.
import type { Pool } from "pg";
import type { GameOutcomeRow, GameRow } from "@mahjong-dealer/db";
import type { Seat } from "@mahjong-dealer/shared";
import type { GamesRepository, NewGameRow } from "./games-repository.js";

export class PostgresGamesRepository implements GamesRepository {
  constructor(private readonly pool: Pool) {}

  async startGame(row: NewGameRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO games (id, table_id, state, seq, started_at)
       VALUES ($1, $2, 'in_play', 0, now())`,
      [row.id, row.tableId],
    );
  }

  async recordSeq(gameId: string, seq: number): Promise<void> {
    await this.pool.query(`UPDATE games SET seq = $2 WHERE id = $1`, [gameId, seq]);
  }

  async markConcluded(gameId: string, outcome: GameOutcomeRow, outcomeSeat: Seat | null): Promise<void> {
    await this.pool.query(
      `UPDATE games SET state = 'concluded', outcome = $2, outcome_seat = $3, concluded_at = now() WHERE id = $1`,
      [gameId, outcome, outcomeSeat],
    );
  }

  async markPurged(gameId: string): Promise<void> {
    await this.pool.query(`UPDATE games SET purged_at = now() WHERE id = $1`, [gameId]);
  }

  async findLatestForTable(tableId: string): Promise<GameRow | null> {
    const { rows } = await this.pool.query<GameRow>(
      `SELECT * FROM games WHERE table_id = $1 ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [tableId],
    );
    return rows[0] ?? null;
  }
}
