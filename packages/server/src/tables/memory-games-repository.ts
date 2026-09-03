// In-memory `GamesRepository` — what this repository's own tests and
// `checkpoint/`'s tests actually exercise, the same role every other
// `memory-repository.ts` in this codebase plays.
import type { GameOutcomeRow, GameRow } from "@mahjong-dealer/db";
import type { Seat } from "@mahjong-dealer/shared";
import type { GamesRepository, NewGameRow } from "./games-repository.js";

export class InMemoryGamesRepository implements GamesRepository {
  private readonly games = new Map<string, GameRow>();

  startGame(row: NewGameRow): Promise<void> {
    this.games.set(row.id, {
      id: row.id,
      table_id: row.tableId,
      state: "in_play",
      seq: 0n,
      commitment: null,
      outcome: null,
      outcome_seat: null,
      started_at: new Date(),
      concluded_at: null,
      purged_at: null,
    });
    return Promise.resolve();
  }

  recordSeq(gameId: string, seq: number): Promise<void> {
    const game = this.games.get(gameId);
    if (game === undefined) throw new Error(`unreachable: no game ${gameId}`);
    this.games.set(gameId, { ...game, seq: BigInt(seq) });
    return Promise.resolve();
  }

  markConcluded(gameId: string, outcome: GameOutcomeRow, outcomeSeat: Seat | null): Promise<void> {
    const game = this.games.get(gameId);
    if (game === undefined) throw new Error(`unreachable: no game ${gameId}`);
    this.games.set(gameId, { ...game, state: "concluded", outcome, outcome_seat: outcomeSeat, concluded_at: new Date() });
    return Promise.resolve();
  }

  markPurged(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (game === undefined) throw new Error(`unreachable: no game ${gameId}`);
    this.games.set(gameId, { ...game, purged_at: new Date() });
    return Promise.resolve();
  }

  findLatestForTable(tableId: string): Promise<GameRow | null> {
    let latest: GameRow | null = null;
    for (const game of this.games.values()) {
      if (game.table_id !== tableId) continue;
      if (latest === null || (game.started_at?.getTime() ?? 0) >= (latest.started_at?.getTime() ?? 0)) {
        latest = game;
      }
    }
    return Promise.resolve(latest);
  }
}
