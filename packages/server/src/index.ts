// Phases 3-5 (IMPLEMENTATION_READINESS_CHECKLIST.md §6): the per-table
// actor (Phase 4), the socket gateway (Phase 5) — now routed across many
// live tables by `gateway/multi-table-router.ts`, not just the one
// `attachWebSocketGateway` smoke-tests, and polling for session
// revocation on a real timer (`checkSessionRevocation`, docs/12 §4.3) —
// accounts/sessions (Phase 3's auth half), and the table REST surface
// (Phase 3's other half, docs/33_API §4) are in place. Not built: the
// administrative surface (docs/33_API §5), heartbeat scheduling
// (docs/12 §7), and the live table registry's crash-recovery
// reconstruction from a checkpoint (see tables/manager.ts's module
// comment). See table/actor.ts, gateway/gateway.ts, auth/service.ts, and
// tables/service.ts's module comments for scope detail.

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
export { attachWebSocketGateway, wsToSocketLike } from "./gateway/ws-server.js";
export type { AttachGatewayOptions } from "./gateway/ws-server.js";
export { attachMultiTableGateway } from "./gateway/multi-table-router.js";
export type { AttachMultiTableGatewayOptions } from "./gateway/multi-table-router.js";

export { hashPassword, verifyPassword, checkPasswordPolicy } from "./auth/passwords.js";
export type { PasswordPolicyViolation } from "./auth/passwords.js";
export { NullBreachChecker, DenylistBreachChecker } from "./auth/breach-checker.js";
export type { BreachChecker } from "./auth/breach-checker.js";
export { generateSessionToken, generateCsrfSecret, hashToken } from "./auth/tokens.js";
export { computeLockoutMinutes, isLockedOut } from "./auth/lockout.js";
export { verifyCsrf } from "./auth/csrf.js";
export { getPasswordPepper } from "./auth/pepper.js";
export type {
  AccountRepository,
  NewAccount,
  NewSession,
  SessionRepository,
} from "./auth/repository.js";
export { InMemoryAccountRepository, InMemorySessionRepository } from "./auth/memory-repository.js";
export { PostgresAccountRepository, PostgresSessionRepository } from "./auth/postgres-repository.js";
export { AuthService } from "./auth/service.js";
export type {
  AuthenticatedSession,
  AuthServiceOptions,
  ChangePasswordResult,
  IssuedSession,
  LoginResult,
  RegisterResult,
  RequestContext,
} from "./auth/service.js";
export { registerAuthRoutes } from "./auth/http.js";
export type { AuthRoutesOptions } from "./auth/http.js";
export {
  clientIp,
  CSRF_COOKIE,
  CSRF_HEADER,
  errorBody,
  requireCsrf,
  requireSession,
  SESSION_COOKIE,
} from "./auth/session-guard.js";

export { CryptoEntropy } from "./entropy.js";

export { generateJoinCode, hashJoinCode } from "./tables/codes.js";
export { TableManager } from "./tables/manager.js";
export type { LiveTable } from "./tables/manager.js";
export type {
  NewTableRow,
  SeatAssignment,
  TableRepository,
} from "./tables/repository.js";
export { InMemoryTableRepository } from "./tables/memory-repository.js";
export { PostgresTableRepository } from "./tables/postgres-repository.js";
export { TableService } from "./tables/service.js";
export type {
  CloseTableResult,
  ConnectTicketResult,
  CreateTableResult,
  JoinTableResult,
  MineSeatSummary,
  MineTableSummary,
  TableServiceOptions,
} from "./tables/service.js";
export { registerTableRoutes } from "./tables/http.js";
export type { TableRoutesOptions } from "./tables/http.js";
