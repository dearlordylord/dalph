# Handoff: implement and validate issue #132 activation ownership

Use the `implement`, `domain-modeling`, `tdd`, `effect`, `quint-modeling`,
`quint-lang`, `property-based-testing`, and `code-review` skills. Work on
`master` with pnpm.

## Objective

Implement
[the accepted activation ownership decision](../issue-132-activation-ownership-decision.md)
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
- Expose only trigger signaling from the activation loop; triggers carry no
  transition or order key.
- Make exact ownership insertion atomic before forking and return a typed
  duplicate-activation issue.
- Remove `awaitAdmission` and its waiter ordering. Return `CapacityWait`, then
  signal rederivation after release, cancellation, or fresh non-consumption.
- Before Dalph asks the tracker, Git, executor, or task-work provider to change
  state, the activation coordinator may cancel the exact pre-intent reservation
  and derive again. After intent, it retains the exact `OperationId` and uses
  the operation's fresh-result-check and reconciliation rules.
- Execute one exact selected workflow operation, record its returned result,
  and read current reconstructed state before selecting another operation.
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

Required test lanes:

- two concurrent triggers for one exact transition;
- interruption before ownership, after ownership/before intent, and after
  intent;
- result recording, exact release, and rederivation;
- delayed A-17 release after A-18 occupies capacity;
- in-memory and closed/reopened SQLite `8 → 2`, `1 → 2`, and `2 → 1`;
- generated activation/controller command sequences; and
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
