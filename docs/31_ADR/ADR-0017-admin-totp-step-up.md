# ADR-0017 — TOTP step-up authentication for administrators

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-03 |
| **Owning chapter** | 15_Security_Architecture.md |
| **Deciders** | Project owner |

## Context

`15 §8` has required a second factor on every administrative action since the chapter was ratified
(`SEC-007`: "TOTP or a hardware authenticator"), and `18 §7`'s `requireAdmin` guard has always
enforced the session/role half of that and flagged the second-factor half as unbuilt, rather than
narrowing the requirement silently. `04 §3.3` and `28 §3` already establish the surrounding shape —
an administrator account is provisioned out of band, never by self-registration, and `28 §3`
specifically says a second factor is required "before first use" — but nothing at the API level has
ever specified the actual mechanism: no enrollment endpoint, no verify-code endpoint, no database
column for a secret, no step-up-login protocol. Building one means inventing something no chapter
currently names, which is an architectural decision, not an implementation detail — hence this ADR
rather than a chapter design decision (`31_ADR/README.md`'s own test for what earns a record).

Three questions had to be settled before a protocol could be specified at all, each discussed with
the project owner directly:

1. Build TOTP only, or TOTP and a hardware authenticator (WebAuthn/FIDO2) together, given `SEC-007`
   accepts either.
2. Whether enrollment is a REST/UI flow or purely an out-of-band script, given `28 §3` already
   implies the latter.
3. What happens when an administrator loses their TOTP device.

## Options Considered

### Option A — TOTP only for v1; WebAuthn deferred

Advantages: `SEC-007`'s "TOTP or a hardware authenticator" is an inclusive OR, so TOTP alone
satisfies it as written. TOTP is a single, well-understood RFC (6238) with universal authenticator-app
support and no browser API surface. No new client dependency, no attestation ceremony, no credential
storage beyond one encrypted secret per account.

Disadvantages: an administrator who wants a hardware key cannot use one yet. A second build is a
real, if smaller, project later.

### Option B — TOTP and WebAuthn together, from the start

Advantages: satisfies the letter of the requirement as a genuine per-administrator choice on day one.

Disadvantages: WebAuthn is a materially larger surface — challenge-response ceremonies, attestation
verification, credential public keys and counters, and a browser-side `navigator.credentials` flow —
for an administrative surface that is five endpoints, has no self-service portal, and is provisioned
by hand for what is expected to be a handful of accounts. Nothing in this codebase's client dependency
posture (`15 §10`: "minimized deliberately — every client dependency runs in the context that holds a
seat's hand") argues for carrying that weight for a surface WebAuthn's own attack surface can't even
reach.

### Option C — Self-service enrollment (a "scan this QR" first-login flow)

Advantages: closer to how most SaaS admin panels present 2FA setup; no separate out-of-band artifact
to hand the administrator.

Disadvantages: `28 §3` already specifies the account is provisioned out of band and requires a second
factor **before first use** — a self-service enrollment screen would mean the account exists,
unprotected, in the window between creation and the administrator's first login, which is exactly the
window `04 §3.3`'s "out of band only, never by self-registration" exists to close for account creation
itself. It also adds a new endpoint, a new session state ("enrollment pending"), and a new S-09
screen for a population of accounts that is provisioned by hand already.

### Option D — Out-of-band enrollment: the provisioning step generates the secret

Advantages: the secret is generated and handed to the administrator in the same out-of-band act that
creates the account — no window where the account exists without one, no new endpoint, no new
enrollment screen. Matches `28 §3`'s existing language exactly rather than reinterpreting it.

Disadvantages: requires a provisioning script (none exists today; accounts are currently provisioned
by calling `AccountRepository.create` directly with `role: "administrator"`) to also generate and
display a TOTP secret once. That script is a small follow-up, not a design gap.

### Option E — Self-service recovery codes for a lost device

Advantages: standard practice; an administrator can recover without operator involvement.

Disadvantages: needs its own hashed, single-use-tracked storage, a place to display ten codes once,
and a UI for it — real surface for an account type this codebase already treats as small-population
and hand-provisioned. `15 §8` already commits to "no break-glass path to game content," and while
recovery codes don't reach game content, the same proportionality argument that keeps the
administrative surface at five endpoints (`04 §3.3`'s "the administrative surface is deliberately
small, which is itself the principal control") argues against adding a whole recovery subsystem for
an account population this small.

### Option F — Lost device: re-provision out of band

Advantages: no new capability at all — it is the same operational procedure (`28 §3`) that created
the account in the first place, applied again. A locked-out administrator is disabled
(`PATCH /admin/accounts/{id}`, already built) and a fresh account is provisioned. Consistent with
`D-15-07`'s reasoning for no break-glass path: an absent capability has no failure mode a guard could
fail at.

Disadvantages: a locked-out administrator is unable to act until someone with existing administrative
access disables and re-provisions — an availability cost, not a security one, and one this system
already accepts elsewhere (`15 §13`: "no administrative visibility ... accepted deliberately").

## Decision

**Option A + Option D + Option F.**

TOTP only for v1 (RFC 6238: HMAC-SHA1, 6 digits, 30-second period, ±1 step drift tolerance).
Enrollment is out-of-band: a provisioning script generates the account and its TOTP secret together
and displays the secret (and an `otpauth://` URI) once, at creation time — no enrollment endpoint, no
setup screen. A lost device is recovered by disabling and re-provisioning the account, an existing
operational procedure applied again — no recovery codes, no self-service reset path.

The step-up mechanism itself: `POST /sessions` (password authentication) still issues a session for
an administrator, but that session cannot reach any `/admin/*` endpoint (`requireAdmin`) until a
**separate**, durably rate-limited call — `POST /sessions/mfa` — verifies a TOTP code and marks that
specific session as MFA-verified (`sessions.mfa_verified_at`). The session's own absolute/idle
timers (`15 §4.2`) govern the whole session uniformly; there is no separate step-up timer.

## Rationale

Every option chosen is the smaller one, and the reasoning is the same reasoning `15`, `04`, and `28`
already use throughout: proportionality (`OBJ-11`) and security by absence over security by check
(`D-15-01`). A five-endpoint administrative surface provisioned by hand for a small, known population
does not need a WebAuthn ceremony, a self-service enrollment flow, or a recovery-code subsystem to
satisfy `SEC-007` — it needs exactly one durable secret, one verification endpoint, and one durable
rate limit, which is what TOTP already is.

The step-up shape (verify against the *session*, not re-authenticate the *account*) follows `15
§4.3`'s existing reasoning for opaque, revocable sessions: the session is already the durable unit of
authorization in this system, and the alternative — re-checking the password on every admin request,
or issuing a wholly separate "admin token" — would duplicate machinery this system already has
without adding a security property `sessions.mfa_verified_at` doesn't already provide.

Serves `OBJ-06` (isolation and authorization) and `OBJ-11` (proportional design).

## Consequences

**Positive.** `SEC-007` and `TC-S05` become buildable exactly as specified. No new client dependency,
no browser API surface, no self-service admin portal. The administrative surface stays at five
endpoints plus one narrow step-up action, not a parallel enrollment/recovery system.

**Negative.** An administrator who prefers a hardware key cannot use one in v1. A lost device is an
availability incident requiring another administrator's action, not a self-service recovery — for an
account population this small, and given the existing precedent of accepting availability costs over
security shortcuts (`15 §13`), this is accepted rather than mitigated further.

**Implemented alongside acceptance**, not deferred: `15 §8`, `17 §5.1`/`§5.2`/`§7`, `18 §4.1`/`§6`,
`33_API/REST_Endpoint_Catalog.md`, `33_API/Error_Code_Catalog.md`, `SECURITY_REQUIREMENTS_MATRIX.md`,
`01 §4.11` (`FR-167`), and `32_UX/Screen_Inventory.md` (`S-09a`) all carry the amendments this ADR
motivates. The protocol itself: `auth/totp.ts` (RFC 6238), `auth/totp-encryption.ts` (AES-256-GCM),
migration `0005_admin_totp_step_up.sql`, `POST /sessions/mfa`, `requireAdmin`'s `mfa_verified_at`
check, and `web`'s `S-09a` (`MfaVerify.tsx`) plus `Administration.tsx`'s reactive redirect on a
`401 MFA_REQUIRED` from a restored-but-unverified session. `TC-S05` is concretely testable now
(`auth/http.test.ts`, `auth/service.test.ts`).

**Follow-up obligations**, still open:

- A runnable provisioning CLI. `auth/provisioning.ts`'s `provisionAdministrator` is the pure,
  tested half — building the account row, an initial password, and the TOTP secret's `otpauth://`
  URI — but wiring it to a live `pg.Pool`/`PostgresAccountRepository` and argv parsing is
  deployment-invocation machinery this codebase doesn't have anywhere yet (no bootstrap entrypoint
  either), the same gap `migrate.ts`'s own caller has always had.

## Cross References

`15_Security_Architecture.md §4.3`, `§8` · `04_User_Roles_and_Access.md §3.3` ·
`28_Operations.md §3` · `17_Database_Design.md §5.1`, `§7` · `18_API_Design.md §4.1`, `§6` ·
`SECURITY_REQUIREMENTS_MATRIX.md SEC-007` · `D-15-01` · `D-15-02` · `D-15-07` · `OBJ-06` · `OBJ-11`
