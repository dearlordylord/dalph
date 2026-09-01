# Issues 264–270 execution plan

Status: active follow-on plan, recorded 2026-08-30 and updated 2026-09-01.

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
- Issue #265 is complete, integrated on `integrate/issues-264-268` through
  commit `acdf5a715`, and closed. It attaches one process-local passive
  lifecycle owner, publishes
  a later Safe or Terminal change through the ordinary serialized report
  protocol, reconstructs the owner from durable history after same-host
  restart, and fails closed on unresolved non-exact evidence. Independent
  standards, specification, and Codex hint/census reviews are clean.
- The integrated #265 stack passed `pnpm check:all` with 2,718 tests passed,
  39 skipped, 35 MBT tests passed, and 100% changed production and maintained-
  evaluation coverage. The final `pnpm check:quint` gate also passed, including
  deterministic, sampled, exhaustive, temporal, and negative-control checks.
- The #266 candidate code and acceptance evidence are integrated on
  `integrate/issues-264-268` through exact commit
  `437238a8784f88da9f8daf3bb1e81d5aa348d50c`. It includes the ordinary-read
  implementation and its subsequent causality, recovery, lifecycle,
  runtime-coalescing, conformance-gate, and acceptance repairs. Independent
  standards and specification reviews found no remaining findings.
- `pnpm check:all` passed on exact commit
  `437238a8784f88da9f8daf3bb1e81d5aa348d50c`. The governed Quint model and its
  executable conformance adapter were unchanged; the final
  `pnpm check:quint` run passed in 332.27 seconds within its 360-second budget.
  #266 has completed its planned code, evidence, review, and verification
  closure gates. `gh issue close 266` succeeded, and issue #266 is closed.
  This status does not claim that the candidate is on `master` or shipped.
- The separate `pnpm check:lab:browser` Playwright check remains blocked in
  this container because `libatk-1.0.so.0` is absent. The documented
  `pnpm --dir prototypes/reducer-lab browser:install` command needs root or
  passwordless sudo, but this environment requires a sudo password. This does
  not qualify the green `pnpm check:all` result because that bounded gate
  intentionally excludes the browser smoke.
- The candidate removes the private active-refresh Git-read history and routes
  graph, focused tracker, worktree, and lineage reads through the ordinary
  journal-first owners. Production matrices now cover sources, coalescing,
  complete constraints, uncertainty, later edits, and suspension crash cuts.
- The #266 scenario is
  `docs/scenarios/issue-266-active-work-authority-refresh.md`; it attributes the
  behavior to #266 and uses the accepted executor lifecycle vocabulary.
- A direct rejected-handoff acceptance test already exists:
  `retains one trailing ordinary activation when the active handoff rejects`.
  Do not add a test-only production seam or duplicate this test.
- Issues #267 and #269 were implemented independently from exact #266 fixed
  point `437238a8784f88da9f8daf3bb1e81d5aa348d50c`, reviewed, composed on
  `integrate/issues-264-268` through exact tip
  `a1b81c4fbcd189d62b480d6e637c62278ca7b829`, pushed, and closed. #267 also
  owns the composed repair that keeps the exact passive observer attached when
  Suspend returns `ExecutorWorkExecuting`.
- The combined #267/#269 focused suites passed 194/194 tests. #267's final
  repository gate passed 2,726 tests, 35 model-based tests, all 92 maintained
  cassettes, 100% changed executable coverage, and gitleaks. #269's full
  repository gate passed before composition. Independent combined review found
  no remaining runtime or architecture finding.
- With #264–#267 and #269 complete, #268 has reached its cassette-composition
  prerequisite, issue #309. The #309 scenario commit
  `4cf7b7708280ed9e17176ac014589e2449e297aa` is pushed on
  `work/issue-309-concurrent-interaction-group`. A later eight-file causal
  implementation candidate is preserved uncommitted and unpushed in its
  worktree. Its refined nine-node, four-edge scenario is proposed and remains
  pending explicit repository-owner acceptance. Under the operational-scenario
  gate, neither #309 nor downstream #268 implementation may be committed until
  that acceptance is recorded.
- The separate [determinism discussion handoff](DETERMINISM-DISCUSSION-HANDOFF.md)
  records the #268 cassette-order evidence and open Effect/Journal questions.
  It is not an accepted decision or a #268 blocking edge; this lane continues
  preserving the bounded #309 candidate while that investigation proceeds
  separately.
- Preserve the separate #270 candidate at
  `origin/integrate/live-mvp-270-sync@82c922c7f`. A separate lane owns #270
  implementation, integration, and verification. This lane must not compose or
  merge that candidate. After this lane completes #264–#269 and establishes
  #268 readiness, remind the user to resume the separate #270 lane at that
  exact preserved ref.

The primary worktree also contained unrelated staged tooling edits when this
plan was recorded: `package.json` and `scripts/run-typecheck.mjs`. A later
session must inspect and preserve them rather than assuming they belong to one
of these tickets.

## Accepted review findings

### Resolved in the current #266 candidate

1. #265 was integrated before the #266 correction candidate.
2. #266's work-in-progress private Git-read operation, intent, ordinal,
   failure, record-key, replay runner, and interpreter routing were removed.
3. Active-work graph, focused tracker, worktree, and target-lineage reads now
   use the existing ordinary journal-first protocols owned by #190/#53/#164.
4. The active-work refresh scenario remains linked to #266 and uses the
   accepted executor lifecycle vocabulary.
5. The rejected-handoff mapping names its existing direct acceptance test.

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

Status: completed on `integrate/issues-264-268` at `acdf5a715`; issue closed
after clean independent review, recorded closure evidence, and full
verification.

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

### 3. Complete closure of the integrated #266 candidate

The scenario is
`docs/scenarios/issue-266-active-work-authority-refresh.md`; keep the scenario
catalog and #266 link current, and use `ExecutorWorkExecuting`,
`ExecutorWorkSafelySuspended`, and `ExecutorWorkTerminal` consistently.

The completed final review confirmed that the candidate preserves:

- #218's one serialized notification/timer opportunity owner;
- coalescing and at most one trailing ordinary activation;
- enumeration of every exact executing attempt;
- task-local changed-instruction, claim, worktree, and lineage consequences;
- no continuation command after healthy reads;
- unreadable evidence authorizes neither continuation nor suspension; and
- exact `ExecutorWorkSafelySuspended` or `ExecutorWorkTerminal` evidence is
  required before releasing a position.

The completed final review confirmed that the candidate removed:

- the active-refresh-specific Git operation wrapper;
- its authority and ordinal history;
- its separate intent and failure events and record keys;
- its replay implementation; and
- the interpreter branch selecting it instead of ordinary Git reads.

The active-work opportunity may select which ordinary reads are needed, but it
must not own a second read protocol or cache.

Scenario-to-test mapping (the scenario document records the complete ownership
and supporting-test qualifications):

- Fresh B/C admission read whose causal predecessor changes while C's tracker
  call is live → `does not repeat task C's current-graph read when task B's
  accepted read changes its predecessor` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`,
  with exact maintained-cassette chronology in `runs the five-task
  controlled-provider diamond through exact accepted-result finality` and
  `consumes a staggered graph while restart-added X waits for recovered
  capacity`.
- Healthy/equal notification and ordinary provider calls → `unchanged
  active-work refresh calls each ordinary provider once records reconfirmation
  and does not loop` in
  `packages/dalph/src/application/production-reactivation.test.ts`.
- Accepted B/F2 with A1/B1/C1 executing → `accepted B F2 refresh suspends only
  B1 while A1 and C1 continue executing` in the same file, plus the generic
  exact Safe/Terminal position tests in
  `packages/orchestrator/src/control/task-work-capacity.test.ts`.
- Lost/pre-subscription notification, later edit, and notification/timer/
  accepted-publication coalescing → `lost or pre-subscription tracker
  notification is recovered by the ordinary timer and executes an active
  authority read`, `a later tracker edit waits for the next independent
  notification or timer`, and `accepted publication notification and timer
  coalesce behind one active refresh and one trailing ordinary activation` in
  `packages/dalph/src/application/production-reactivation.test.ts`.
- Complete task-local constraints and normalized uncertain boundary outcomes →
  the parameterized `complete authoritative constraints including a missing or
  foreign exact claim suspend only their affected attempt: $name` and
  `incomplete unavailable unreadable malformed or identity-contradictory
  active-work reads authorize no executor action` production matrices in that
  file. The latter asserts only the typed distinctions preserved by production
  normalization; #266 requires no Quint change.
- Ordinary read crash recovery → `active-work refresh recovers ordinary
  authority reads without a private refresh protocol` in
  `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`.
- Suspension crash cuts → `production refresh recovers a constraint observed
  before a crashed suspension intent`, `production refresh reuses a persisted
  suspension intent after a provider-entry crash`, and `production refresh
  reconciles an accepted suspension when its response append is lost` in
  `packages/dalph/src/application/production-reactivation.test.ts`.
- Pause, restart-state reset, and Exit → `accepted Pause suppresses active
  refresh until Unpause completes its ordinary current read`, `starts each
  restarted owner with fresh timer, hint, and coalescing state` in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`,
  and `lets an admitted active refresh record its read outcome before Exit
  rejects a later refresh` in
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts`.
- #194 finality separation → `active-work refresh and post-quiescence finality
  perform cause-ordered separate complete graph reads` in
  `packages/orchestrator/src/coordination/run/run-stabilization.test.ts`.
- Rejected active handoff → `retains one trailing ordinary activation when the
  active handoff rejects` in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`.

Status: the direct scenario mappings, independent reviews, `pnpm check:all`,
and the unchanged-model `pnpm check:quint` gate are green through exact commit
`437238a8784f88da9f8daf3bb1e81d5aa348d50c`. #266 has completed the planned
repository closure proof, and its tracker issue is closed. The candidate
remains on `integrate/issues-264-268`; this status does not claim a merge to
`master` or shipment.

### 4. Completed #267 and #269 independently, then composed them

#267 and #269 were developed in separate worktrees from the same exact #266
fixed point `437238a8784f88da9f8daf3bb1e81d5aa348d50c`. Both focused reviews were
clean before their commits were composed through exact integration tip
`a1b81c4fbcd189d62b480d6e637c62278ca7b829`; both tracker issues are closed.

The completed #267 work kept synchronization inside the maintained cassette.
Its mapped tests prove reverse-arriving same-shape reads correlate by exact
operation, duplicate/crossed/foreign relationships fail closed, unchanged
executing observations do not advance the cassette, and only B's exact Safe or
Terminal report releases B.

The completed #269 work represents read-only recovered obligations separately
from held and retained task-work priority. Its mapped tests prove reattachment
does not consume capacity or block independent D, retained B resumes before
unstarted work after Continue, and same-task replacement work cannot pass B's
existing attempt.

The scenario-to-test closure is recorded in
`docs/scenarios/issue-267-exact-causal-active-work-cassette.md` and
`docs/scenarios/issue-269-independent-work-retained-priority.md`. The combined
focused suites passed 194/194 tests; #267's final full gate and #269's earlier
full gate are green.

Trade-off: separate worktrees added one integration step, but kept cassette
causality and admission-priority changes independently reviewable before the
combined interaction review.

### 5. Obtain owner acceptance for #309, then compose #268

The maintainer is trying to run the accepted #268 DS01–DS13 production story
through one controlled cassette. The original group treated five interactions
as roots and left four causal successors strict, which erased the actual
plan-before-worktree and worktree-before-Begin relationships. The proposed
#309 scenario instead places the exact nine interactions in one bounded graph
with four edges: `P_D → W_D`, `P_E → W_E`, `W_B → X_B`, and `W_C → X_C`.
The following activation return remains a strict join after the group.

Status: pending explicit repository-owner acceptance. The scenario commit
`4cf7b7708280ed9e17176ac014589e2449e297aa` is pushed on
`work/issue-309-concurrent-interaction-group`. The later refined scenario and
causal implementation candidate modify eight files and are preserved
uncommitted and unpushed in
`/workspace/typescript/dalph-worktrees/issue-309-concurrent-interaction-group`.
The integration fixed point remains
`a1b81c4fbcd189d62b480d6e637c62278ca7b829`; this records neither scenario
acceptance nor implementation completion.

The focused five-file command passed 49/49 tests across
`packages/dalph/test/cassettes/authored-domain.test.ts`,
`packages/dalph/test/cassettes/authored-concurrent-interaction-group.test.ts`,
`packages/dalph/test/cassettes/authored-domain.property.test.ts`,
`packages/dalph/test/cassettes/authored-presentation.test.ts`, and
`packages/dalph/test/cassettes/authored-active-work-causal-sync.test.ts`. All
22,680 legal schedules ran in five deterministic first-root shards under the
ordinary 10-second per-test bound. The separate cursor-owner coverage check
passed 1/1. Typecheck, Effect diagnostics, scoped lint, and the candidate diff
check also passed. The unchanged `authored-coverage.test.ts` case
`changedAttemptChoiceRace` remains baseline red and reproduced identically at
exact base `4cf7b7708`; it is not included in the 49/49 result and is neither
hidden nor repaired in #309. These results qualify the candidate but cannot
substitute for the repository owner's scenario acceptance.

Independent review found that a strict activation-return claim could overtake
completed-group occurrence publication. The candidate now uses the existing
cursor transition permit for completion, keeps group occurrence publication
uninterruptible within that transition, and makes activation return join the
publication. This prevents an advanced group from losing or reordering its
occurrence. It deliberately delays interruption until the local observation
callback returns, and a consuming `onOccurrence` callback must not re-enter
the same cursor permit. That non-reentrant callback contract is narrower than
adding another queue or scheduler, but it must remain explicit.

Other review repairs enforce canonical claim-fingerprint uniqueness across the
closed member union, return the exact controlled `X_A`, `X_B`, and `X_C`
outputs, and distinguish direct authored edges from merely possible transitive
presentation order. Both Standards and Spec re-reviews report their code and
spec findings resolved. They do not establish overall acceptance: explicit
repository-owner acceptance and the factual scenario-status update remain
open.

After the repository owner accepts the refined scenario:

1. Update its factual status with the accepting owner, date, and reference.
2. Run one read-only Standards and Spec re-review against that accepted text.
3. Commit and push #309, then compose the exact commit into #268.
4. In the maintained capstone, replace the five roots and four strict
   successors with the exact nine-node, four-edge DAG while keeping the
   activation return strict.
5. Remove the temporary diagnostic instrumentation and progress watchdog, and
   remove the stale task-id corruption. Retain the reactivation-return
   lifecycle files because they express required production chronology rather
   than diagnostics.
6. Complete the seven DS01–DS13 scenario proofs below, update the manifest and
   documentation, run the applicable repository gates, and repeat the required
   reviews until no reasonable finding remains.

Do not add new runtime scheduling, read authority, executor lifecycle, or
capacity policy in #268. If the thirteen-beat story exposes a missing behavior,
return it to #265, #266, #267, or #269.

Scenario-to-test mapping after #309 acceptance and composition:

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

Trade-offs: exhaustive enumeration costs more than the superseded 120-order
proof, but checks the complete finite partial order instead of sampling it.
Holding the existing transition permit through occurrence publication delays
interruption and forbids consuming-callback re-entry, but closes the observed
publication/activation race without inventing another concurrency authority.
Waiting for explicit owner acceptance leaves a verified candidate uncommitted,
but preserves the fail-closed scenario gate and prevents review evidence from
being misreported as an accepted behavior decision.

### 6. Remind the separately owned #270 lane

This entry is reminder-only. After #264–#269 are complete and #268 is ready,
remind the user to resume the separate #270 implementation and integration
lane from `origin/integrate/live-mvp-270-sync@82c922c7f`. That lane retains
ownership of its pinned integration base, semantic-conflict resolution,
focused combined tests, repository gates, reviews, and any required final
model check. This lane does not inspect, compose, merge, or verify #270.

The separate stale-promotion lane also owns any #271 dispatch or merge
decision. Recording #270 here does not authorize this lane to dispatch #271 or
create a new dependency between #271 and the executor stack; the #270/#271 lane
must continue to follow its accepted issue dependencies and preserve #272 as
the independently owned convergence point with #268.

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
- Keeping #264 closed at its accepted boundary left later observation
  scheduling to #265 instead of expanding #264. #265 is now complete; the
  separate ownership kept its verification measurable.
- Reusing ordinary reads may remove active-refresh-specific failure labels from
  the Journal. The triggering opportunity remains process-local context; the
  durable record should describe the actual tracker or Git read and its typed
  result, not manufacture a second authority history.
- Independent #267/#269 work increases merge coordination, but substantially
  reduces review coupling between cassette-only causality and production
  admission priority.
- Keeping #270 in its separate lane requires an explicit user reminder and
  defers cross-stack conflict discovery to that lane, but preserves clear
  implementation and integration ownership instead of silently absorbing
  #270 or #271 into this executor-work lane.
