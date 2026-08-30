# Issues 264–270 execution plan

Status: active follow-on plan, recorded 2026-08-30.

This document lets a new implementation session continue the autonomous
executor-work sequence without reconstructing the preceding integration and
review. It changes no Dalph runtime behavior.

## Starting point

- Issue #264 is implemented on `master` by merge commit `db8e5763d` and the
  documentation follow-up `cabc0ae62`.
- The implementation was verified with `pnpm check:all`, the focused executor
  model-based tests, and one final `pnpm check:quint` run. Repeated unchanged
  `ExecutorWorkExecuting` observations create no additional executor command,
  accepted report, proposal identity, report ordinal, or command-budget entry.
- Issue #265 has an implementation candidate under focused review. It attaches
  one process-local passive lifecycle owner, publishes a later Safe or Terminal
  change through the ordinary serialized report protocol, reconstructs the
  owner from durable history after same-host restart, and fails closed on
  unresolved non-exact evidence. It is not integrated until the scenario and
  focused review gates below are green.
- Issue #266 behavior was already present in the integration baseline before
  #264 was merged. Its notification/timer owner and task-local consequences are
  useful, but its private Git-read history protocol contradicts #266's accepted
  requirement to reuse the ordinary #190/#53/#164 read owners.
- The #266 scenario is
  `docs/scenarios/issue-266-active-work-authority-refresh.md`; it attributes the
  behavior to #266 and uses the accepted executor lifecycle vocabulary.
- A direct rejected-handoff acceptance test already exists:
  `retains one trailing ordinary activation when the active handoff rejects`.
  Do not add a test-only production seam or duplicate this test.
- Preserve the separate #270 candidate at
  `origin/integrate/live-mvp-270-sync@82c922c7f`. Do not compose it until the
  #264–#269 stack is ready for combined verification.

The primary worktree also contained unrelated staged tooling edits when this
plan was recorded: `package.json` and `scripts/run-typecheck.mjs`. A later
session must inspect and preserve them rather than assuming they belong to one
of these tickets.

## Accepted review findings

### Repair now

1. Implement #265 before accepting #266 as complete.
2. Remove #266's `ActiveWorkAuthorityRefreshGitReadOperation`, private intent
   event, refresh ordinal, failed-read event, record key, replay runner, and
   special interpreter routing.
3. Send active-work graph, focused tracker, worktree, and target-lineage reads
   through the existing ordinary journal-first protocols owned by
   #190/#53/#164.
4. Keep the active-work refresh scenario linked to #266 and use the accepted
   executor lifecycle vocabulary.
5. Correct the rejected-handoff scenario mapping to name its existing direct
   acceptance test.

### Do not act on

- Do not roll back or unpush `master`. The dependency inversion existed in the
  baseline; fixing forward is safer and more reviewable.
- Do not expand #264 to implement #265. #264 owns the passive boundary
  semantics inside one independently admitted owner; #265 owns later live and
  restart observation scheduling.
- Do not reject #264 merely because its contract and vocabulary migration was
  broad. Its breadth is a review-cost warning for later work, not evidence that
  its central behavior is wrong.
- Do not add another rejected-handoff test. Repair the stale documentation.

## Execution order

### 1. Record and close #264

Perform a focused issue audit against
`docs/scenarios/issue-264-autonomous-executor-work.md`, record that the accepted
boundary is satisfied, and close #264 without adding #265 behavior.

Scenario-to-test mapping:

- Begin once and observe unchanged executing work → `observes unchanged
  executing work more than three times without durable events or another
  command`, `beginOnceAndObserveExecutingFiveTimesTest`, and
  `unchangedObservationMutationIsDetectedTest`.
- Accept a changed terminal observation → `records a distinct terminal
  observation after unchanged executing work`,
  `passiveTerminalObservationAppendsDistinctReportTest`.
- Preserve a pending terminal observation across restart → `accepts a pending
  terminal state observation after restart without another executor call`.
- Settle suspension separately from lifecycle acceptance → `settles an
  unchanged suspension response without appending another work report` and
  `unchangedSuspendResponseSettlesWithoutNewReportTest`.
- Resume only the same accepted safely suspended attempt → the named Resume
  scenarios in the issue-264 scenario and planned-attempt executor model.

### 2. Review and integrate #265: passive lifecycle observation through restart

The accepted chronological scenario is
`docs/scenarios/issue-265-passive-executor-observation-through-restart.md`.
The implementation and review must preserve these real events:

1. Dalph has accepted `ExecutorWorkExecuting` for exact `(RunId, AttemptId)`.
2. A process-local observer first reads the executor's exact current
   projection without any Begin, Resume, suspension, tracker, Git, cleanup, or
   Journal-writer capability.
3. An unchanged executing projection appends nothing and awaits or schedules a
   later passive change without busy looping.
4. A later exact Safe or Terminal projection is published, accepted once at
   the next report ordinal, and releases only that attempt's position.
5. After process loss, when history contains no pending or unresolved
   executor-state observation evidence, Dalph reconstructs the exact
   responsibility and command history, performs one current projection, then
   reattaches. It never repeats Begin because process-local ownership
   disappeared. A pending exact observation follows its existing acceptance
   path instead.
6. The serialized protocol records absent, unavailable, unreadable, or foreign
   projections as typed non-exact observation or contradiction evidence. That
   evidence remains unresolved and non-authoritative, the attachment ends, the
   responsibility and position remain, and no successor or passive reread is
   scheduled.

Required scenario-to-test mapping:

- Live executing → Terminal change → a named vertical test asserting one
  Begin, one terminal acceptance, next ordinal, and one position release.
- Live executing → Safe change after an exact suspension intent → a named
  vertical test asserting only the exact attempt is released.
- Several unchanged projections → a named controlled-clock test asserting no
  duplicate Journal report and no busy loop.
- Restart while executing with no pending or unresolved observation evidence →
  a named production-composition test asserting one current reprojection,
  observer reattachment, and zero repeated Begin calls.
- Process loss before and after a changed observation → named crash-cut tests
  asserting exactly-once acceptance.
- Absent/unavailable/unreadable/foreign projection → a parameterized test
  asserting typed unresolved non-authoritative evidence, an ended attachment,
  retained responsibility and position, no successor, and no scheduled reread,
  including after restart.
- Capability restriction → a contract or Layer test proving the passive owner
  cannot call tracker, Git, cleanup, or executor mutation boundaries.

Run focused executor protocol, delivery-runtime, restart, capacity, and
production-composition tests while developing. Run `pnpm check:quint` only if
the model or its executable conformance adapter changes.

Rejected standards finding: restart must always reproject after an unresolved
typed projection failure. Issue #265 requires the responsibility and position
to remain and authorizes no successor, but grants no failure-resolution or
retry rule. The current Quint model's `recoverActivation` action requires
`NoEvidence`, and no action clears a recorded non-exact fresh-state projection.
Reprojection from that prefix would therefore invent authority absent from the
accepted issue and model; a separately accepted rule must first define how the
evidence is resolved and when another passive read is admitted.

### 3. Reconcile and complete #266

The scenario is
`docs/scenarios/issue-266-active-work-authority-refresh.md`; keep the scenario
catalog and #266 link current, and use `ExecutorWorkExecuting`,
`ExecutorWorkSafelySuspended`, and `ExecutorWorkTerminal` consistently.

Preserve:

- #218's one serialized notification/timer opportunity owner;
- coalescing and at most one trailing ordinary activation;
- enumeration of every exact executing attempt;
- task-local changed-instruction, claim, worktree, and lineage consequences;
- no continuation command after healthy reads;
- unreadable evidence authorizes neither continuation nor suspension; and
- exact `ExecutorWorkSafelySuspended` or `ExecutorWorkTerminal` evidence is
  required before releasing a position.

Remove:

- the active-refresh-specific Git operation wrapper;
- its authority and ordinal history;
- its separate intent and failure events and record keys;
- its replay implementation; and
- the interpreter branch selecting it instead of ordinary Git reads.

The active-work opportunity may select which ordinary reads are needed, but it
must not own a second read protocol or cache.

Scenario-to-test mapping:

- Live healthy notification → existing `production owner refreshes Running
  work once for a TrackerNotification without an executor command`.
- Accepted B/F2 with A1/B1/C1 executing → required direct vertical seam that
  calls `Suspend(B1)` only, retains B1's position until exact
  `ExecutorWorkSafelySuspended` or `ExecutorWorkTerminal` acceptance, and
  leaves A1/C1 executing.
- Lost or pre-subscription notification → required controlled-timer seam;
  existing `configured timer refreshes a Running attempt and suspends it after
  its exact worktree is lost` proves only that Timer can supply an opportunity.
- Notification, timer, and accepted-publication coalescing → required direct
  production seam with one active read and one trailing ordinary activation;
  existing owner/production coalescing tests remain narrower support.
- Complete authoritative missing or foreign exact claim and lost worktree →
  existing localized projection tests; changed instructions,
  lifecycle/membership/blocker constraints, incompatible lineage, and the
  complete three-attempt chronology still require the parameterized vertical
  seam named by the scenario.
- Incomplete, unavailable, unreadable, malformed, throttled,
  cross-repository, or foreign-correlation graph/focused/Git boundary failure →
  required typed vertical seam with no command, no busy-loop, and a later fresh
  opportunity. These uncertain failures do not include a complete missing or
  foreign exact claim observation. Existing Git-failure waits and existing
  task-fact positive and mutation-catching negative model tests are supporting
  evidence only; #266 requires no Quint change.
- Rejected active handoff → existing direct `retains one trailing ordinary
  activation when the active handoff rejects`.
- Pause, Exit, restart with no timer/hint state, and #194 finality-read
  separation → required direct seams; existing run-reactivation owner and
  projection tests prove only their narrower timer, drain, and ordering rules.
- Crash after an ordinary read intent or response loss → required revised
  recovery tests proving #190/#53/#164 and the ordinary focused/Git owners reuse
  their operation identities. Private `ActiveWorkAuthorityRefreshGitRead...`
  fixtures and refresh ordinals are rejected evidence for this mapping.
- Crash around B1 suspension → required revision of the existing projection
  fixture to execute crash-before-intent, intent-before-call, and lost-response
  cuts through the executor boundary.

After focused verification, re-review #264, #265, and #266 in dependency order
and close #265 and #266 only when their scenario mappings are direct and green.

### 4. Implement #267 and #269 independently

Both are blocked by #266 and may be developed in separate worktrees against
the same pinned master commit. Integrate them only after both focused reviews
are clean.

For #267, keep synchronization inside the maintained cassette. Map the
scenario to tests proving reverse-arriving same-shape reads correlate by exact
operation, duplicate/crossed/foreign relationships fail closed, unchanged
executing observations do not advance the cassette, and only B's exact Safe or
Terminal report releases B.

For #269, represent read-only recovered obligations separately from held and
retained task-work priority. Map the scenario to tests proving reattachment
does not consume capacity or block independent D, retained B resumes before
unstarted work after Continue, and same-task replacement work cannot pass B's
existing attempt.

Trade-off: separate worktrees add one integration step, but prevent cassette
causality and admission-priority changes from becoming one unreviewable diff.

### 5. Implement #268 as the capstone only

Do not add new runtime scheduling, read authority, executor lifecycle, or
capacity policy in #268. If the thirteen-beat story exposes a missing behavior,
return it to #265, #266, #267, or #269.

Scenario-to-test mapping:

- DS-01 through DS-13 → one table-driven maintained-cassette test containing
  exact Run, attempt, Base SHA, claim, worktree, capacity, held, retained,
  fingerprint, and report identities.
- Alice edits B → notification/timer → ordinary graph/focused reads → Suspend
  → Safe → release → one named vertical test with zero repeated Begin/Resume.
- Lost notification and duplicate hints → one bounded-timer/coalescing test.
- Unchanged A/C observation → one test asserting no report ordinal, executor
  command, or report-triggered graph read.
- Restart → one test asserting passive reattachment for A/C/D and no restored
  hint, timer cursor, or derived refresh requirement.
- Continue B → one exact Resume after capacity becomes available, ahead of
  unstarted work.
- Active-work refresh versus final stabilization → one test proving the two
  graph reads have distinct causes and ordering.

### 6. Compose with #270 and verify the combined stack

After #264–#269 are complete, inspect and compose
`origin/integrate/live-mvp-270-sync@82c922c7f` against a pinned master commit.
Resolve only demonstrated semantic conflicts. Run focused combined tests,
`pnpm check:all`, the required three review passes, and one final
`pnpm check:quint` if any governed model or adapter changed. Do not dispatch
#271 until this combined stack is green.

## Delivery discipline

- Keep one behavior ticket per reviewable commit. Separate mechanical
  vocabulary/model migrations from behavioral changes when practical.
- Work from pinned commits. Do not silently absorb advancing `master` into an
  in-progress acceptance proof.
- Follow the operational scenario gate before every behavior change and report
  handoff results scenario by scenario rather than only as aggregate totals.
- Preserve ordinary authority ownership: the tracker supplies task facts, Git
  supplies lineage/worktree facts, the executor supplies attempt lifecycle,
  and the Journal records workflow history. Do not persist derived active sets,
  hint queues, timer state, frontier state, or a second read history.
- Use focused tests during development. Run `pnpm check:all` before each
  implementation handoff and `pnpm check:quint` once after final relevant
  model changes.
- Re-run domain/spec, architecture/connascence, and strict code-review passes
  after significant changes. Record a concrete reason for every rejected
  finding.

## Explicit trade-offs

- Fixing #266's read protocol before #267/#268 delays the capstone, but avoids
  making every downstream cassette and CLI consumer depend on two freshness
  histories.
- Keeping #264 closed at its accepted boundary leaves later observation
  scheduling temporarily absent until #265, but preserves ticket ownership and
  keeps #265 independently testable.
- Reusing ordinary reads may remove active-refresh-specific failure labels from
  the Journal. The triggering opportunity remains process-local context; the
  durable record should describe the actual tracker or Git read and its typed
  result, not manufacture a second authority history.
- Independent #267/#269 work increases merge coordination, but substantially
  reduces review coupling between cassette-only causality and production
  admission priority.
- Deferring #270 composition postpones discovering cross-stack conflicts, but
  keeps the #265/#266 authority repair measurable before adding another
  candidate stack.
