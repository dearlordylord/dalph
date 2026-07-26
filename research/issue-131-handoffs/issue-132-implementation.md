# Handoff: implement and validate issue #132 activation ownership

Status: implementation-ready from the accepted
[Define exact activation ownership and admission handoff](https://github.com/dearlordylord/dalph/issues/151)
owner decision. Production behavior remains open.

Use the `implement`, `domain-modeling`, `tdd`, `effect`, `quint-modeling`,
`quint-lang`, `property-based-testing`, and `code-review` skills. Work on
`master` with pnpm.

## Objective

Implement
[the exact activation ownership and admission handoff](../issue-132-activation-ownership-decision.md)
for
[Activate fresh and recovered work through one loop](https://github.com/dearlordylord/dalph/issues/132).
Replace the fixed startup/recovery activation topologies and the controller's
dormant `awaitAdmission` queue with one scoped coordinator loop, exact
activation ownership, and rederivation after any controller change that may
permit admission.

Do not absorb the executor-boundary migration from issue #133, pause commands
from issues #134/#135, live resizing from issue #54, or traversal/conflict work
owned by issues #53/#55.

## Required implementation

- Add the branded selected-transition identity and the internal owned-
  transition capability. Document the phenomenon above each branded type.
- Expose only trigger signaling from the activation coordinator; triggers carry no
  transition or order key.
- Keep admitted and owned transition constructors internal to the activation
  coordinator. Trigger callers must have no API that can submit,
  claim, or execute a transition.
- Implement reservation, ownership registration, and scoped-runner start as one
  interruption-masked handoff. Before an unsuccessful handoff returns or dies,
  make its exact newly reserved position available and remove partial
  ownership.
- Before applying capacity on a later pass, exclude exact transitions already
  represented by the private activation-ownership snapshot and emit
  `ActivationInProgress` without changing the order of remaining transitions.
- Remove `awaitAdmission` and its waiter ordering. Return `CapacityWait`, then
  signal rederivation after release, cancellation, or fresh non-consumption.
- Before Dalph asks the tracker, Git, executor, or task-work provider to change
  state, the activation coordinator may make the exact pre-intent reserved
  task-admission position available and derive again. After intent, it retains
  the exact `OperationId` and uses the operation's fresh-result-check and
  reconciliation rules.
- Serially select and admit one transition, establish its scoped
  owned-operation runner, and read current reconstructed state before selecting
  another transition without waiting for the earlier runner's final result.
  Each runner executes one exact workflow operation, records its returned
  result, releases ownership, and signals the coordinator.
- Use one workflow algebra and injected interpreter in dry-run, live-fake,
  deterministic-test, and production compositions.
- On restart, honor current configured capacity without preempting fresh
  occupied invocations.

## Model and executable coverage

Extend the existing frontier-recovery Quint model and adapter with every action,
invariant, witness, and negative profile named in the accepted decision. Do not
create a third model. Update the closed action map, versioned projection,
Quint-connect driver, model gate, and reconstruction coverage inventory in the
same dependency path.

If state explosion requires focused exhaustive profiles, every positive model
action and compared field must remain executable through the same closed
Quint-connect adapter and production projection. Record explored states and
wall time, retain sampled full-composition traces, and never make a profile
tractable by weakening its invariant or assigning expected implementation
state.

Required test lanes:

- two concurrent triggers for one exact transition;
- rederivation while one pre-intent and one post-intent runner remain live,
  proving neither exact transition is readmitted;
- mixed-time projection where reconstructed state is read before intent while
  the ownership snapshot is read after intent; immutable selection correlation
  still excludes the owner, while only `OperationId` identifies post-intent
  boundary work;
- a weakened M2 action that omits only owned-transition exclusion and must
  violate `ownedTransitionIsNotReadmitted`;
- a weakened duplicate-rejection action that leaks its reserved position or
  stops independent C and must violate the corresponding exact cleanup or
  independent-progress invariant;
- a generated Quint-connect prefix `own → derive before result` whose
  production projection must return `ActivationInProgress` and exactly one
  runner;
- capacity-N serialized admission with overlapping owned-operation runners;
- interruption before ownership, after ownership/before intent, and after
  intent;
- coordinator-only crash while provider workers survive, coordinator/worker
  co-failure, and mixed survival; the deterministic harness must control these
  as separate process-lifetime boundaries even though production deployment is
  local;
- result recording, exact release, and rederivation;
- delayed A-17 release after A-18 occupies capacity;
- in-memory and closed/reopened SQLite `8 → 2`, `1 → 2`, and `2 → 1`;
- generated activation/controller command sequences; and
- a subject-local activation or boundary issue for A while independent C
  remains selectable; and
- all positive witnesses and expected counterexamples named by the decision.

## Acceptance return

Return:

- production API and deleted superseded symbols;
- exact model profiles and counterexamples;
- focused TDD commands and results;
- in-memory and SQLite reopening evidence;
- domain/spec, architecture/connascence, and strict code-review dispositions;
- `pnpm check:all`; and
- the commit.

Preserve issue #132's acceptance scenarios and blocking edges. Do not mark the
issue complete until the owner accepts the implementation result.
