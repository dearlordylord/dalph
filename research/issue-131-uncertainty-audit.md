# Issue 131 uncertainty audit

Status: pre-follow-up-implementation research for
[Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131).
This ledger changes no production code. It keeps every user annotation and
every uncertainty from the previous choices audit visible until evidence
resolves it.

Audited source: `master` at `84b2c9768`, including the five issue
131 commits. GitHub still reports issue 131 as open, `ready-for-agent`, with
every acceptance and review checkbox unchecked. A green local gate therefore
does not prove that the issue has been accepted.

Live issue evidence used in this audit:
[Wayfinder ticket graph #126](https://github.com/dearlordylord/dalph/issues/126),
[frontier/admission #131](https://github.com/dearlordylord/dalph/issues/131),
[shared activation #132](https://github.com/dearlordylord/dalph/issues/132),
[executor boundary #133](https://github.com/dearlordylord/dalph/issues/133),
[whole-run pause #134](https://github.com/dearlordylord/dalph/issues/134),
[task/group pause #135](https://github.com/dearlordylord/dalph/issues/135),
[final contraction #143](https://github.com/dearlordylord/dalph/issues/143),
and
[M2 reconstruction adapter #144](https://github.com/dearlordylord/dalph/issues/144).
Issue [54](https://github.com/dearlordylord/dalph/issues/54) separately owns
non-preemptive live capacity changes after issue 131 establishes the controller.

## Workspace placement

The active issue-131 review worktree is `/workspace/typescript/dalph` on branch
`master`. The reviewed substantive bundle was committed and pushed as
`f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`; the publication proof below names
the final checkpoint verification. The former
`/workspace/typescript/dalph-master-complexity` worktree is detached at the
starting commit and contains no local changes.

Uncommitted issue-120 research is deliberately separate:

- branch: `prototype/frontier-recovery-model-122`;
- worktree:
  `/workspace/typescript/dalph-prototype-frontier-recovery-model-122`; and
- file: `research/reconciliation-external-boundary-capabilities.md`.

The live [issue #120](https://github.com/dearlordylord/dalph/issues/120) body
was updated and reread on 2026-07-26 with that exact continuation location and
the warning that it is capability research, not accepted disposition policy.
Recoverable stash snapshots from the worktree relocation remain at object
`0ca604a220bdfe4837bfd3fc167cfd36077276c6` for issue #120 research and
`38ac1b1c5168c1f4d557f1053ed69cb01042641b` for this issue #131 review bundle.

## Current control protocol

This is the main work document for the review. This section and the
second-feedback ledger below supersede older status labels where they disagree.
Earlier ledgers remain as provenance and must not be deleted.

An item may use only these statuses:

| Status | Meaning and closure proof |
| --- | --- |
| **Resolved — externally proven** | The requested external change was performed and freshly reread. Record the exact issue/API evidence. |
| **Resolved — repository proven** | The reviewed artifact is committed and pushed. Record its exact commit, review result, applicable gate, and remote reread. |
| **Resolved — no work required** | Existing authoritative text or behavior already settles the question. Cite it and explain why no code, model, issue, or documentation change is needed. |
| **Applied locally — proof pending** | The document/source change exists only in the worktree. It is not resolved until committed, reviewed as applicable, and verified. |
| **Persisted plan — implementation open** | The owning issue/spec now states the obligation, but the behavior is not implemented. Never abbreviate this to “resolved.” |
| **Handoff ready** | A bounded continuation document exists and declares the exact evidence it must return. |
| **Research running** | A sub-agent is collecting evidence. No adoption or implementation decision is implied. |
| **Awaiting owner** | The ledger provides concrete alternatives and needs an explicit user decision. |
| **Open** | Neither evidence nor an adequate plan exists yet. |

For code behavior, closure requires a commit, focused tests, applicable
Quint/model-to-code evidence, the three repository review passes, and
`pnpm check:all`. For canonical semantics, closure requires a committed
canonical-spec paragraph; conversation or this research ledger alone is not
enough. Issue-owner acceptance requires an explicit owner decision; green
checks and unchecked issue boxes are not acceptance.

## Actions completed in this review

| Action | Status | Proof |
| --- | --- | --- |
| Repair native dependency order | **Resolved — externally proven** | GitHub's issue-dependency API was reread on 2026-07-26 and reports [Reconstruct one managed run through distinct reducers](https://github.com/dearlordylord/dalph/issues/130) blocks [Connect reconstructed graph knowledge to the M2 executable adapter](https://github.com/dearlordylord/dalph/issues/144), which blocks [Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131). The incorrect direct #130 → #131 edge was removed. |
| Persist the #131 selector boundary and #132 activation ownership | **Resolved — externally proven** | On 2026-07-26, the live bodies of [#131](https://github.com/dearlordylord/dalph/issues/131) and [#132](https://github.com/dearlordylord/dalph/issues/132) were updated and reread with the headings `Ticket boundary` and `Activation seam inherited from #131`. This resolves the wording action only: #131 now owns shared selection/controller evidence; #132 owns exact-operation activation, changed restart capacity, one chooser, and repeated derivation. #132 implementation remains open. |
| Persist pause evidence ownership | **Resolved — externally proven** | On 2026-07-26, the live bodies of [Pause and resume a whole run](https://github.com/dearlordylord/dalph/issues/134) and [Pause a task and its grouping descendants](https://github.com/dearlordylord/dalph/issues/135) were updated and reread with the heading `Evidence ownership`. This resolves the wording action only. Model, memory, and SQLite implementation evidence remains open. |
| Warn that evidence/review-specific orchestration is transitional | **Persisted plan — implementation open** | On 2026-07-26, [Place evidence and review behind the executor boundary](https://github.com/dearlordylord/dalph/issues/133) was reread with the warning “The current evidence-, review-, and handback-specific orchestration code is transitional migration input” and all six named evidence/review/handback symbols. The matching #132/#133 source comments were reviewed, committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`; the actual boundary migrations remain open. |
| Persist deterministic recomputation semantics | **Resolved — repository proven** | The canonical specification was reviewed in all three passes, committed in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`, pushed to `origin/master`, and remotely reread. It states identical-input determinism, deterministic current-input progress, and the complete Option B controller-snapshot trigger. |
| Add transitional source comments | **Resolved — repository proven** | The #132/#133 comments in `runnable-frontier.ts`, `reconstructed-managed-run-state.ts`, and `task-admission-controller.ts` were reviewed, committed in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`, pushed, and remotely reread. They change no runtime behavior. |
| Validate the complete review bundle | **Resolved — repository proven** | `pnpm check:all` passed on the reviewed substantive state on 2026-07-26: build, package boundary, typecheck, lint/format, circularity, complexity, duplication, both Quint model gates including expected counterexamples, 452 tests in 70 files, coverage thresholds, and secret scanning. All three repeated review passes returned clean; commit `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69` was pushed and matched `origin/master`. |
| Persist the owner's responsibility-order decision | **Resolved — repository proven** | The owner accepted Option B on 2026-07-26. The live [#132](https://github.com/dearlordylord/dalph/issues/132) body was updated and reread: whenever a controller-snapshot change can permit admission—including confirmed provider non-consumption or reservation release/cancellation—the coordinator reads current reconstructed managed-run state plus the snapshot and derives again; no dormant waiter supplies a second order. The canonical specification and ADR 0009 were reviewed, committed in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`, pushed, and remotely reread. Implementation remains open under #132. |
| Preserve the unrelated issue-120 research location | **Resolved — externally proven** | The live [#120](https://github.com/dearlordylord/dalph/issues/120) body was updated and reread on 2026-07-26 with its branch, dedicated worktree, repository-relative path, uncommitted status, and scope warning. No research conclusion was accepted by this bookkeeping action. |

No production behavior was implemented during this review.

## Final review findings and dispositions

The first independent domain/spec, architecture/connascence, and strict
standards/code passes found the issues below. Every correction was applied;
each repeated pass returned clean. The corrections and this disposition record
are **Resolved — repository proven** by pushed commit
`f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`.

| Finding | Disposition |
| --- | --- |
| #133 warnings named review and handback but omitted executor-owned evidence sealing/artifacts. | Accepted. Source comments, H4, and the live #133 amendment now name evidence-, review-, and handback-specific orchestration. |
| “Activation owner reconstructs inputs” hid the actor/boundary and could require full restart reconstruction on every release. | Accepted. Canonical prose now names any controller-snapshot change that can permit admission, including provider non-consumption and reservation release/cancellation; the coordinator then reads current reconstructed managed-run state plus the snapshot, with workflow-selected external rereads only when knowledge is insufficient. |
| Accepted Option B contradicted an unmarked task/operation-sorted dormant waiter queue. | Accepted. A prominent #132 transitional comment now identifies `WaitingAdmission` as superseded implementation. The final wording covers provider non-consumption and reservation release/cancellation. Behavior remains open under #132. |
| ADR 0009 made review/handback look like universal capacity vocabulary. | Accepted. It now scopes those names to the current review-capable executor protocol and states the executor-declared resource-use rule owned by #133. |
| H2 presented candidate handoff phases as accepted observable states. | Accepted. H2 now requires the Wayfinder to validate/rename ephemeral model/controller phases, name their actor/actions and intent relationship, and forbids durable journal/frontier/resource state. |
| H4's “#132 activation result” prerequisite could mean only the H2 design. | Accepted. H4 now requires the accepted #132 implementation and validation result. |
| Newly written examples used “Resolved — no work required.” | Accepted. SF7/SF8/SF9/SF11 were held proof-pending until their reviewed repository commit was pushed; they now cite repository-proven closure. |
| Workspace and publication provenance used stale relative branch language. | Accepted. The ledger records the exact starting SHA and defers final state to the publication proof. |
| Historical F7/F14 and U3 wording contradicted current H2/Option B. | Accepted. Those rows now explicitly point to the current accepted disposition rather than issuing stale instructions. |
| “Pre-implementation” implied #131 had no existing implementation commits. | Accepted. The status now says pre-follow-up-implementation research. |

## Concrete vocabulary examples

### Workflow responsibility

Suppose Dalph recorded the exact intent to create task A's claim and then the
process ended before recording whether the task tracker created it:

```text
journal: claim-A intent exists
tracker: current claim result not yet reread
```

Dalph now has one workflow responsibility: check the task tracker for that
exact owner/token and then acknowledge, retry only if authorized, isolate, or
relinquish that exact obligation. The tracker still owns current claim truth.
The responsibility ends only after Dalph records its allowed disposition.

### Named workflow wait

Suppose task A cannot continue because prerequisite B has not completed:

```text
A next action: none
reason: dependency wait for B
wake evidence: a later task-graph observation about B
```

Dalph does not persist “A is waiting” as another authority fact and does not
poll merely because the frontier is empty. The derived explanation names both
the blocking condition and the observation that can make A selectable.

### How operation A-18 can exist before a delayed A-17 stop response

The safe sequence is:

```text
1. Dalph asks the provider to stop A-17.
2. A fresh provider read confirms A-17 no longer consumes capacity.
3. Dalph admits and starts A-18.
4. The earlier stop request finally returns “A-17 stopped.”
5. The controller applies that delayed result only to A-17.
```

Dalph does **not** start A-18 merely because the stop request was sent. The
focused controller test proves the narrower correlation property: after a
fresh observation replaces occupied A-17 with A-18, a release for A-17 cannot
remove A-18. It does not by itself prove the whole production sequence above.

### How duplicate same-operation fibers can arise

The present API accepts repeated `awaitAdmission(transition)` calls. A future
activation topology could accidentally do this:

```text
startup trigger derives task B / operation B-7
recorded-result trigger derives the same unchanged B-7
both call awaitAdmission(B-7) before either owns the transition
```

Current call sites appear single-owner by convention, but the API and model do
not prove it. The preferred #132 destination is one coordinator activation loop
that derives again whenever a controller-snapshot change can permit admission,
or a unique single-consumer lease. The
frontier-recovery Quint model must then prove one owner per exact transition.
The raw duplicate-waiter defect remains only as a fail-closed internal guard.

## Responsibility-order decision — Option B accepted

These alternatives address U3 without requiring exact recreation of a lost
pre-crash frontier.

### Rejected Alternative A — controller carries the old responsibility order

Task Z's responsibility began at journal position 10 and task A's at position
20. Both wait while capacity is full. The controller stores those branded order
keys and gives the next position to Z, even if A's fiber registered first.

This preserves the earlier responsibility ordering but makes the controller a
second ordering authority that must remain synchronized with frontier
derivation.

### Accepted Alternative B — activation rederives when capacity changes

No dormant waiter owns the next choice. Whenever a controller-snapshot change
can permit admission—including fresh provider evidence of non-consumption or
reservation release/cancellation—the coordinator reads current reconstructed
managed-run state plus the controller snapshot and derives the frontier again.
If Z and A are still ready under identical current facts, the selector chooses
Z from journal position 10. If workflow-selected fresh facts now pause Z, A may
proceed.

This is deterministic for the current reconstructed inputs, retains every
responsibility, and does not claim that the lost pre-crash frontier must be
recreated exactly. It also avoids a second controller-level scheduler.

**Owner decision, 2026-07-26:** accept Alternative B. Whenever a
controller-snapshot change can permit admission—including fresh provider
evidence of non-consumption or reservation release/cancellation—the coordinator
reads current reconstructed managed-run state plus the controller snapshot and
derives the frontier and admission set again. The controller does not carry a
second responsibility order or let a dormant waiter own the next position.
This decision is recorded in the canonical
specification, ADR 0009, this ledger, the #132 Wayfinder handoff, and the live
#132 issue, whose amended wording was freshly reread.

## Findings to act on

1. **Issue 131 is not blocked on inventing a startup design.** The shared pure
   selector belongs to issue 131; wiring ordinary startup, restart, resume, and
   every recorded result through one production activation loop is already
   issue [132](https://github.com/dearlordylord/dalph/issues/132). Calling the
   absence of the complete issue-132 loop an issue-131 blocker overstated the
   current ticket.
2. **The implementation has two specification/test gaps worth addressing
   before issue 131 is accepted.** Capacity one is exercised by TypeScript
   examples, but the canonical Quint model fixes `CAPACITY` to two and the
   model-check script contains no capacity-one checking profile
   ([model](../specs/frontierRecovery.qnt#L162),
   [gate](../scripts/check-frontier-recovery-model.mjs)). Separately, blocked
   controller waiters are sorted by task/operation identity, not by the journal
   position that began the ready responsibility
   ([controller](../packages/orchestrator/src/task-admission-controller.ts#L151-L170),
   [ADR 0009](../docs/adr/0009-separate-frontier-from-bounded-admission.md#consequences)).
3. **Pause was planned, not ignored.** Issue 131 owns frontier/admission
   behavior when pause facts are supplied. Durable commands, interruption,
   passive restart, fresh-read resume, and physical reopening belong to issues
   [62](https://github.com/dearlordylord/dalph/issues/62),
   [134](https://github.com/dearlordylord/dalph/issues/134), and
   [135](https://github.com/dearlordylord/dalph/issues/135). The current
   reconstruction inventory names the pause omission explicitly
   ([inventory](../packages/orchestrator/test/frontier-recovery/RECONSTRUCTION-COVERAGE.md#intentional-omissions)).
4. **Review must move behind the executor boundary.** The current protocol is
   allowed to contain review, but review is not a universal orchestrator stage.
   Issue [133](https://github.com/dearlordylord/dalph/issues/133) already owns
   that refactoring, and issue [127](https://github.com/dearlordylord/dalph/issues/127)
   owns future configurable pipelines. This follows the canonical executor
   boundary ([context](../docs/CONTEXT.md#L23-L27)).
5. **The implementation-ticket metadata had drifted and is repaired.** Issue
   bodies declare `#130 -> #144 -> #131 -> #132 -> #133`. During this review,
   GitHub's native dependency metadata was changed to restore the missing
   `#130 -> #144 -> #131` chain and remove the incorrect direct
   `#130 -> #131` edge. The live dependency endpoint was reread afterward;
   see **Actions completed in this review** for closure proof.

## Vocabulary boundary

### Canonical Dalph vocabulary

These terms are defined in `docs/CONTEXT.md` and are safe in design discussion:

| Term | Concrete meaning |
| --- | --- |
| Workflow operation | One named Dalph action or observation, not a whole task or SDK call ([definition](../docs/CONTEXT.md#L605-L609)). |
| Operation identity | The stable identity linking one committed operation intent to its request, fresh checks, retries, recovery, and outcome ([definition](../docs/CONTEXT.md#L617-L622)). |
| Workflow responsibility | Dalph's durable obligation to continue, reconcile, preserve, isolate, or dispose one exact subject ([definition](../docs/CONTEXT.md#L630-L640)). |
| Runnable frontier | The non-persisted exact transitions currently allowed before capacity, plus exact reasons for responsibilities that cannot move ([definition](../docs/CONTEXT.md#L750-L756)). |
| Admission set | The deterministic capacity-bounded subset of the runnable frontier ([definition](../docs/CONTEXT.md#L758-L763)). |
| Task admission position | One configured, process-local capacity unit, reserved during preparation or occupied by an invocation that consumes it ([definition](../docs/CONTEXT.md#L765-L771)). |
| Named workflow wait | An exact non-action reason paired with the fact or signal that can wake it ([definition](../docs/CONTEXT.md#L932-L936)). |
| Run termination | A final run disposition recorded only after active work and retained resources/responsibilities have their required outcomes ([definition](../docs/CONTEXT.md#L952-L959)). |

“Settled workflow responsibility” was imprecise shorthand, not a separately
defined canonical noun. Say instead: “Dalph completed or durably relinquished
this exact obligation.” A task tracker reporting successful completion is also
not proof that all Dalph cleanup and resource obligations are done
([task completion](../docs/CONTEXT.md#L961-L965),
[finality rules](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#integration-completion-responsibility-and-finality)).

### Test/model notation only

- **M2** means Model 2, the bounded graph-frontier recovery Quint model
  `frontierRecovery.qnt`; it is formal-model vocabulary, not a production
  domain state
  ([model portfolio](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#formal-model-portfolio)).
- **P0–P6** are conformance-test cut points where a test truncates durable
  history and reopens the application. They are explicitly not runtime stages,
  states, priorities, events, or domain terminology
  ([cut-point table](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#conformance-test-recovery-cut-points)).
  In particular, say “restart before the next operation intent was recorded,”
  not “P0 restart,” outside a test discussion.
- **A, B, C, D** are four bounded model identities, not production task names.

### Implementation jargon to retire

- **Legacy startup/recovery** was wrong. Dalph is greenfield; the existing
  one-shot scheduler and fixed recovery dispatcher are *superseded
  implementation*, not a compatibility target. The historical Ralph harness is
  explicitly not Dalph architecture
  ([architecture](../docs/ARCHITECTURE.md#historical-harness-boundary)).
  Issue [143](https://github.com/dearlordylord/dalph/issues/143) owns deletion
  after migration.
- **Convergence arbitration** is neither persisted nor canonical vocabulary.
  The concrete behavior is: “when several task-work invocations wait for one
  available admission position, the process-local controller chooses which
  waiter receives it.” Use that sentence until a shorter canonical name is
  accepted.
- **Callers** in the duplicate-waiter discussion means two Effect fibers inside
  Dalph both invoking `awaitAdmission` for the same task and operation. It does
  not mean two users or external applications.

## Teaching examples

### Why one reservation needs the operation identity

Task identity alone cannot distinguish two successive invocations for task A:

```text
operation A-17 runs ──► provider later reports “A-17 stopped”
                              │ delayed
                              ▼
operation A-18 is now reserved/running
```

If the stop report carried only task A, it could release A-18's position by
mistake. With `(task A, operation A-17)`, the controller removes only the
A-17 record and leaves A-18 untouched. The implementation does this for
occupied observations
([controller](../packages/orchestrator/src/task-admission-controller.ts#L253-L277))
and tests the stale-release example
([test](../packages/orchestrator/src/runnable-frontier-responsibilities.test.ts#L428-L468)).

The identity is not evidence that anything is running. A **reservation** says
Dalph has assigned a position while preparing or dispatching an exact
invocation. Only a fresh provider observation moves that exact invocation into
**occupied** capacity
([specification](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#reconstructed-state-and-transition-selection)).

### Why review and capacity are separate dimensions

Review is not inherently capacity. The executor owns whether its selected
protocol has review and how review works. Capacity answers a different
question: “does this currently selected outer invocation consume one configured
task-work position?”

The current implementation hard-codes review and findings handback as
capacity-consuming transition tags
([controller](../packages/orchestrator/src/task-admission-controller.ts#L62-L69)).
That preserves the currently accepted review-capable protocol, but it is not
the final boundary. Issue
[#133](https://github.com/dearlordylord/dalph/issues/133) must replace internal
review knowledge with executor-declared outer transitions and declared capacity
use. Therefore review and capacity are conceptually orthogonal even though the
current protocol maps particular review invocations onto capacity positions.

### What duplicate waiting means

At capacity one:

```text
task A owns the only position
fiber X waits to run task B / operation B-7
fiber Y also waits to run task B / operation B-7  ← duplicate
```

When A releases the position, waking both fibers could execute the same
operation twice. The controller instead fails the second waiter
([implementation](../packages/orchestrator/src/task-admission-controller.ts#L187-L205),
[test](../packages/orchestrator/src/runnable-frontier-responsibilities.test.ts#L607-L632)).
It currently dies with an untyped `Error`; whether this is an impossible
program defect or a typed recoverable orchestration issue remains open.

## Verification strength and proposed prototypes

### Existing evidence, strongest first

1. **Formal model checking:** M2 checks abstract bounded capacity, exact intent,
   stable identities, local progress, explanations, and finality at fixed
   capacity two, with expected negative counterexamples
   ([properties](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#formal-model-portfolio),
   [gate](../scripts/check-frontier-recovery-model.mjs)).
2. **Sampled model-to-code conformance:** Quint-connect compares a model-exported
   selector projection with production reducers, selector, and controller
   ([adapter](../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.mbt.test.ts),
   [inventory](../packages/orchestrator/test/frontier-recovery/RECONSTRUCTION-COVERAGE.md)).
   Its current action slice is narrow and its model capacity remains two.
3. **Physical reopening examples:** fresh in-memory and closed/reopened SQLite
   tests cover before/after first claim intent and capacity-one/two selection
   ([tests](../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.test.ts#L298-L374)).
4. **Focused examples:** selector/controller tests cover exact stale
   observations, interruptions, duplicate waiters, explanations, finality, and
   capacities one/two
   ([selector tests](../packages/orchestrator/src/runnable-frontier.test.ts),
   [controller tests](../packages/orchestrator/src/runnable-frontier-responsibilities.test.ts)).
5. **Missing layer:** there is no generated property/state-machine test directly
   driving arbitrary controller command sequences. The exact interrupt-after-
   grant interleaving is excluded from deterministic coverage
   ([controller](../packages/orchestrator/src/task-admission-controller.ts#L221-L245)).

The next rigorous order should be:

1. add a real capacity-one M2 checking profile;
2. extend sampled MBT to capacity one and responsibility waiting/order;
3. add generated controller command sequences with invariants;
4. retain focused unit tests only for readable edge examples.

### Visual prototypes worth doing later

These are proposals only; no prototype was built during this audit.

| Prototype | What it would show | Constraint |
| --- | --- | --- |
| Exact-capacity timeline | Reservations and occupied invocations keyed by task/operation, including a delayed stale stop report. | Generate from controller snapshots; never imply that a reservation proves a running worker. |
| Restart step simulator | Journal facts, fresh authority reads, reconstructed responsibilities, frontier explanations, and admission after each step. | Use existing production projections and issue-132's future activation seam; do not invent a second scheduler. |
| Quint trace viewer | Convert Quint ITF traces into a clickable state/transition stepper, optionally rendered with XState's visual vocabulary. | XState would be a renderer, not the specification or verifier. Preserve model/action names and distinguish model notation from domain terms. |
| Executor-protocol viewer | Display executor-declared outer waits, invocations, capacity use, and outcomes. | Prototype after or against issue 133; visualizing today's internal review stages as universal Dalph stages would cement the wrong boundary. |

An automatable route is plausible: Quint emits ITF traces; a converter can map
each model state to a read-only view model and each action to a step edge.
XState can render that derived trace, but it should not independently decide
legal transitions. The restart simulator and Quint viewer can share this trace
format once issue 132 exposes the complete production activation projection.

## User feedback ledger

Every item below corresponds to the numbered annotation on the previous
assistant response.

### Items 1–7

| ID | Status | Answer and evidence | Fastest next verification |
| --- | --- | --- | --- |
| F1 — “What is the blocker; is the selector implemented; why not Quint tested?” | **Implementation proof recorded; owner acceptance pending** | The pure selector exists and the frontier-recovery Quint adapter calls it ([selector](../packages/orchestrator/src/runnable-frontier.ts#L305-L350), [adapter](../packages/orchestrator/test/frontier-recovery/frontier-recovery-selection.ts#L37-L97)). `frontierRecoveryCapacityOne` now exhaustively checks the full invariant set with independently eligible A and C; `frontierRecoveryCapacityCounterexample` proves that admitting both violates `boundedCapacity`; and Quint-connect compares the model export with the production selector/controller at capacities one and two. Full production activation remains #132 scope. | Issue owner reviews the returned commit, exact profiles, review dispositions, and final gate before accepting #131. |
| F2 — Explain stale task observation and propose visuals | **Resolved as explanation; prototype open** | See “Why one reservation needs the operation identity” and the exact-capacity timeline proposal above. | Build the trace-only prototype after acceptance behavior is settled. |
| F3 — Can the controller be tested rigorously, prioritizing MBT/property/unit? | **Partially resolved** | Yes. Evidence now spans capacity-one/two exhaustive model profiles, model-exported Quint-connect replay, fresh-memory and closed/reopened SQLite examples, and focused units. Arbitrary activation/controller command-sequence generation remains deliberately assigned to H3 after #132 makes ownership states model-visible; adding it here would harden the superseded waiter seam. | Preserve the capacity-one proof; add generated command-sequence invariants under H3 after the accepted #132 design. |
| F4 — Visual step simulation of convergence recovery | **Resolved as a proposal** | Existing journal/reconstruction/controller projections can drive a stepper. Issue 132 supplies the complete activation seam; issue 133 prevents internal review from becoming universal UI vocabulary. | Prototype a read-only trace viewer against the issue-132 projection, not production code. |
| F5 — The orchestrator must not know about review | **Partially resolved** | Canonical architecture agrees. Current code still exposes review-specific frontier transitions and capacity rules. Issue 133 explicitly moves them behind an executor-declared outer protocol; issue 127 later makes pipelines configurable. | Audit #131 types for names that #133 must replace; do not broaden #131 into #133 implementation. |
| F6 — Quint-to-XState step simulations | **Resolved as feasible discussion; prototype open** | ITF trace -> read-only view-model -> XState-style renderer is plausible. XState must not become a second transition authority. | Spike a converter on one retained M2 trace in a throwaway prototype. |
| F7 — Is the next design going to `/wayfinder`? | **Superseded by current H2 disposition** | Wayfinder issue #126 produced #131–#144 and their blocking edges. The current continuation is a focused #132 Wayfinder reconciliation because the activation/admission API and model-visible ownership states still require design; it does not invent another destination ticket. | Run the persisted H2 handoff after #131 acceptance evidence is available. |

### Items 8–14

| ID | Status | Answer and evidence | Fastest next verification |
| --- | --- | --- | --- |
| F8 — What is the duplicate-waiter defect; why was it not typed during the work? | **Open** | See the duplicate-fiber example above. The implementation deliberately treats it as a defect (`Effect.die`), but the production-control-plane preference for typed failures makes the classification debatable. It was not required by an explicit #131 acceptance bullet and was left as a review follow-up; that does not resolve whether the choice is correct. | Decide whether duplicate selection is impossible-by-construction or a recoverable invariant violation; encode that decision in a named type/test. |
| F9 — Is durable pause already planned? | **Resolved** | Yes: #62 owns commands, #134 whole-run pause, #135 task/group pause, and #142 final conformance closure. | Confirm native dependency edges match the documented chain. |
| F10 — “Legacy” is concerning in a greenfield system | **Resolved** | The word was wrong. Use “superseded implementation.” Architecture forbids compatibility with the historical Ralph harness, and #143 deletes superseded orchestration without wrappers. | Remove “legacy” from future explanations; no compatibility work is proposed. |
| F11 — The issue owner cannot answer the P0/startup question | **Resolved** | The question used test jargon and combined two tickets. Plain version: #131 proves the same selector handles uninterrupted and reconstructed facts; #132 makes production startup/restart repeatedly execute those selected operations. | Review #131 only against its shared-selector evidence; review production looping under #132. |
| F12 — Does the proposed exact-operation recovery API need `/wayfinder`? | **Resolved** | Its need is already captured by #132's shared activation loop and #133's executor-declared outer protocol. The earlier API sentence was a sketch, not an accepted API. | Design the callable seam while implementing #132, inside its accepted boundaries. |
| F13 — What is “convergence arbitration”; is it persisted vocabulary? | **Resolved as terminology; behavior still open** | It is not persisted or canonical. Say: “the process-local controller chooses one of several task-work invocations waiting for a position.” The ordering mismatch in U3 remains. | Do not add this phrase to domain docs; test the concrete ordering rule. |
| F14 — Postpone the opposing journal/task order test until understood | **Superseded by accepted Option B** | The owner reviewed both traces and rejected controller-carried responsibility order. The coordinator must derive again from current reconstructed state and the controller snapshot whenever a snapshot change can permit admission. | H2 must make that behavior model-visible; H3 must prove it at capacity one. |

### Items 15–20

| ID | Status | Answer and evidence | Fastest next verification |
| --- | --- | --- | --- |
| F15 — Capacity is configuration; restart 10 -> 2 is valid | **Resolved as policy; bound clarification and test open** | Agreed on the behavior: capacity is reconstructed from current configuration, not durable run history ([context](../docs/CONTEXT.md#L765-L770)). The current accepted `TaskWorkCapacity` range is one through eight, so the directly valid example today is 8 -> 2; accepting literal capacity 10 would be a separate policy-bound change. Issue #54 owns live non-preemptive resizing. Current recovery receives current configured capacity ([recovery](../packages/orchestrator/src/workflow-recovery.ts#L358-L387)). | Add restart tests with a changed configured limit, including existing observed usage above the new limit; separately decide whether the maximum should exceed eight. |
| F16 — Explain duplicate callers/transition/waiting | **Resolved as explanation; classification open** | See “What duplicate waiting means.” Two internal fibers request the same exact task operation while no capacity position is free. | Resolve F8's typed-defect decision. |
| F17 — What is M2; is it persisted vocabulary? | **Resolved** | M2 is Model 2, a test/specification label for `frontierRecovery.qnt`. It is not persisted domain vocabulary or production state. | Use “the frontier-recovery Quint model” in user-facing prose. |
| F18 — Preserve every uncertainty until understood | **Resolved procedurally** | This ledger gives every annotation and uncertainty a stable ID/status. “Partially resolved” and “Open” items remain explicit. | Update this file rather than deleting items; close an item only with cited evidence or a recorded decision. |
| F19 — Was pause deferred to planned issues or ignored from #131? | **Resolved** | It was deliberately split: #131 accepts supplied pause facts for frontier/admission scenarios; #134/#135 produce and operate durable pause facts. The current adapter's omission is documented. | Verify #135 provides the full scenario-2 physical lanes before #142 closes the matrix. |
| F20 — Derivation needs determinism/near-continuity/eventual reachability, not a duplicated exact frontier | **Partially resolved** | The accepted spec already forbids persisting/restoring the frontier and recomputes it from durable history plus fresh facts ([decisions](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md#reconstructed-state-and-transition-selection)). “Same exact next operation or explanation” applies only when both durable history and fresh observations are identical; a pre-intent identity may be newly allocated. “Closest reasonably possible” when fresh facts differ and “nothing forgotten” are liveness/responsibility concerns, not saved-frontier equality. | Record this clarification in the canonical specification if the issue owner's wording is intended to replace or relax the existing exact-same-input criterion. |

### Items 21–26

| ID | Status | Answer and evidence | Fastest next verification |
| --- | --- | --- | --- |
| F21 — Why `(task ID, operation ID)`? | **Resolved** | Task identifies the work item; operation identifies one exact invocation/action for that task. The pair prevents an old stop report from releasing a later invocation's position. See the timeline above. | Keep the stale A-17/A-18 scenario in readable tests and future MBT. |
| F22 — Aren't review and capacity orthogonal? | **Partially resolved** | Yes conceptually. Capacity follows declared resource consumption, not the word “review.” Today's fixed review-capable protocol hard-codes review/handback as consumers; #133 must move that choice behind the executor boundary. | In #133, replace review-specific controller knowledge with executor-declared capacity use. |
| F23 — What is responsibility settlement; is terminal task state “done, closed, cleanup complete”? | **Resolved** | Completing/relinquishing one workflow responsibility ends one exact Dalph obligation. Tracker task completion is a separate external lifecycle fact. Neither alone proves all cleanup/resources are finished; run termination requires those remaining obligations to be handled. | Use the concrete phrase “Dalph completed this exact obligation” before any shorthand. |
| F24 — What is P0; is it domain vocabulary? | **Resolved** | P0 means a test reopens after the previous durable outcome while the next choice existed only in memory. It is test vocabulary only. | Never say “P0” without “conformance-test cut point.” |
| F25 — Why does a reservation need an operation identity? | **Resolved** | It gives release/observation an exact subject and protects a later operation for the same task from stale evidence. A fresh first claim has no operation ID until its intent is allocated, so the implementation initially reserves `(task, null)` and then binds it. | Property-test bind/observe/release sequences across two operation IDs for one task. |
| F26 — P0 repeated | **Resolved** | Same answer as F24; the prior explanation incorrectly used a test label as if it were a production phase. | Use the concrete durable endpoint instead. |

## Original choices-audit uncertainty ledger

### U1 — Production startup does not directly invoke the selector

**Status: Partially resolved.**

- **Choice made:** Issue 131 added a shared pure selector and executable
  reconstruction adapter without replacing startup's fixed recovery dispatcher.
- **Why confidence was limited:** The issue requires uninterrupted and restarted
  coordination to choose the same exact next operation/explanation.
- **Evidence now:** The selector is a production module and both ordinary
  selection and the test-only reconstruction adapter call it
  ([ordinary path](../packages/orchestrator/src/workflow-run.ts#L70-L86),
  [adapter](../packages/orchestrator/test/frontier-recovery/frontier-recovery-selection.ts#L37-L97)).
  Issue #132 explicitly owns replacing production activation with one loop.
- **What could fail:** The shipped production startup path still cannot
  demonstrate end-to-end equivalence until #132 lands.
- **Fastest verification:** Treat #131's callable selector/conformance comparison
  and #132's production-loop acceptance as separate gates. Do not declare the
  complete journey runnable before #132.

### U2 — A quick tag-based recovery integration was rejected

**Status: Resolved.**

- **Choice made:** Remove a sketch that mapped exact selected operations down to
  broad recovery tags.
- **Why confidence was limited:** One tag could authorize a sweep over several
  operations and lose exact operation identity.
- **Evidence now:** Issue #132 requires the same reconstructed-state, frontier,
  admission, and interpreter seams; issue #133 requires typed outer executor
  transitions and correlations. Neither authorizes a tag-only phase dispatcher.
- **What could fail if reversed:** An unselected operation could run, or a
  retry could use the wrong identity.
- **Fastest verification:** Design #132 around one exact selected transition and
  one returned boundary result before deriving again.

### U3 — Waiting task-work invocations lose responsibility journal order

**Status: Owner decision resolved; implementation remains open under #132.**

- **Rejected implementation behavior:** Sort blocked waiters by
  `(TaskId, OperationId)`.
- **Accepted behavior:** Whenever a controller-snapshot change can permit
  admission—including fresh provider evidence of non-consumption or reservation
  release/cancellation—the coordinator reads current reconstructed managed-run
  state plus the snapshot and derives the frontier/admission set again. No
  dormant controller waiter owns the next position.
- **Why the prior behavior was rejected:** ADR 0009 orders already-owned ready
  responsibilities by the journal position that began the still-outstanding
  responsibility, with task identity only as the final tie-breaker. The pure
  frontier preserves `beganAt`; `awaitAdmission` does not receive it.
- **Concrete example:** Task Z's responsibility began at journal position 10;
  task A's began at 20. Both reviews become ready while capacity is full. The
  controller currently selects task A because `"A" < "Z"`, although ADR 0009
  says the older Z responsibility comes first.
- **What could fail:** Restarted or concurrently resumed work could violate the
  accepted responsibility-first deterministic order.
- **Required verification:** H2 must make the accepted single-owner/rederive
  behavior model-visible; H3 must add a capacity-one test with those opposing
  orders and prove the controller cannot make a second choice.

### U4 — Capacity was treated as a durable run input

**Status: Resolved as a mistaken concern; test gap remains.**

- **Choice made:** The implementation accepts current configured capacity when
  creating ordinary and recovery controllers.
- **Evidence now:** Canonical context says positions are recreated from
  configuration, responsibility, and fresh observations. The issue owner
  explicitly accepts lowering capacity across restart. The current branded
  configuration accepts only one through eight, so `8 -> 2` exercises that
  policy without separately changing the maximum; literal `10 -> 2` also asks
  whether the maximum should exceed eight. Issue #54 owns later live resizing.
- **What could fail:** No focused test currently proves restart under a changed
  limit, especially when observed running work temporarily exceeds the new
  limit.
- **Fastest verification:** Reopen the same history and fresh invocation
  observations under 8 -> 2, 1 -> 2, and 2 -> 1 configurations; verify no
  preemption and no new admission until usage permits. Decide the maximum-bound
  question separately before using 10 as a decoded configuration value.

### U5 — Duplicate waiters use an untyped defect

**Status: Open.**

- **Choice made:** `Effect.die(new Error(...))` for a second fiber waiting on the
  same exact transition.
- **Why confidence is limited:** The controller must prevent duplicate
  execution, but Dalph generally models expected production failures with typed
  failures. It is undecided whether duplicate selection is impossible internal
  corruption or a condition an activation loop must report and isolate.
- **What could fail:** A real scheduling defect becomes an unclassified fiber
  death with no domain-level reconciliation/reporting path.
- **Fastest verification:** Specify the invariant at #132's activation boundary:
  prove one fiber per selected operation by construction, or introduce a typed
  `DuplicateAdmissionWaiter` issue and fail closed.

### U6 — Interrupt-after-grant cleanup is not dynamically tested

**Status: Open.**

- **Choice made:** Protect handoff with `uninterruptibleMask` and cleanup an
  interrupted newly granted reservation.
- **Why confidence is limited:** The source explicitly excludes the narrow
  post-grant branch from deterministic coverage. Existing tests interrupt a
  waiter before capacity is released, not at the exact grant/handoff edge.
- **What could fail:** An ownerless reservation could permanently consume a
  position.
- **Fastest verification:** In a test-only controller constructor, inject a
  latch immediately after reservation creation and before ownership handoff;
  interrupt there, release the latch, and prove the next waiter is admitted.

### U7 — The stored M2 selector projection can become stale

**Status: Partially resolved.**

- **Choice made:** Refresh `selectorProjection` only on the actions used by the
  current reconstruction adapter slice.
- **Why confidence is limited:** Many other M2 actions mutate workflow,
  authority, or pause without refreshing it
  ([actions](../specs/frontierRecovery.qnt#L1336-L1504)).
- **What could fail:** A future adapter action could compare production against
  a stale model-exported scheduler result.
- **Fastest verification:** Prefer deriving the projection at export time. If
  Quint tooling requires stored projection, add and check an invariant equating
  it to `computeSelectorProjection(state.workflow, state.knowledge,
  state.control)` after every action.

### U8 — Physical pause reopening was deferred

**Status: Resolved as ticket scope; future work remains tracked.**

- **Choice made:** Issue 131 used model pause states and selector/controller
  examples rather than inventing production pause commands.
- **Why confidence was limited:** Scenario 2 describes interruption, capacity
  release, and resume, while issue 131 requests that scenario at capacities
  one/two.
- **Evidence now:** Issue #135 explicitly owns scenario 2 and its pause,
  interruption, fresh observation, capacity release, and resume lanes. Issue
  #134 owns whole-run durable pause; #142 closes the complete matrix. The issue
  131 slice owns only the admission result for supplied pause/resume facts.
- **What could fail:** If #135 does not extend the same model adapter and both
  stores, the end-to-end scenario remains unproved.
- **Fastest verification:** Keep the omission in the coverage inventory until
  #135 adds memory and closed/reopened SQLite lanes; #142 must refuse closure
  while it remains.

## Additional open evidence gaps

These were discovered during research and are not substitutes for F1–F26 or
U1–U8:

1. **Capacity-one model evidence (implementation proof recorded; owner
   acceptance pending):** `CAPACITY` is now supplied by the checking profile.
   The gate exhaustively checks `frontierRecoveryCapacityOne` with independently
   eligible A and C and requires the deliberately weakened capacity-one action
   to violate `boundedCapacity`. Quint-connect replays the model export through
   the production selector/controller at capacities one and two.
2. **Model projection scope:** `computeSelectorProjection` considers only model
   tasks A and C, has empty explanations/occupancy, and equates frontier,
   admission, and reservations at capacity two
   ([projection](../specs/frontierRecovery.qnt#L288-L330)). This is adequate only
   for the declared reconstruction slice, not a complete scheduler refinement.
3. **Native dependency drift (closed external action):** GitHub's native edges
   did not match the ticket bodies around #130/#144/#131. They were repaired
   and freshly reread during this review; see **Actions completed in this
   review**.
4. **Acceptance state:** Issue 131 remains open and unchecked; local commits and
   a successful `pnpm check:all` are implementation evidence, not issue-owner
   acceptance.

## Historical recommended sequence and current disposition

This was the recommended sequence before the second feedback round. The
dispositions below prevent completed actions from being reopened accidentally.
No row authorizes production implementation.

1. U3 is resolved by the owner's accepted Option B and is assigned to H2/H3 for
   design and implementation proof. U5 remains assigned to the #132 Wayfinder,
   which must make duplicate ownership unrepresentable or specify a typed
   fail-closed issue.
2. Capacity-one evidence is **Handoff ready** under H1. The
   interrupt-after-grant seam belongs to the H2 design and later H3
   implementation.
3. The #131/#132 wording action is **Resolved — externally proven**; #132
   behavior remains open.
4. Deterministic-recomputation wording is **Resolved — repository proven** in
   commit `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`.
5. Native dependencies are **Resolved — externally proven**. Pause and executor
   work remain attached to #133–#135.

## Second feedback ledger

This ledger preserves all 25 annotations from the review of this document.

| ID | Status | Disposition and required proof |
| --- | --- | --- |
| SF1 — Narrow #131; preserve useful #132 context | **Resolved — externally proven** | #131 and #132 were amended and reread. This closes the wording action only. #132 now records exact-operation dispatch, repeated derivation, changed restart capacity, and one-chooser requirements; its implementation remains open. |
| SF2 — Handoff the #131 gaps | **Implementation proof recorded; owner acceptance pending** | [Capacity-one evidence handoff](issue-131-handoffs/capacity-one-evidence.md) returned `frontierRecoveryCapacityOne`, `frontierRecoveryCapacityTwo`, the weakened `frontierRecoveryCapacityCounterexample`, capacity-one/two Quint-connect replay, passing fresh-memory and closed/reopened SQLite lanes, canonical coverage updates, review dispositions, and the full repository gate. This proof does not accept or close #131. |
| SF3 — Persist pause ownership like SF1 | **Resolved — externally proven** | #134/#135 were amended and reread. This closes the wording action only; existing #62/#134/#135 tickets remain the implementation continuations. |
| SF4 — How to continue the executor-boundary work | **Handoff ready** | The [#133 executor-boundary handoff](issue-131-handoffs/issue-133-executor-boundary.md) starts only after #132. No new Wayfinder is needed because the destination and accepted boundary already exist. |
| SF5 — Update drifted metadata | **Resolved — externally proven** | Native issue dependencies were changed and reread. |
| SF6 — Perform the exact metadata repair | **Resolved — externally proven** | The incorrect direct edge was removed and the two missing native edges were added. |
| SF7 — Add a workflow-responsibility example | **Resolved — repository proven** | The concrete claim-intent/recheck example accurately instantiates the existing canonical definition and was reviewed, committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`. |
| SF8 — Add a named-wait example | **Resolved — repository proven** | The dependency-wait/wake-observation example accurately instantiates the accepted named-wait rule and was reviewed, committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`. |
| SF9 — Explain how A-18 precedes A-17's delayed response | **Resolved — repository proven** | The reviewed five-step sequence requires a fresh release observation before A-18 and no longer overclaims the focused test. It was committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`; production journey proof remains owned by its implementation ticket. |
| SF10 — Prevent agents treating evidence/review-specific code as the spec | **Persisted plan — implementation open** | #133's live warning is verified. Committed source comments identify evidence sealing, review, handback, and the superseded #132 waiter queue. Actual removal/replacement remains the #132/#133 handoffs. |
| SF11 — Explain two same-operation fibers | **Resolved — repository proven** | The concurrent-trigger example explains why #132 ownership design remains open and was reviewed, committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`. |
| SF12 — If MBT cannot drive the duplicate, redesign it | **Handoff ready** | The controller audit agrees. The #132 Wayfinder must expose ownership states; later MBT must drive duplicate triggers or prove them unrepresentable. An untestable possible branch is unacceptable. |
| SF13 — Handoff generated controller testing | **Resolved — no work required** | The routing decision is complete: do not harden the repeatable waiter API because that would cement a seam intended to disappear. Activation/controller MBT belongs in H3 after the H2 design result. |
| SF14 — Handoff the rigorous test order | **Handoff ready** | Capacity-one formal checking is H1. Activation interleavings, generated command sequences, and readable edge examples belong in H3 after H2. |
| SF15 — “Later” means this review's continuations | **Handoff ready** | Visual work is now the explicit H5 handoff/sub-agent continuation in this review, not an unspecified future. |
| SF16 — Research Effect Analyzer with Quint and Dalph | **Resolved — repository proven** | The cited [evaluation](effect-analyzer-quint-evaluation.md) records pinned-source trials against Dalph. It rejects analyzer-as-correctness-gate and source-to-Quint generation, supports one isolated ITF-view prototype, and separates later source-analysis adoption. The note was independently reviewed, committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`; H5 remains separately **Handoff ready**. |
| SF17 — Where capacity-one checking belongs | **Implementation proof recorded; owner acceptance pending** | The narrow [capacity-one evidence handoff](issue-131-handoffs/capacity-one-evidence.md) is implemented without #132 activation, changed-capacity restart, pause-command, or #133 executor-boundary work. The issue owner still owns acceptance. |
| SF18 — Where the #131 review-type audit belongs | **Handoff ready** | The audit evidence names the affected symbols in #133. No more discovery sub-agent is needed; replacement belongs to the [#133 executor-boundary handoff](issue-131-handoffs/issue-133-executor-boundary.md). |
| SF19 — Repair dependencies now | **Resolved — externally proven** | Completed and reread through GitHub's native dependency endpoint. |
| SF20 — Preserve the callable activation seam in #132 | **Resolved — externally proven** | The live #132 body was updated and reread. This closes the wording action only: it now forbids broad phase-tag sweeps and requires one exact selected operation/result/rederive step. Implementation remains open. |
| SF21 — Changed configured capacity tests | **Persisted plan — implementation open** | The live issue now requires 8→2, 1→2, and 2→1 restart behavior. H2 must update the model because grandfathered occupancy can exceed the new future-admission limit; H3 must implement and test it. |
| SF22 — Persist “frontier-recovery Quint model” wording | **Resolved — externally proven** | The live #131 body was amended and reread. Existing canonical authority already defines M2 as Model 2 test notation, so no runtime vocabulary changed. |
| SF23 — Persist the P0 terminology restriction | **Resolved — no work required** | The canonical specification and every relevant live issue already state that P0–P6 are conformance-test cut points only, not stages/states/priorities/events/domain terms. This document supplies the user-facing expansion rule. |
| SF24 — Show both U3 behaviors before asking | **Resolved — repository proven** | The owner accepted Option B on 2026-07-26 after reviewing both traces. The live #132 issue was updated and reread: whenever a controller-snapshot change can permit admission, the coordinator reads current reconstructed managed-run state plus the snapshot and derives again. The canonical specification, ADR 0009, ledger, and H2 changes were reviewed, committed, pushed, and remotely reread in `f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`. Implementation remains open under #132. |
| SF25 — Route U3/U5 and the four later items | **Handoff ready** | See the continuation registry below. No uncertainty is left as an unnamed “later”; the declared handoff results remain open until returned and proven. |

## Continuation registry

### H1 — Issue #131 capacity-one evidence

Handoff: [Capacity-one evidence](issue-131-handoffs/capacity-one-evidence.md)

Implementation proof is recorded; issue-owner acceptance remains pending. The
returned evidence consists of real capacity-one/two Quint profiles, the
weakened-capacity counterexample, sampled production selector/controller
comparison, fresh-memory and closed/reopened SQLite lanes, canonical coverage
updates, all three review dispositions, and `pnpm check:all`. This ledger item
is intentionally not marked resolved by the implementer.

### H2 — Issue #132 activation Wayfinder

Handoff:
[#132 activation Wayfinder](issue-131-handoffs/issue-132-activation-wayfinder.md)

May start as a decision continuation, but #132 implementation remains blocked
until #131 is accepted. Its result must materialize the accepted single
coordinator-loop/rederive behavior, admission handoff, restart ownership,
changed-capacity model, and MBT-visible interruption states. The result must
update the existing Wayfinder/ticket decision record and this ledger.

### H3 — Issue #132 implementation and validation

Not yet generated: its scope depends materially on H2. Generate it only from
H2's accepted design. Required return will include model actions for enqueue,
grant, ownership, interruption before/after grant, release, and reconstruction;
counterexamples for duplicate ownership/leaked reservation; production-facing
MBT; property command sequences; memory/SQLite changed-capacity restart; review
passes; and the full gate.

### H4 — Issue #133 executor boundary

Handoff:
[#133 executor boundary](issue-131-handoffs/issue-133-executor-boundary.md)

Do not start until the accepted #132 implementation and validation result
exists. Its result is
required before issue #62 and therefore before #134/#135. It must remove
evidence-, review-, and handback-specific knowledge from generic orchestration
while retaining the current executor protocol behind its adapter.

### H5 — Effect Analyzer, Quint trace, and Dalph analysis research

Research note:
`research/effect-analyzer-quint-evaluation.md`

Prototype handoff:
[Quint trace explanation view](issue-131-handoffs/quint-trace-view-prototype.md)

The research result is committed in
`f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`. It establishes that Effect
Analyzer must not be a correctness oracle and that Quint must not be generated
from Effect source. The H5 prototype may start independently and is optional
for #131–#135. Its required return is three trace kinds, decoded normalized
frames, table plus one visual, equality with the existing MBT projection,
fail-closed lossy/unknown cases, provenance, and a user-facing format
recommendation.

Source-analysis adoption is a separate later decision. No handoff is generated
for it now because its result is not needed to continue #131–#135 or choose the
prototype format. Before adding a dependency or CI lane, a future handoff must
return every Decision B item in the research note, including diagnosis of the
incomplete whole-directory audit and one unique review finding.

### Pause continuations

No new Wayfinder or handoff is needed now. Existing issues #62, #134, and #135
already own the required work and their live bodies now preserve the exact
evidence boundaries. Their implementations require the completed #133 and
control-service prerequisites declared by native dependencies.

## Review bundle publication proof

The substantive review bundle is commit
`f6118dbe3186d7f2e106355f35f9ca1e7cd3fd69`. It contains the canonical
specification and ADR changes, transitional #132/#133 source comments, Effect
Analyzer/Quint evaluation, all four handoffs, and this ledger's reviewed
content.

Proof recorded before this final checkpoint:

1. independent domain/spec, architecture/connascence, and strict
   standards/code reviews reported their findings;
2. every reasonable finding was accepted and corrected;
3. every repeated review returned clean;
4. `pnpm check:all` passed on the corrected state, including both Quint gates,
   452 tests in 70 files, coverage thresholds, and secret scanning; and
5. the substantive commit was pushed and a fresh fetch proved
   `origin/master` matched it.

The commit containing this final checkpoint is the publication-proof follow-up.
The live [issue #131](https://github.com/dearlordylord/dalph/issues/131) section
named `Review bundle publication proof` records its exact SHA and the final
`origin/master` reread. No production behavior was added by either publication
commit.

## Compaction checkpoint

After conversation compaction, a fresh agent should:

1. read this file's **Current control protocol**, **Second feedback ledger**,
   and **Continuation registry** before older status sections;
2. work from `/workspace/typescript/dalph` on `master`, require a clean worktree,
   and verify `HEAD`/`origin/master` match the exact final proof commit recorded
   in live issue #131 under `Review bundle publication proof`;
3. read H5's completed committed research note and use
   [the persisted H5 handoff](issue-131-handoffs/quint-trace-view-prototype.md)
   only if running the optional trace prototype;
4. treat SF24's Option B decision as accepted and do not requery it unless new
   contradictory evidence requires an explicit reconsideration;
5. start no implementation from historical status rows; use only the
   continuation registry and each linked handoff's required return; and
6. never mark behavior resolved from an issue-body update alone.
