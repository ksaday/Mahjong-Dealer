# ADR-0010 — Persistence: in-memory authority with encrypted checkpoints

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 16_Data_Architecture.md |
| **Deciders** | Project owner |

## Context

Live table state has to live somewhere, and a server restart must not destroy four people's game.
Those two requirements pull in different directions: the first wants speed, the second wants
durability.

A third consideration decides between the options, and it is specific to this system. **Any durable
record complete enough to restore a game necessarily contains concealed hands and the wall order.**
There is no version of crash recovery that avoids this. The question is therefore not whether to
store concealed material but how long it exists and how it is protected — which makes the *shape*
of the persistence model a privacy decision, not merely an availability one.

## Options Considered

### Option A — Ephemeral only

Advantages: strongest possible privacy — nothing about a live game ever touches disk.

Disadvantages: a restart destroys every in-progress table. Reconnection after a crash is impossible.
For a game lasting an hour, a routine deploy becomes destructive.

### Option B — Full event sourcing

Advantages: excellent auditability and debuggability; state is a fold over events; replay is
recovery.

Disadvantages: the event stream necessarily contains every concealed action, so it is a permanent
record of every hand ever held. Purging it destroys the recovery mechanism, so the record tends to
be kept — and a permanent record of concealed hands is a standing liability with no offsetting
benefit here. There is no economy to audit and no dispute a record could settle that the players
cannot settle themselves.

### Option C — Database as the authoritative store

Advantages: durability is automatic; no recovery logic.

Disadvantages: every action pays a database round trip inside the acknowledgement path, and the
concurrency problems the single-writer actor eliminates (`ADR-0009`) come back as row locking.

### Option D — In-memory authority with encrypted checkpoints and a public-only event log

Advantages: acknowledgement latency is independent of disk; crash recovery is bounded to one action;
concealed material exists only inside encrypted checkpoint blobs with a short, defined lifetime; the
retained event log carries no faces at all, so it is safe to keep, back up, and read during an
incident.

Disadvantages: recovery logic must be written; up to one action can be lost to an unclean crash; the
in-memory state and its checkpoints must be kept consistent.

## Decision

**Option D.**

| Store | Contents | Lifetime |
|---|---|---|
| Process memory | Authoritative live table state | While the table is live |
| Encrypted checkpoints | Complete state — hands, wall, discards, exposures, flags, pointer | Rolling; purged at game close |
| Public event log | Public events only; no tile face that was not already public | Retained |
| Relational tables | Users, sessions, tables, seats, games as metadata | Retained |

Checkpoints are encrypted at the application layer, written **asynchronously** so disk latency never
enters the acknowledgement path, and taken at every public action boundary. All concealed material
is purged within sixty seconds of game close (`NFR-013`).

## Rationale

Option A was taken seriously — it is the strongest privacy position available — and rejected because
it makes a routine deploy destructive to games in progress. That is not an edge case; it is a weekly
event, and four people losing an hour's game to it is a real harm.

Option B is the conventional choice for a system like this, and the reason for declining it is worth
stating clearly. Event sourcing's central benefit is a permanent, complete history. Here that
history is a permanent, complete record of every concealed hand. The benefit it would buy — audit
and dispute resolution — has no application: there is no economy (`ADR-0003`), and a disagreement
about a hand is settled by the players, who were there. Paying a permanent privacy liability for an
unused benefit is a bad trade.

Checkpoints, by contrast, are **bounded by construction**. They exist to restore a live table, so
their natural lifetime ends when the table's game does, and purging them is not a loss of anything
the system uses.

The **asynchronous write** matters more than it appears. Putting the checkpoint in the
acknowledgement path would make every player's tile movement wait on a disk flush, which is exactly
the kind of latency that makes an interface feel remote rather than immediate (`FC-3`).

The cost — up to one action lost on an unclean crash — is stated plainly in `NFR-031` rather than
implied away. In practice a player repeats a discard.

A second benefit is worth noting: checkpoints at action boundaries are exactly what the correction
mechanism needs (`ADR-0016`), so the two features share a mechanism rather than each building one.

Serves `OBJ-05`, `OBJ-06`, `OBJ-11`.

## Consequences

**Positive.** Latency independent of disk. Crash recovery bounded to one action. Concealed material
has a short, defined lifetime and is encrypted throughout it. Backups routinely contain no hands.
The retained event log is safe to read during an incident.

**Negative.** Recovery logic to write and test. One action may be lost. No permanent gameplay
history, so a defect cannot be diagnosed by replaying a past game.

**Follow-up obligations.** `16` must specify checkpoint contents, cadence, retention, and purge.
`17` must specify encryption and key handling. `TC-F01` must verify kill-and-restore. `TC-P04` must
verify that no concealed material survives game close. The conservation invariant must be verified
on every restore.

## Cross References

`16_Data_Architecture.md` · `17_Database_Design.md` · `05_Game_Table_Architecture.md §6` ·
`29_Disaster_Recovery.md` · `ADR-0012` · `ADR-0016` · `NFR-030`–`NFR-032`, `NFR-013`
