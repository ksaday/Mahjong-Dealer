// Phase 3 (IMPLEMENTATION_READINESS_CHECKLIST.md §6): schema and
// migrations (docs/17_Database_Design.md). Registration, login, and
// session issuance — the other half of Phase 3 — are `server`'s job,
// built against the row types and ids this package exports; nothing here
// hashes a password or issues a session.
export { migrate, listMigrations } from "./migrate.js";
export type { MigrateOptions } from "./migrate.js";

export { runMigrateCli } from "./cli.js";
export type { MigrateCliDeps } from "./cli.js";

export { uuidv7 } from "./ids.js";

export type {
  AccountRole,
  AccountRow,
  AccountStatus,
  AuditLogRow,
  CheckpointRow,
  CommandReceiptRow,
  ConnectTicketRow,
  CorrectionCheckpointRow,
  GameEventRow,
  GameOutcomeRow,
  GameRow,
  GameStateRow,
  IdempotencyKeyRow,
  SessionRow,
  TableRow,
  TableSeatRow,
  TableStatusRow,
} from "./schema/types.js";
