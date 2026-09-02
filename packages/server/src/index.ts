// Phases 3-5 (IMPLEMENTATION_READINESS_CHECKLIST.md §6): HTTP routes, auth,
// sessions, the socket gateway, checkpointing. The per-table actor (§6
// phase 4) is in place; see table/actor.ts's module comment for its scope.

export type { ActorFrame, ActorSnapshot, TableActorOptions } from "./table/actor.js";
export { TableActor } from "./table/actor.js";

export { CheckpointHistory } from "./table/checkpoints.js";
export type { CheckpointEntry } from "./table/checkpoints.js";

export { toWireEvent } from "./table/events.js";

export type { Table, TableRejection, TableRejectionCode, TableSeatState, TableStatus } from "./table/table.js";
export {
  allReady,
  closeTable,
  createTable,
  occupySeat,
  setReady,
  TABLE_STATUSES,
  vacateSeat,
} from "./table/table.js";

export { projectTableView } from "./table/view.js";
