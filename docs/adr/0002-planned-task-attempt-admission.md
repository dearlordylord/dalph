# Observe claimed-task eligibility before planning an attempt

Status: Accepted

Dalph records a planned task attempt only after it has durably recorded a fresh
claimed-task eligibility observation for the same task identity and task
revision fingerprint. This decision replaces the misleading
`TrackerExecutionAdmitted` term and defines the exact causal evidence required
by planning and recovery.

## Decision

After GitHub or another task tracker confirms Dalph's exact task claim, Dalph
selects one read-only `ObserveClaimedTaskEligibility` workflow operation. The
operation:

1. records its observation intent in the Dalph workflow journal;
2. rereads the exact task claim and requires the requested task, owner, and
   token;
3. reads the current task graph;
4. classifies the claimed task against that graph; and
5. records one typed positive or negative outcome in the journal.

The operation creates, attaches, changes, and deletes no task-tracker label. In
the GitHub adapter, the claim remains a uniquely named repository label object,
not a label attached to the issue. Attaching it would add another
state-changing request and another fact that could disagree without preventing
users from changing the issue.

`ObserveClaimedTaskEligibility` carries:

- its own `OperationId`;
- the task-tracker target;
- the exact `TaskClaimAcquisition` request, including `TaskId`,
  claim-acquisition `OperationId`, owner, and token; and
- exactly that claim-acquisition operation as its causal predecessor.

The embedded acquisition request states what the interpreter must verify. It is
not proof that the tracker accepted the claim. A production interpreter
requires the matching durable `TaskClaimAcquired` outcome and a fresh exact
claim read before it evaluates the task graph.

## Outcomes

The positive durable outcome is `ClaimedTaskEligibilityObserved`. It proves
that the claimed task was present in the current task-tracker target closure,
open, and free of unsatisfied prerequisites. It carries:

- the eligibility-observation `OperationId`;
- the exact `TaskId`;
- the task revision fingerprint; and
- the `TrackerRevision` of the complete graph snapshot evaluated.

The negative durable outcome is the following exhaustive tagged union:

- `ClaimedTaskMissingFromTargetClosure`, carrying the operation identity,
  claimed `TaskId`, and tracker revision;
- `ClaimedTaskNotOpen`, additionally carrying the task revision and observed
  lifecycle; or
- `ClaimedTaskPrerequisitesUnsatisfied`, additionally carrying the task
  revision and the exact unsatisfied prerequisite identities with their
  observed lifecycles.

Classification is deterministic: missing from the closure first; otherwise
non-open; otherwise open with at least one unsatisfied prerequisite. The
unsatisfied-prerequisite collection is non-empty, unique by `TaskId`, and
sorted by the shared `TaskId` comparator: ascending Effect `Order.String` over
each branded identity's canonical string value. Graph projection and journal
Schema encoding use that same comparator; tracker response order and
locale-sensitive comparison cannot affect the durable payload.

The tracker revision identifies the complete graph observation, including
prerequisite lifecycles. The task revision fingerprint identifies the claimed
task's normalized content. Neither substitutes for the other, and neither is
treated as current tracker state during recovery.

## Causal graph

The accepted direct edges are:

```text
AcquireTaskClaim
  └─ TaskClaimAcquired
       └─ ObserveClaimedTaskEligibility
            └─ ClaimedTaskEligibilityObserved
                 └─ RecordTaskAttemptPlan
                      └─ TaskAttemptPlanned
```

The eligibility-observation operation directly names the claim-acquisition
operation. The planned-task-attempt recording operation has exactly one direct
predecessor: the eligibility-observation operation whose durable positive
outcome matches its `TaskId` and task revision fingerprint. Repeating the claim
operation as a second direct planning predecessor would duplicate an edge
already required transitively.

`TaskClaimAcquired` alone cannot authorize planning because a claim does not
freeze task or graph state. A generic `TrackerGraphOutcomeObserved` cannot
authorize planning because it summarizes a whole graph read without recording
the combined exact-claim, eligibility, and task-revision conclusion.

## Negative observations

A completed negative observation stops the current workflow or recovery pass
with a typed result. Dalph does not immediately reread the tracker in a loop,
record a planned task attempt, or reinterpret the negative result as an
unresolved observation.

The negative result is not a permanent terminal disposition for the task. A
later explicit tracker-refresh policy may select a new eligibility-observation
operation under the same freshly verified exact claim after tracker state
changes. This decision does not define that refresh policy. Until one runs,
Dalph preserves the exact task-tracker claim and journal history.

## Coordinator-death recovery rules

Only durable outcomes are workflow evidence:

- If the Dalph coordinator recorded observation intent but its process ended
  before recording an outcome, recovery repeats that same read-only operation
  and records the current positive or negative result. A lost in-memory read
  proves neither the current claim nor current task eligibility and cannot
  authorize a planned task attempt.
- If the Dalph coordinator recorded a positive eligibility outcome but its
  process ended before recording a planned task attempt, recovery selects a new
  eligibility-observation operation and freshly verifies the claim and graph
  before planning.
- If Dalph already recorded `TaskAttemptPlanned`, recovery preserves that exact
  attempt identity, Base SHA, branch, worktree, executor, session locator,
  `TaskId`, and task revision fingerprint. If fresh task-tracker, Git, or
  task-work-provider reads contradict those recorded identities or locators,
  recovery returns a typed contradiction; it never silently replans.
- A missing, replaced, foreign, or unreadable current claim produces a precise
  typed recovery result. Durable claim history does not substitute for the
  fresh task-tracker read.
- A completed negative observation remains completed for its operation and
  returns the typed stopping result instead of being retried as an unresolved
  read.

No current outcome authorizes a replacement planned task attempt. Recovery
continues an acknowledged attempt, recognizes its terminal disposition, or
returns a typed recovery result. A future replacement-attempt capability
requires a separately specified authorization phenomenon and durable event.
Technical retry exhaustion, semantic non-convergence, loss of a planned Git
worktree or task-work session, coordinator process death, and a new operation
identity do not imply replacement authorization.

## Layer composition

Dry-run and other simulated compositions select
`ObserveClaimedTaskEligibility` with the same request and causal shape as
production. Their distinct simulated eligible and ineligible outcomes may
project task, revision, lifecycle, and prerequisite values from a normalized
fixture, but claim no real task-tracker or GitHub claim-label observation.

The workflow branches only on eligible versus ineligible domain outcomes:

- every negative result returns the typed stopping result and selects no
  planned-task-attempt recording operation;
- every positive result selects the same planned-task-attempt recording
  operation.

Layers determine recording behavior. A journaled recorder independently
requires a matching durable `ClaimedTaskEligibilityObserved` predecessor before
it appends `TaskAttemptPlanned`; a simulated positive result therefore cannot
cross that boundary. A simulated recorder appends nothing. The workflow does
not branch on production, dry-run, authoritative, or simulated runtime
identity.

## Rejected alternatives

- Keep `TrackerExecutionAdmitted`: rejected because a task tracker does not
  execute or admit execution.
- Name the fact after planned-task-attempt recording: rejected because that
  leaks the first consumer into a tracker-derived observation.
- Enlarge every generic graph outcome with every task fingerprint: rejected
  because only the selected claimed task needs exact planning evidence.
- Attach the GitHub claim label to the issue: rejected because it adds a second
  state-changing request and a second claim representation that can disagree
  with the uniquely named repository label without strengthening exclusion.
- Treat absence of a positive outcome as ineligibility: rejected because it
  cannot distinguish a completed negative read from interruption or read
  failure.
- Add an explicit workflow mode branch: rejected because Layers interpret one
  operation algebra.
- Infer a replacement attempt or ordinal: rejected because no accepted outcome
  authorizes replacement.

## Consequences

The workflow algebra, journal schema, managed-history reducer, and recovery
model must represent the eligibility-observation intent, its authoritative and
simulated outcomes, and the causal validation described above. Journal schema
evolution must preserve readable prior history without treating a legacy
generic graph observation as eligibility evidence.

The canonical glossary uses **claimed task eligibility observed**. The accepted
operation and outcome names supersede `TrackerExecutionAdmitted`.
