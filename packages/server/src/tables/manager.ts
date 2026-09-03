// The live table registry: one `TableActor` + `TicketStore` +
// `TableGateway` triple per table, held in process memory and keyed by
// table id — the "owner_node text NOT NULL, constant in v1" design
// (docs/17 §5.4, D-03-08): exactly one process owns a given table, so a
// plain `Map` is the whole mechanism (docs/03, ADR-0014's "no Redis").
//
// Scope note: this registry only knows about tables created during the
// current process's lifetime unless `restoreLiveTables` is called first
// (docs/29_Disaster_Recovery.md) — `main.ts` does this once at startup,
// before accepting connections.
import { type Entropy } from "@mahjong-dealer/dealer-core";
import { TableActor } from "../table/actor.js";
import { TableGateway } from "../gateway/gateway.js";
import { TicketStore } from "../gateway/tickets.js";
import type { CheckpointWriter } from "../checkpoint/writer.js";
import type { AccountRepository } from "../auth/repository.js";
import { buildTableFromRepository } from "./restore.js";
import type { GamesRepository } from "./games-repository.js";
import type { TableRepository, TableRow } from "./repository.js";

interface LiveTable {
  readonly actor: TableActor;
  readonly tickets: TicketStore;
  readonly gateway: TableGateway;
}

export class TableManager {
  private readonly live = new Map<string, LiveTable>();

  constructor(
    private readonly entropy: Entropy,
    /** Passed to every table's `TableGateway` (docs/12 §4.3) — see that constructor option's own doc comment. */
    private readonly isSessionActive?: (sessionId: string) => Promise<boolean>,
    /** docs/16 §5.3/docs/29: omit to leave checkpoint durability disabled — e.g. tests with no database at all. */
    private readonly checkpointWriter?: CheckpointWriter,
  ) {}

  create(id: string): LiveTable {
    if (this.live.has(id)) {
      throw new Error(`unreachable: table ${id} already registered`);
    }
    const actor = new TableActor({ id, entropy: this.entropy });
    return this.register(id, actor);
  }

  private register(id: string, actor: TableActor): LiveTable {
    const tickets = new TicketStore();
    const gateway = new TableGateway({
      actor,
      tickets,
      ...(this.isSessionActive !== undefined ? { isSessionActive: this.isSessionActive } : {}),
      ...(this.checkpointWriter !== undefined ? { checkpointWriter: this.checkpointWriter } : {}),
    });
    const entry: LiveTable = { actor, tickets, gateway };
    this.live.set(id, entry);
    return entry;
  }

  /**
   * Process-restart recovery (docs/29_Disaster_Recovery.md, docs/21 §7).
   * Eager, at startup, rather than lazily on first bind — see this
   * repository's own docs/21 §7 revision note for why: `TableManager.create`
   * has only ever been called eagerly, at `POST /tables` time, and held for
   * the process's life, so eager restore is the design actually consistent
   * with what's built, not a new deviation. A bad checkpoint for one table
   * marks only that table unavailable (caught, logged, skipped) rather than
   * aborting startup for every table (D-21-02/03's per-table isolation,
   * preserved here without literal lazy start).
   */
  async restoreLiveTables(deps: {
    readonly tables: TableRepository;
    readonly accounts: AccountRepository;
    readonly games: GamesRepository;
    readonly checkpointWriter: CheckpointWriter;
    readonly onError?: (tableId: string, error: unknown) => void;
  }): Promise<void> {
    const onError = deps.onError ?? ((tableId, error) => console.error(`failed to restore table ${tableId}`, error));
    for await (const row of allNonClosedTables(deps.tables)) {
      try {
        const seatRows = await deps.tables.seatsForTable(row.id);
        const table = await buildTableFromRepository(row, seatRows, deps.accounts);

        const latestGame = await deps.games.findLatestForTable(row.id);
        let game: Awaited<ReturnType<CheckpointWriter["readGameState"]>> = null;
        let correctionHistory: Awaited<ReturnType<CheckpointWriter["readCorrectionHistory"]>> = [];
        if (latestGame !== null && latestGame.purged_at === null) {
          game = await deps.checkpointWriter.readGameState(latestGame.id);
          // Only when a game was actually found — an idle/never-started table has no correction window either (D-17-19).
          correctionHistory = await deps.checkpointWriter.readCorrectionHistory(latestGame.id);
        }

        const actor = TableActor.fromRestoredParts({ id: row.id, entropy: this.entropy }, table, game, correctionHistory);
        this.register(row.id, actor);
      } catch (error) {
        onError(row.id, error);
      }
    }
  }

  /** Graceful shutdown's synchronous flush (docs/21 §7, D-21-11) — awaited once per live table before the database pool closes. A failure here is logged the same way `CheckpointWriter.writeAsync`'s own failures are, not thrown — a slow shutdown from one bad table is worse than a lost checkpoint the async path would have retried anyway. */
  async flushAllCheckpointsSync(): Promise<void> {
    if (this.checkpointWriter === undefined) return;
    for (const live of this.live.values()) {
      try {
        await this.checkpointWriter.flushSync(live.actor);
      } catch (error) {
        console.error(`checkpoint flush failed for table ${live.actor.tableSnapshot.id}`, error);
      }
    }
  }

  get(id: string): LiveTable | undefined {
    return this.live.get(id);
  }

  /** Every live table, for the multi-table router's session-revocation poll — see `gateway/multi-table-router.ts`. */
  all(): IterableIterator<LiveTable> {
    return this.live.values();
  }

  /** Graceful shutdown (docs/21 §7): `notifyShuttingDown`s every live table's gateway. `main.ts` calls this on `SIGTERM`, ahead of closing the HTTP server itself. */
  shutdownAll(): void {
    for (const live of this.live.values()) {
      live.gateway.notifyShuttingDown();
    }
  }

  /**
   * Resolves an unredeemed connect ticket to the table it belongs to,
   * without redeeming it — the multi-table router
   * (`gateway/multi-table-router.ts`) uses this to find the right
   * `TableGateway` before that gateway's own `acceptConnection` performs
   * the real, consuming redemption. A ticket is scoped to the
   * `TicketStore` of the table it was issued for, so this is a scan of
   * live tables (each a cheap `Map` lookup) rather than a single
   * indexed query — acceptable at the table-count scale a single
   * process owns (`docs/17 §5.4`'s `owner_node`).
   */
  findTicketOwner(ticket: string): { readonly tableId: string; readonly live: LiveTable } | null {
    for (const [tableId, live] of this.live) {
      if (live.tickets.peek(ticket) !== null) return { tableId, live };
    }
    return null;
  }
}

export type { LiveTable };

/** Pages through every table, yielding only the non-closed ones — `TableRepository.list` has no status filter (it serves `GET /admin/tables`, which wants every table), so restore filters client-side. */
async function* allNonClosedTables(tables: TableRepository): AsyncGenerator<TableRow> {
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const page = await tables.list({ limit: pageSize, offset });
    for (const row of page.tables) {
      if (row.status !== "closed") yield row;
    }
    offset += page.tables.length;
    if (page.tables.length < pageSize || offset >= page.total) break;
  }
}
