// The live table registry: one `TableActor` + `TicketStore` +
// `TableGateway` triple per table, held in process memory and keyed by
// table id — the "owner_node text NOT NULL, constant in v1" design
// (docs/17 §5.4, D-03-08): exactly one process owns a given table, so a
// plain `Map` is the whole mechanism (docs/03, ADR-0014's "no Redis").
//
// Scope note: this registry only knows about tables created during the
// current process's lifetime. Reconstructing a `TableActor` for a table
// that already existed in the database — after a restart — from its
// checkpoint (docs/29_Disaster_Recovery.md) is not built here; that is
// crash recovery, a distinct piece of work from the REST surface this
// module exists to support.
import { type Entropy } from "@mahjong-dealer/dealer-core";
import { TableActor } from "../table/actor.js";
import { TableGateway } from "../gateway/gateway.js";
import { TicketStore } from "../gateway/tickets.js";

interface LiveTable {
  readonly actor: TableActor;
  readonly tickets: TicketStore;
  readonly gateway: TableGateway;
}

export class TableManager {
  private readonly live = new Map<string, LiveTable>();

  constructor(private readonly entropy: Entropy) {}

  create(id: string): LiveTable {
    if (this.live.has(id)) {
      throw new Error(`unreachable: table ${id} already registered`);
    }
    const actor = new TableActor({ id, entropy: this.entropy });
    const tickets = new TicketStore();
    const gateway = new TableGateway({ actor, tickets });
    const entry: LiveTable = { actor, tickets, gateway };
    this.live.set(id, entry);
    return entry;
  }

  get(id: string): LiveTable | undefined {
    return this.live.get(id);
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
