// Phases 3-5 (IMPLEMENTATION_READINESS_CHECKLIST.md §6): table/admin HTTP
// routes, checkpointing. The per-table actor (Phase 4), the socket gateway
// (Phase 5), and the accounts/sessions half of auth (Phase 3) are in
// place; see table/actor.ts, gateway/gateway.ts, and auth/service.ts's
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
