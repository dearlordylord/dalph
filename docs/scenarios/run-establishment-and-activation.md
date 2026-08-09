# Establish a Run idempotently, then activate it once

Status: accepted by the maintainer in the 2026-08-09 conversation that
requested this specification. This supersedes the earlier caller-selected
fresh-start and recovery-start scenarios. There is one production entry for an
exact Run: it establishes the Run from the Journal and then gives that
established Run to one bounded activation.

Allocating an identity for a brand-new Run may remain a separate creation
step. At the lower Journal boundary, appending a second `WorkflowRunBegan` for
one identity remains a typed error. Neither fact creates a second application
entry called recovery.

## A maintainer creates a Run whose Journal history is absent

### Starting situation

A maintainer has selected exact task-tracker target T and its Git common
directory. The creation boundary has allocated cryptographically fresh Run
identity R, but allocation alone has recorded nothing. The Journal contains no
row for R and startup discovery contains no unfinished Run in this startup scope.
Git has no worktree or ref for R, the executor has no planned-attempt work for
R, and the task tracker has no claim made by R.

The production entry has a lazy source for initial control policy P0. No code
has evaluated P0 yet.

### Trigger and ordered boundary calls

The maintainer asks Dalph to coordinate R and T. Dalph acquires exclusive
coordinator ownership for the Git common directory, scans the Journal for
unfinished Runs in the startup scope, and reads R's exact history. Because the
history is absent, Dalph evaluates and schema-decodes P0, then asks the Journal
to append `WorkflowRunBegan(R, T, P0)` atomically at position one.

After the append is acknowledged, the same entry reads and reduces R's
accepted history. It reconstructs exact R, T, and P0 and gives that established
Run to one activation. Only then may ordinary delivery record a tracker-read
intent and ask the tracker for T's complete closure. Git and the executor are
called only if later accepted delivery facts select their ordinary protocols.

The activation runs admitted actions to quiescence. It obtains at most one
later complete tracker observation for stabilization. If that observation
proves the target complete and every responsibility settled, Dalph appends one
`WorkflowRunTerminated`; otherwise this activation returns with R still
unfinished and available to the same entry later.

### Crash and retry

If Dalph exits before the beginning append is acknowledged and no row was
committed, no Run has begun and no tracker, Git, or executor call has occurred.
The caller may submit the same R and T to the same entry. It again evaluates P0
only after finding the history absent.

If the Journal committed the beginning but its response was lost, the same
retry reads the existing beginning, validates and reconstructs its exact P0,
and does not evaluate the lazy initial-policy source or ask the Journal to
append another beginning. A direct lower-level request to append the beginning
again still returns `WorkflowRunAlreadyBegan`; idempotence belongs to Run
establishment, not to weakening Journal record admission.

If Dalph exits after the beginning is acknowledged but before the first
tracker read, the same entry reconstructs R from that one beginning and starts
one later activation. It does not allocate another identity or require the
caller to classify the invocation as recovery.

### Visible and forbidden result

The maintainer sees one Run identity and either its bounded result or its
ordinary typed failure. The Journal shows one beginning, followed only by
facts produced by activation, and at most one final termination.

Dalph must not read the tracker before the beginning is durable, evaluate P0
when accepted history already supplies the policy, append two beginnings,
merge a different target under R, run two activations for one invocation, or
turn identity allocation into proof that the Run began.

### Acceptance-test and model mapping

- Application test
  `establishes an absent Run before activating its journal-backed runtime once`
  and conformance test
  `one idempotent Run entry installs the delivery service contracts` prove the
  boundary order, single entry, and single activation service surface.
- Application test
  `retries an unacknowledged Run beginning through the same entry without appending it twice`
  proves the two crash prefixes.
- Existing Journal test
  `atomically rejects a second beginning for one Run identity`
  remains the lower-boundary negative control.
- `specs/runActivation.qnt` tests
  `absentHistoryEstablishesOneBeginningTest` and
  `ambiguousBeginningAppendReconstructsSameRunTest` must collect the
  corresponding traces; invariant `oneBeginningPerRun` must reject a mutant
  that appends a second beginning.

## An unfinished Run enters the same bounded activation

### Starting situation

The Journal contains one valid beginning for R and T with initial policy P0,
then an applied capacity change to revision P1. It also contains exact planned
attempt P for task A, its worktree facts, and an executor
start-or-continue intent whose result is not yet conclusive. The process that
held A's task-work position and proposal owner has exited. The current P1
capacity is one, and independent task B would otherwise be eligible.

Git still reports P's exact worktree and lineage. The task tracker still
reports A and B in T's closure and Dalph's exact claim for A. The executor may
have accepted the last request for P. There is no process-local semaphore,
owner, fiber, or position to restore as authority.

### Trigger and ordered boundary calls

The maintainer invokes the same production entry for R and T; there is no
recovery option to select. Dalph acquires coordinator ownership, discovers
exactly one unfinished Run, reads all of R's rows, validates their identities
and chronology, and reduces them. It reconstructs T, latest policy P1, P's
exact unfinished responsibility, and the unresolved executor request. A lazy
initial-policy fallback supplied to the entry is not evaluated and cannot
replace P0 or P1.

Before admitting new task work, the activation recreates A's one held position
from P's exact unfinished responsibility and P1. It does not recreate the dead
process's owner or semaphore state. Because capacity is one, B cannot start.

The ordinary executor protocol then asks the executor for current evidence
about the exact R and P before it repeats or continues the uncertain request.
If the executor reports that P is still running, Dalph records that observation
and continues only as the accepted bounded protocol permits. If it returns the
correlated safe-suspension or terminal proof, Dalph records that proof before
making A's position available; ordinary admission may then consider B. An
unreadable or contradictory executor result grants no permission to replace P,
create another worktree, or send a duplicate request.

This activation reaches the same quiescence and one-shot tracker
reconfirmation path as the activation immediately following a new beginning.
It has no recovery-only finality shortcut or additional polling allowance.

### Crash and retry

If Dalph exits while reading or reducing the Journal, it has called no tracker,
Git, or executor boundary. The same entry repeats complete-history validation.
If it exits after reconstructing the position but before asking the executor,
the position disappears with the process and is derived again from P on the
next activation.

If the executor request or reconciliation result becomes ambiguous, R's exact
intent and accepted observations determine the next activation. Dalph checks
the executor again as required by that protocol before another request; it
does not infer from lost process memory that executor work stopped.

### Visible and forbidden result

The maintainer sees the same R continue P, wait with a typed exact reason, or
return after one bounded activation. B does not consume a second position while
A's position is owed. Once exact evidence releases A's position, B can progress
through ordinary admission.

Dalph must not ask the caller whether this is fresh or recovered, evaluate a
replacement initial policy, append another beginning, start a replacement
attempt, recreate process-local ownership as durable fact, admit B beyond P1,
repeat an ambiguous executor request before reconciliation, or apply different
termination rules because R existed before this invocation.

### Acceptance-test and model mapping

- Application test
  `re-enters an unfinished Run without evaluating the initial policy source`
  proves same-entry reconstruction and lazy-on-missing policy.
- Production-backed conformance test
  `replays idempotent Run establishment and bounded activation through production seams`
  proves reconstructed admission crosses the unified public bootstrap before
  new work is considered.
- `specs/runActivation.qnt` tests
  `existingHistorySkipsInitialPolicyTest` and
  `heldAdmissionReconstructedBeforeNewWorkTest` collect those two traces;
  invariants `existingHistorySkipsInitialPolicy` and
  `activationRestoresHeldAdmission` reject eager fallback evaluation and
  unbounded admission.
- Existing planned-attempt model invariant
  `oneReconciliationProjectionPerActivation` and production protocol test
  `requires exact command reconciliation before a generic executor-state observation`
  prove the executor ambiguity boundary. A later application test
  `reconstructs an ambiguous executor command before activating its continuation`
  must prove the Run-establishment composition rather than restating that
  protocol.
- The production-backed conformance test above and `specs/runActivation.qnt` test
  `newAndReconstructedActivationHaveFinalityParityTest` prove uninterrupted
  finality parity. The model invariant is
  `establishmentSourceDoesNotChangeActivationBounds`.

## A capacity contraction preserves both retained holders and blocks new work

### Starting situation

The Journal says R began for T with capacity two. It contains exact unfinished
responsibilities for attempts A and B, followed by an
accepted policy change that reduces the current capacity to one. The process
that admitted both attempts has exited, so its derived task-work positions no
longer exist, but neither durable responsibility has settled. Task C is
otherwise eligible. The tracker, Git, and executor do not
gain any new authority from the policy change; the Journal remains the source
of R's workflow history.

### Trigger and ordered boundary calls

The maintainer invokes the same production entry for R and T. Dalph validates
the capacity-two beginning and later capacity-one revision, reconstructs both
exact retained positions inside that entry's activation callback, and only
then asks the ordinary admission controller whether C may reserve a position.
The controller defers C because existing holders may exceed the new ceiling
but new admission may not. After exact executor evidence settles A and its
position is released, Dalph asks the same controller about C again; B still
fills capacity one, so C remains deferred.

### Crash, visible result, and forbidden result

If Dalph exits before or after reconstructing the positions, only the
process-local callback, owner, and controller disappear. The next invocation
runs the same establishment and activation entry and derives both holders from
the unchanged Journal. The maintainer sees R retain A and B while C waits.
Dalph must not evict either retained holder, treat the latest ceiling as proof
that old history is invalid, admit C after only A settles, or terminate R while
B's responsibility or position remains.

### Acceptance-test and model mapping

- Production-backed conformance test
  `replays idempotent Run establishment and bounded activation through production seams`
  checks capacity two to one, both reconstructed holders, and C's deferral both
  before and after A releases its position.
- `specs/runActivation.qnt` tests
  `contractedRetainedHolderIsRestoredDespiteCapacityTest` and
  `contractedCapacityBlocksNewAdmissionAfterRetainedHolderSettlesTest` collect
  the chronology. Invariants `activationRestoresHeldAdmission`,
  `latestPolicyControlsAdmission`, and
  `terminationRequiresEveryRetainedPositionSettled` reject eviction, admission
  above the latest ceiling, and termination with a retained holder. Negative
  tests `admissionBeyondContractedCapacityIsDetectedTest` and
  `terminationWithOtherRetainedPositionIsDetectedTest` prove those families
  can turn red.

## Existing startup history must match the exact Run and target

### Starting situation and trigger

The Journal has rows under R, but either its beginning names target T1 while
the maintainer invokes the entry with T2, its records contain a foreign Run
identity, or complete-history reduction finds an invalid chronology. A fourth
variant has no row under requested R2 but startup discovery finds different
unfinished Run R1. No new process-local action owner exists. The maintainer
invokes the Run entry for the requested identity and target.

### Ordered result, crash, and retry

Dalph acquires coordinator ownership, scans startup facts, reads every physical
row for the requested Run, decodes it, and validates complete existing history
before constructing runtime services. It returns the exact target, identity,
decoding, semantic-history, or unfinished-Run mismatch issue. It does not
evaluate a replacement initial policy, append a beginning, read the tracker,
call Git, or ask the executor to act.

A crash during this read changes no external system. Retrying the same entry
repeats validation and returns the same issue unless supported Journal contents
or the requested target changed. Manual Journal repair remains outside the
supported behavior.

The maintainer sees a typed fail-closed result naming the mismatch or retained
history issue. Dalph must not adopt T2, discard a contradictory row, ignore R1,
choose one of two beginnings, or reinterpret invalid history as absence.

### Acceptance-test and model mapping

- Application tests
  `rejects an established Run whose target differs before activation`
  and
  `blocks runtime construction when the freshly read journal prefix is invalid`
  prove two visible failures. The production-backed Run-activation conformance
  test exercises the same public entry for the single-foreign-Run case.
- `specs/runActivation.qnt` tests
  `mismatchedExistingHistoryNeverActivatesTest`,
  `otherUnfinishedRunDoesNotStandInForRequestedRunTest`,
  `invalidExistingHistoryNeverActivatesTest`,
  `duplicateBeginningHistoryNeverActivatesTest`, and
  `foreignRunRecordHistoryNeverActivatesTest` collect the distinct mismatch,
  R1/R2, chronology, duplicate-beginning, and foreign-record cases;
  invariant `onlyExactEstablishedRunActivates` rejects an exact Run or target
  mismatch, while `activationStartsAfterDurableBeginning` rejects activation
  from invalid history. Negative test `invalidHistoryActivationIsDetectedTest`
  proves the latter family can turn red.

## Multiple unfinished Runs block every activation

### Starting situation and trigger

The Journal contains two valid, unterminated histories R1 and R2 in the startup
scope. Each has its own exact target and policy. No coordinator currently owns
either Run and no process-local action is live. A maintainer starts Dalph for
that scope; no GitHub, Git, or executor event triggered the ambiguity.

### Ordered result, crash, and retry

Dalph acquires coordinator ownership and scans all Journal rows. It discovers
both unfinished identities before establishing or activating either one and
returns the typed startup failure naming R1 and R2. It performs no task-tracker,
Git, or executor request for either Run, does not evaluate an initial policy,
and does not append a beginning or termination.

A crash during discovery changes no authority system. A retry repeats the scan
and remains blocked while both histories are unfinished. Selection or
disposition of one history requires a separately accepted operator behavior;
recency, Journal position, target order, or a caller's recovery label cannot
choose a winner.

The maintainer sees both identities in one fail-closed result. Dalph must not
activate the first row, the newest Run, a caller-selected Run, or both Runs;
and one Run's responsibilities must not be folded into the other.

### Acceptance-test and model mapping

- Application test
  `names every unfinished Run and activates none when startup discovery finds several`
  proves the scan and no-boundary result.
- `specs/runActivation.qnt` test
  `multipleUnfinishedRunsBlockEveryActivationTest` collects this trace;
  invariant `atMostOneDiscoveredUnfinishedRunMayActivate` must reject a mutant
  that chooses either identity.

## A terminated Run never reaches activation

### Starting situation and trigger

The Journal contains one valid beginning and one valid termination for R. All
of R's workflow responsibilities ended before termination, no coordinator owns
its target, and no process-local resource survives. The maintainer submits R
and its exact target to the same production entry again.

### Ordered result, crash, and retry

Dalph reads and validates R's closed history and returns
`WorkflowRunAlreadyTerminated` before it constructs activation services or
reads the tracker, Git, or executor. A lost response to the original
termination append changes nothing: the later entry observes the accepted
termination and cannot append it or any other record again.

Repeating the entry returns the same terminal result. If the maintainer wants
another coordination Run for the target, the separate creation boundary must
allocate another fresh identity and establish that new identity. It does not
reopen R.

The maintainer sees that R is closed. Dalph must not activate R, append after
termination, append a second termination, reuse R for a new target, or treat a
newly allocated identity as a continuation of R.

### Acceptance-test and model mapping

- Application test
  `rejects a terminated Run before constructing activation`
  proves the application boundary.
- Existing Journal test
  `rejects every workflow record after Run termination` remains the durable
  negative control.
- `specs/runActivation.qnt` test
  `terminatedHistoryNeverActivatesTest` collects the trace; invariant
  `terminatedRunIsFinal` must reject a mutant that appends or activates after
  termination.

## Scenario-to-test handoff contract

The implementation handoff must report every scenario above against its named
application or production-backed conformance test, the named `runActivation`
model test and invariant, and the existing Journal or planned-attempt model
seam where one is cited. Repository-wide typechecking, coverage, or
model-checking totals cannot replace the mapping.
