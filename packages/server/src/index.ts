// Phases 3-5 (IMPLEMENTATION_READINESS_CHECKLIST.md §6): HTTP routes, auth,
// checkpointing. The per-table actor (Phase 4) and the socket gateway
// (Phase 5) are in place; see table/actor.ts and gateway/gateway.ts's
// module comments for their scope.

export type { ActorFrame, ActorSnapshot, SubmitOutcome, TableActorOptions } from "./table/actor.js";
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

export type { ConnectionHandle } from "./gateway/gateway.js";
export { TableGateway } from "./gateway/gateway.js";
export { Connection } from "./gateway/connection.js";
export type { SocketLike } from "./gateway/socket.js";
export { TicketStore } from "./gateway/tickets.js";
export type { TicketClaims } from "./gateway/tickets.js";
export { createCommandRateLimiter, TokenBucket } from "./gateway/rate-limit.js";
export { attachWebSocketGateway } from "./gateway/ws-server.js";
export type { AttachGatewayOptions } from "./gateway/ws-server.js";
