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
  prerequisite, issue #309. The previously accepted nine-node #309 causal
  group and its direct evidence are committed and pushed at exact commit
  `e6d98926f`. The additional authority-lane behavior needed by #268 is a new
  proposal, not part of that earlier acceptance. Its proposed #309 scenario is
  committed and pushed at exact commit
  `0253bda6924d3bd9ead68fc2fba69fab332a2e36` on
  `work/issue-309-concurrent-interaction-group`; the proposed downstream #268
  boundary scenario is committed and pushed at exact commit
  `4b59855efb538e79637ce976763a70fbe7569636` on
  `work/issue-268-delivery-capstone`. Both proposals have clean independent
  Standards and Spec reviews, but neither review is owner acceptance. Explicit
  repository-owner acceptance of both proposed texts is the current gate for
  behavior-changing implementation.
- The 2026-09-02 #268 convergence milestone now proves the accepted restart
  return, exact hint-delivery handoff, queued G1 A/C/D authority group, and G2
  read result through authored story position 70. The filtered capstone remains
  red at the default 10-second bound before the post-G2 A/D group at position
  71, so #268 is not complete. No diagnostic or widened timeout remains. The
  next semantic work requires a separate audit of that post-G2 boundary rather
  than another unreviewed interpreter expansion.
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

### 5. Obtain owner acceptance for the proposed #309 and #268 scenarios, then implement #309 before #268

The maintainer is trying to run the accepted DS01–DS13 source story through one
controlled cassette without turning incidental fiber order into authored
behavior. The earlier nine-node, four-edge #309 prerequisite is already
accepted, implemented, pushed at exact commit `e6d98926f`, and clean under its
concluding Standards and Spec implementation reviews. Its 49/49 focused tests,
22,680-order exhaustive proof, 1/1 cursor-owner coverage check, typecheck,
Effect diagnostics, scoped lint, and diff check remain historical evidence.
The completed-group publication stays inside the existing uninterruptible
cursor transition permit; this delays a pending interruption through the local
callback and forbids consuming callback re-entry, but prevents a strict
activation return from overtaking or losing the one group occurrence.

That earlier work started from integration code fixed point
`a1b81c4fbcd189d62b480d6e637c62278ca7b829` and proposed the causal scenario at
`4cf7b7708280ed9e17176ac014589e2449e297aa`. Its review loop also established
canonical claim-fingerprint uniqueness, exact controlled `X_A`, `X_B`, and
`X_C` outputs, and presentation that distinguishes direct authored edges from
possible transitive order. Commit `e6d98926f` remains on the #309 issue branch;
this plan update does not claim that it is composed on the integration branch
or in #268.

The next behavior is not covered by that earlier acceptance. Exact proposed
scenario commits are:

- #309 authority-lane amendment:
  `0253bda6924d3bd9ead68fc2fba69fab332a2e36` on
  `work/issue-309-concurrent-interaction-group`.
- #268 capstone boundary refinement:
  `4b59855efb538e79637ce976763a70fbe7569636` on
  `work/issue-268-delivery-capstone`.

Both proposed texts have completed independent Standards and Spec reviews with
no remaining finding. Those reviews establish internal consistency only. They
do not establish repository-owner acceptance, implementation completion, or
integration. Explicit repository-owner acceptance of both exact proposed
commits is the current operational-scenario gate. No behavior-changing #309 or
#268 implementation may begin or resume before that acceptance is recorded.

The two scenario amendments are not accepted, and no reviewed implementation
of either amendment exists. At the #268 worktree whose HEAD is the scenario
documentation commit, five dirty behavior-changing files preserve a candidate
that predates the proposed scenario text and therefore predates any future
owner acceptance of it. This candidate is frozen unauthorized WIP and
recoverable evidence only. It receives no further implementation, commit, or
composition before owner acceptance, cannot satisfy a scenario-to-test row,
and cannot count as implementation evidence. Its current dirty inventory is:

- modified `packages/dalph/src/cassettes/authored-runner.ts`;
- modified `packages/dalph/src/cassettes/catalog.ts`;
- modified `packages/dalph/src/cassettes/delivery-story-capstone.ts`;
- untracked `packages/dalph/src/cassettes/authored-reactivation-return.ts`; and
- untracked
  `packages/dalph/test/cassettes/authored-reactivation-return.test.ts`.

Before composing #309 into that worktree, inventory these exact paths again,
record their content hashes, preserve every version, and reconcile each
intentional change against the accepted #309 diff. Do not overwrite or infer
ownership from path overlap. Stash object
`83a272e839ef32622b0684fb823d9ef4e1545d05` was verified present as
`stash@{1}` while this plan was updated. If it remains present, protect it from
drop, clear, destructive apply, or rewrite until the candidate is fully
reconciled and independently reviewed. If it is absent later, stop composition
and locate equivalent preserved evidence before changing the candidate.

The corrected chronology has three distinct shapes:

At an active-refresh cut, the concrete boundary sequence for one healthy task
is: Dalph selects the task's tracker specification read; the tracker returns
that exact task's specification; Dalph selects the task's current-claim read;
the tracker returns that exact task's current claim; Dalph performs the Git
planned-worktree read for the exact attempt; and Dalph performs the Git
target-lineage read for that exact attempt. Only after that concrete sequence
is established does this plan use `S → T → Q → R → W → L` as its
shorthand.

At executing restart, the executor returns the current unchanged
`ExecutorWorkExecuting` projection for exact attempt `attempt:A:0`, then exact
attempt `attempt:C:2`, then exact attempt `attempt:D:3`. Only after naming those
executor boundaries does this plan use `P_A`, `P_C`, and `P_D` as shorthand.

1. After the first active graph result, A and C each perform an independent
   six-node specification-to-lineage chain
   `S → T → Q → R → W → L`; B performs only its independent
   two-node specification lane `S_B → T_B`. The bounded group therefore has
   fourteen nodes, eleven direct edges, and exactly
   `14! / (6! * 2! * 6!) = 84,084` legal schedules. It publishes once after all
   fourteen roles. Only then is strict B1 Suspend available. There is no
   cross-task edge.
2. Executing restart is strict, not a concurrent authority group:
   `startup graph → P_A → P_C → P_D →
   CoordinatorActivationReturned(RunMustRemainActive(RunnableTransition))`.
   It performs three unchanged Executing projections and zero specification,
   claim, worktree, lineage, Begin, Resume, or Suspend calls. The return settles
   before TrackerNotification or Timer hints become available. One queued-
   refresh hint burst then admits G1. Exact executing A, C, and D each perform
   an independent six-node `S → T → Q → R → W → L` chain. This
   existing group shape has eighteen nodes, fifteen same-lane direct edges, and
   no cross-task edge. After all three chains settle, the same activation
   performs its post-quiescence G2 read. The capstone
   checks exact members, edges, exclusions, and cross-lane incomparability; it
   does not enumerate all 17,153,136 schedules already governed by the generic
   matcher laws.
3. After that post-quiescence G2 result, A and D each perform an
   independent six-node `S → T → Q → R → W → L` chain. This
   bounded group has twelve nodes, ten direct edges, and exactly
   `12! / (6! * 6!) = 924` legal schedules. It publishes once after all twelve
   roles. Only then is strict C2 Suspend available. There is no A-before-D or
   D-before-A edge.

Three committed production probes establish the premises without accepting
the proposed cassette behavior:

- `c305b3543f94014967831562abd8e429d053515e` proves an active-refresh
  authority lane can reach its claim read while an independent specification
  read remains in flight. It supports the later A/D group only.
- `bb40c4c8c` proves the exact executing-restart graph/projection/graph order
  and its zero authority lanes.
- `5578b8daa8778e98a14f9a61e93dd2cf393d69ce` proves the role-generic rule that
  a constrained task's one Suspend remains unavailable until all healthy
  subjects' authority tails settle.

The proposed #268 scenario adds three real production-result settlement
boundaries. The cursor reserves the exact authored item without advancing,
runs the owning production Effect interruptibly, and, only after an exact
validated success, settles and publishes under one short uninterruptible
cursor handoff. It performs no automatic retry.

- Capacity revision two and capacity two must be durably applied and the exact
  public result settled before `CoordinatorProcessDies` is exposed. A
  committed-but-unacknowledged append exposes no death in that run; a fresh run
  must reconcile through the ordinary reduced-capacity read and must not apply
  the change twice.
- Exact C2 `ExecutorWorkSafelySuspended` at report ordinal two must be accepted
  into the ordinary report protocol and published before
  `OperatorContinuesAttempt(B1)` is exposed. A provider return, early
  interruption, or ambiguous committed result is not enough; reconciliation
  must not issue another Suspend or create ordinal three.
- The reconstructed ordinary activation result
  `RunMustRemainActive(RunnableTransition)` must settle exactly once after the
  strict restart prefix and before queued-refresh hints are exposed. That
  queued refresh must complete its exact A/C/D authority group before the
  post-quiescence G2 read. After the later A/D authority group and exact C2 Safe
  result, its separate `RunMustRemainActive(UnsettledResponsibility)` return
  settles before Continue B. A wrong, failed, interrupted, or duplicate return
  cannot fabricate either settlement.

Two baseline focused-suite defects reproduced identically at exact pre-#309
base `4cf7b7708280ed9e17176ac014589e2449e297aa` and the current #309 tip:

- The historical `changedAttemptChoiceRace` defect is
  `packages/dalph/test/cassettes/authored-coverage.test.ts` — `runs the authored
  candidate and promotion outcomes through their production adapters`. It
  fails at story position 25: expected `ExpectedBehavior`, received
  `ReadTrackerGraph`.
- `packages/dalph/test/cassettes/cassette-residuals.test.ts` — `round-trips
  restart, release, worktree, Git, and lost-response histories` fails at story
  position 39: expected `TrackerGraphReadReturned`, received
  `ExpectedBehavior`.

The first name and the position-25 aggregate failure describe the same defect,
not a third red. Both defects are baseline failures, not regressions introduced
by either documentation proposal. They were excluded from the earlier 49/49
result and are neither hidden nor repaired here.

After the repository owner accepts both exact proposals, use this conditional
TDD and delegation order:

The orchestrator classifies complexity before every dispatch. Sol agents own
semantic TDD, interruption and failure behavior, ambiguity, merge conflicts,
architectural decisions, and Standards or Spec review. Luna max agents may own
only pinned commands, formatting, evidence collection, compiler-guided exact
API migrations, literal fixture transcription, and conflict-free composition
of an exact reviewed ref. A Luna max agent must stop and escalate any semantic
ambiguity, unexpected diff, failing assumption, or merge conflict to a Sol
agent; it must not choose a behavior or conflict resolution.

1. Record the accepting owner, date, and reference in both scenario files.
   Dispatch one Sol implementation agent in the #309 worktree to make the
   proposed direct tests fail for the intended reason and then implement the
   narrow closed four-case member union, exact result/projection correlation,
   three bounded groups, and strict restart support.
2. Dispatch independent Sol Standards and Spec review agents against the exact
   #309 diff. Return every reasonable finding to the implementation agent and
   repeat the implementation/review loop until both reviews are clean. Run the
   focused tests and required repository gates before committing and pushing
   one reviewable #309 commit.
3. Compose that exact #309 commit into the #268 worktree. Only then dispatch a
   Sol implementation agent for #268 to drive the capacity/death,
   Safe/Continue, activation-return, and full DS01–DS13 proofs red then green
   through the real production seams.
4. Dispatch independent Sol Standards and Spec review agents against the exact
   #268 diff. Repeat the same finding/repair/re-review loop, then run focused
   tests, `pnpm check:all`, and the final applicable `pnpm check:quint` gate.
5. Compose only reviewed exact commits through the integration worktree. Sync
   the integration worktree with `master` at a deliberate boundary, preserve
   unrelated changes, rerun the combined scenario mappings and repository
   gates, and do not claim shipment merely because integration is green.

Do not add new runtime scheduling, tracker or Git authority, executor
lifecycle, capacity policy, retry authority, timeout, queue, or persisted
cursor/frontier state. If the thirteen-beat story exposes a missing production
behavior, return it to its owning issue instead of absorbing it into cassette
matching.

Scenario-to-test mapping after acceptance:

- Initial fourteen-node A/B/C cut → #309
  `partitions all 84084 active-refresh orders by three canonical lane
  positions` and `consumes every active-refresh specification-to-lineage order
  before B Suspend`, backed by probe `5578b8daa8778e98a14f9a61e93dd2cf393d69ce`.
- Strict restart graph/projection/RunnableTransition cut with zero authority
  lanes, followed by queued hints/G1, the exact eighteen-member A/C/D group,
  then the post-quiescence G2 read → probe `bb40c4c8c`,
  `completes the startup graph read then serially reattaches A C and D before
  the next graph read`, plus #268 `returns RunnableTransition after strict
  restart projections before the queued G1 refresh` and `represents queued G1
  as three independent A C D authority lanes before G2`.
- Later twelve-node A/D cut → #309 `partitions and consumes all 924 post-hint
  A D authority orders before C Suspend`, backed by probe
  `c305b3543f94014967831562abd8e429d053515e`.
- Capacity before death → #268 `keeps authored process death unavailable
  before the production capacity result`, `settles one production capacity
  revision before delayed interruption and process death`, and `distinguishes
  pre-commit interruption from a committed lost capacity response using only
  the reduced policy`.
- C2 Safe before Continue B → #268 `keeps Continue B unavailable before the
  production C2 Safe publication`, `settles exact C2 Safe once before delayed
  interruption and Continue B`, and `preserves named C2 Safe failure families
  and reconciles a committed lost response without retry`.
- Restart return before its hints and active-refresh return after C2 Safe → #268
  `keeps restart hints unavailable before the production finality result`,
  `settles the reconstructed restart return once before delayed interruption
  and later hints`, `returns RunnableTransition after strict restart projections
  before the queued G1 refresh`, and `represents queued G1 as three independent
  A C D authority lanes before G2`.
- DS-01 through DS-13 → #268 `emits the exact DS01 through DS13 delivery
  checkpoint table`, retaining exact Run, attempt, Base SHA, claim, worktree,
  capacity, held, retained, fingerprint, and accepted-outcome identities.

Trade-offs: the three exact group shapes cost more fixture and assertion work
than a flat batch, but preserve the production-proved independent lanes without
creating another workflow DAG. Existing exhaustive 84,084- and 924-schedule
proofs remain; the eighteen-member A/C/D fixture uses exact structural and
representative incomparability checks rather than enumerating 17,153,136
schedules because the generic matcher laws already own that mechanism. The
short uninterruptible settlement handoff can delay interruption, but avoids a
durable success with no matching occurrence; production I/O remains
interruptible. Waiting for explicit owner acceptance keeps reviewed proposals
unaccepted and leaves no reviewed implementation of their amendments. It also
freezes the older five-file #268 WIP as recoverable evidence instead of
authorizing it. This preserves the fail-closed operational-scenario gate and
prevents review or historical-WIP evidence from being reported as an accepted
behavior decision.

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
