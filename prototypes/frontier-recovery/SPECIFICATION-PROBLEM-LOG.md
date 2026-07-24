# Specification problem log

This file records genuine problems found in the accepted Dalph specification
while building and checking the bounded frontier model. Model implementation
bugs, incorrectly stated properties, and verification-tool limitations are
recorded separately below so they are not mistaken for domain decisions.

## Confirmed specification problems

None confirmed.

## Findings under investigation

None.

## Rejected as specification problems

### MODEL-008 — provider wait was also labeled a coordinator action

The exact-disposition property already classified a running executor invocation
as a nonterminal wait for the provider's terminal observation. Its first
encoding also counted that external provider transition as a coordinator
action. The duplicate coordinator-side classification has been removed, so
the property now states the concrete actor and wait boundary correctly. The
accepted workflow behavior did not change.

### MODEL-007 — exhaustive crash profile covered only claim acquisition

The safe model's general transition relation allowed one crash at any durable
prefix, but the first focused exhaustive crash profile initialized only the
claim boundary. It therefore did not substantiate issue #122's requested
coverage at every intent/outcome boundary. The profile now starts
nondeterministically at all eight ambiguity-crossing boundaries and includes
both fresh-claim and existing-responsibility intent commits. This was a
verification-profile omission, not missing recovery policy.

### MODEL-006 — grouping descendant freshness omitted the parent command revision

Task `D` is a grouping child of task `A`. The model correctly derived that an
`A` pause covers `D`, but its first freshness predicate compared `D` only with
`D`'s direct task-control epoch. After `A` resumed, `D` could therefore reuse
knowledge recorded before the grouping pause. Knowledge now records and checks
an effective task-control epoch that includes the covering parent's command
revision. This implements the already-accepted fresh-observation-on-resume
rule; it does not add or change specification policy.

### MODEL-005 — unreadable observations remained enabled past the read bound

The first observation guard treated every non-usable observation as an
unconditional reason to read again. An unreadable authority could therefore
produce an unbounded sequence of durable observation revisions even after the
declared two-read limit. The guard now permits an unreadable retry only while
`unreadableCount < READ_BOUND`; a fresh authority, activation, or control
revision can still independently require a new observation. This enforces an
already-accepted bound rather than adding policy.

### MODEL-004 — unbounded control changes met a capped observation ordinal

TLC found a pause-profile trace that alternated task pause and resume until the
model's artificial maximum durable observation revision was reached. The next
control change then required a fresh observation that the model had disabled,
leaving owned work neither actionable nor dispositioned. The accepted
specification does not cap the journal's durable revision ordinal.

The finite abstraction now bounds run and task control changes explicitly and
lets the durable observation ordinal be derived from those and the other
already-bounded events. This was an inconsistent pair of model bounds, not a
missing domain policy.

### MODEL-003 — incomplete non-actionable-reason encoding

TLC found `everyTaskIsActionableOrExplained` counterexamples in the all-boundary
profile. Three reasons already present in the accepted specification were missing
from the predicate/model:

1. fresh task `D` was runnable but not immediately admissible because the
   deterministic scheduler must admit smaller task `C` first; and
2. a fresh task remained runnable but waited because both admission positions
   were reserved; and
3. a request that twice produced a fresh authoritative absence had exhausted
   its accepted bounded retry policy but had not yet been classified as typed
   non-convergence.

The model now names deterministic admission ordering as a non-actionable reason
and adds `RequestDidNotConvergeIsolated`. This was incomplete model coverage,
not missing domain policy.

### MODEL-001 — branch progress while coordinator is crashed

The first `branchLocalConstraintDoesNotStopC` predicate demanded immediate task
`C` admission while the coordinator was not running. Restart was the exact
legal wake action, so this was a property bug. The invariant now scopes
immediate admission to a running coordinator.

### MODEL-002 — one intent identity per boundary

The first instrumentation stored only the latest operation identity for each
boundary. Pause followed by interruption legitimately creates a later executor
invocation at the same `InvocationBoundary`, so the model falsely rejected the
history. Instrumentation now retains all operation identities and detects a
duplicate only when the same identity crosses its boundary twice. This matches
the accepted stable-identity retry rule and does not change the specification.

### TOOL-001 — monolithic Apalache profile

Apalache's SMT encoding did not complete the nested-map model at depth 6 within
several minutes. This is a verification-profile/tool-fit issue, not a protocol
finding. The same finite model is checked with explicit-state TLC profiles via
`quint verify`; all reported coverage names the initializer, step, backend, and
depth.

### TOOL-002 — TLC ignores Quint's trace-depth option

With Quint 0.32.0, the TLC backend exhausts the finite reachable state graph
and does not pass `--max-steps` to TLC. A pause-profile invocation carrying
`--max-steps=8` reached graph depth 100. Verification reports therefore record
the observed exhaustive graph depth rather than claiming that the CLI option
bounded TLC traces.
