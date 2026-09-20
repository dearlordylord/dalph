# Issue #384 supervised dogfood run log

**Run date:** 2026-09-19 (America/Montreal)  
**Target:** [GitHub issue #384](https://github.com/dearlordylord/dalph/issues/384)  
**Purpose:** Produce and supervise a reviewable direct-remote-publication
candidate with Dalph, while the supervisor retains manual publication and
tracker-closure control.

This is a durable log of process failures, missing controls, and ineffective
behavior observed during the run. It distinguishes the frozen runtime used to
exercise Dalph from the task candidate produced by Dalph. The run root and raw
evidence remain under `/tmp/dalph-384-supervised.7kSCeQ`; those paths are local
evidence locators, not repository artifacts.

## Run configuration

- Hosted and planned Base SHA:
  `c227fe92288f321c944d6c6fb1df632e697ea089`.
- Executor: Codex `gpt-5.6-sol`, medium reasoning.
- Capacity: one task attempt.
- Tracker root: issue #384.
- Frozen runtime repair commit used only for this dogfood run:
  `ab0ded631f11362441e506b3d93efd68a9d84d15`. It was not published because its
  full gate was unproven.
- The supervisor controls the eventual non-force push, hosted verification, and
  issue closure correction.

## Observations

### Claim-owner configuration has an undocumented effective length limit

The first run used `claimOwner: "dalph:supervised-issue-384"`. Claim acquisition
failed because GitHub limits a label description to 100 characters and Dalph
encodes the claim protocol version, operation id, owner, and token into that
description. The typed failure was:

`GitHub claim operation, owner, and token must fit the 100-character label description without '|'`.

The public configuration accepted the owner, but the failure appeared only
after the Run had durably recorded claim-acquisition intent. The retained Run
could not use a corrected owner because the invalid owner was already part of
its durable operation. A new journal with `claimOwner: "dalph:384"` was needed.

Needed improvement: validate the complete encoded description during
configuration admission, report the maximum usable owner length, and avoid
allocating a Run that cannot issue its first claim mutation.

### Production status throttling hid live owner progress

The shipped production CLI used an enforcing stream throttle that could drop
the materialized live-owner status. A focused process-recovery test timed out
after 130 seconds with that implementation. Replacing it in the frozen runtime
with a debounced status stream made the same test pass in approximately 8–12
seconds and allowed this run to expose live progress.

Needed improvement: publish the latest coalesced status at the observation
boundary. Status presentation must not discard the only evidence that an owned
operation is live.

### The app-server launch flag did not set unattended thread policy

Dalph launched Codex as
`codex --dangerously-bypass-approvals-and-sandbox app-server`, and the source
comment says this prevents an unattended Run from pausing for approval or using
an unavailable sandbox. The first actual task thread nevertheless recorded:

- `approval_policy: on-request`
- `sandbox_policy: read-only`

The executor's first repository read failed because the host cannot create the
requested bubblewrap namespace. Codex then retried with an approval-required
tool call. Dalph did not answer or expose that approval request, so the attempt
remained projected as `Running` with no worktree change.

Adding `approval_policy = "never"` and
`sandbox_mode = "danger-full-access"` to the isolated Codex configuration before
creating a fresh thread fixed the boundary. The corrected thread recorded the
intended policy and completed repository tool calls.

Needed improvement: either send explicit sandbox and approval policy through
the app-server thread/turn request or validate the ambient Codex configuration
before task allocation. The executable launch flag is insufficient evidence of
the effective thread policy.

### Approval-bound executor work is invisible and has no public recovery control

The approval request was visible only by inspecting the private Codex rollout.
Public Dalph status showed generic executor work as `Executing`; the coordinator
also showed `EvidenceUnavailable` while waiting for a finished candidate. It did
not identify the pending approval as the blocking fact.

A clean Dalph stop removed the app-server process but retained the exact attempt
as `Running`. A successor correctly reconciled the same thread and did not send
a duplicate turn, but it could not change the already-recorded turn policy or
resolve the pending approval. The public CLI has no cancel, abandon, deny, or
retry-as-new-attempt action.

Needed improvement: project pending provider approvals as a distinct blocking
state and add a disposition-typed recovery control that can terminate an
unusable turn and authorize a new attempt without private-store or journal
editing.

### Claim release left a stale repository label that blocked a fresh Run

After stopping the approval-bound attempt, issue #384 no longer carried the
claim label, but the repository still contained the unattached label
`dalph-claim-20265f7f41bde838eca510225e8f5821` with the old operation token in
its description. A fresh Run repeatedly read the tracker after
`TaskClaimAcquisitionInitiated` and did not acquire the task.

The supervisor proved that the exact label was attached to no open or closed
issue, deleted that one stale Dalph-owned label, and left the fresh Run active.
Dalph then recreated the label with its new token, recorded
`TaskClaimAcquired`, planned the attempt, prepared the worktree, and started the
executor.

Needed improvement: claim release should delete or safely recycle an unattached
claim label. Fresh acquisition should report a token conflict instead of
indefinitely alternating tracker reads.

### Fresh claim acquisition can appear as ineffective tracker polling

While blocked by the stale label, the journal accumulated repeated
`TaskTrackerReadInitiated` and `TaskTrackerFactsObserved` pairs. Current status
alternated between a live graph read and a proposed graph read without surfacing
the unresolved claim mutation or its stale-token cause.

Needed improvement: retain and project the exact pending claim obligation and
its last mutation/reconciliation result. Repeated reads should have a finite
budget and a terminal or grantable state.

### Repository-wide pre-existing failures weaken candidate qualification

The frozen runtime repair's full gate stopped in preflight before qualification
stages. Its failures were outside the one-file status-stream patch: existing
Effect diagnostics, unused Kimi exports and an unrelated lint finding, stale
complexity-suppression counts, a formal-profile digest mismatch, and
unregistered exported Kimi layers. The current #384 task turn also found eight
pre-existing Kimi test-fixture TypeScript errors at the accepted Base.

Needed improvement: keep `master` green enough that a task candidate can obtain
an attributable full-gate result. Baseline failures force the supervisor to
distinguish candidate regressions manually and prevent required qualification
from proving the candidate.

### The task agent stopped after broad gate repair without sealing the attempt

The task agent produced implementation commit
`2f8c37059b163e426453a36041a87023fe900950`. Its first full gate,
`5582cf6f-e9a1-415e-b44f-75100432a8d8`, stopped in preflight with closed
registration, stopped custody, and unproven qualification. The agent then
expanded the task candidate to repair complexity, formal-manifest,
capability-registration, and unrelated Kimi/type-lint findings exposed by that
gate. It stopped producing rollout activity after making those edits and did
not commit them or return a terminal executor report.

At the recorded 17:00 EDT stop time, the supervisor stopped Dalph and the Codex
app-server cleanly, retained the task worktree, repaired one malformed JSON
edit and a cascading lint failure, ran `pnpm check:fast`, and committed the
retained edits as `0ec589dad1b2cb4fcbd2dc66fd9485bc024f644f`. The Dalph
journal still projects the executor responsibility as running because the
provider never returned its terminal report.

Needed improvement: bound nonterminal provider reasoning after repository
effects, surface the last durable executor observation, and provide a public
way to request a terminal report or disposition without discarding a valid
candidate.

### A second full gate surfaced a clone-wide lint census after focused checks passed

The supervisor froze repaired candidate `0ec589dad1b2cb4fcbd2dc66fd9485bc024f644f`
and ran full gate `66776dd5-8afb-4356-9695-fb41638dd248`. The gate ran from
21:05:32Z to 21:10:22Z. Registration closed and custody stopped, but
qualification remained unproven because `pnpm lint:code --census` reported
type-aware findings across many existing `scripts/*` files. Build/artifact,
cycle, complexity, duplication, secret, and focused test stages shown in the
preflight output passed; qualification stages did not start.

This was the second broad gate that failed before producing candidate
qualification after the candidate's pinned-base `check:fast` passed. Another
broad rerun without a distinguishing repair is prohibited by the repository's
finite-work guidance.

Needed improvement: keep the clone-wide compatibility census green at the
planned Base, or provide attributable baseline evidence without requiring a
task agent to absorb unrelated repository repair.

The supervisor later ran the exact `pnpm lint:code --census` command at untouched
Base `c227fe92288f321c944d6c6fb1df632e697ea089`, temporarily reusing the
candidate's frozen dependency tree. It failed in 56 seconds with the same broad
class of `scripts/*` type-aware findings, including `no-floating-promises` and
`no-unnecessary-condition`. The temporary dependency link was removed and the
Base checkout remained clean. This proves the clone-wide lint obstruction
predates #384; it does not waive the required full gate or the candidate's
separate specification blockers.

### Review found that publication remains optional and starts too late

The candidate adds `publication` as an optional production configuration value.
When it is absent, the existing `RunTargetPromotion` action skips remote
publication, promotes the local target, and can continue to tracker completion.
When it is present, its first remote observation or push happens only after task
claim, execution, integration, and candidate qualification.

Issue #384 requires one explicit destination to be validated before task claim,
requires the configured branch to exist and be compatible with the local target,
and forbids missing or changed destination configuration for unfinished history.
The candidate therefore preserves the exact local-only completion path that the
ticket removes and cannot catch a safely advanced local target up to the remote
head before fixing the Integrator session.

Needed improvement: admit and pin the remote destination during Run
establishment, prove the existing remote head and ancestry before claim/provider
work, and make publication proof a mandatory premise of promotion and finality.

### Definite remote rejection is not distinguished from a safe race

The Git adapter records every parsed `!` porcelain status as a generic
`Rejected` result. The protocol observes the remote afterward. If the remote is
still an ancestor of the candidate, the next activation automatically retries
the push while allowance remains. That behavior is correct for a non-fast-forward
race which fresh facts prove can now fast-forward, but it also retries branch
policy, authentication, and throttling rejections that leave the remote head
unchanged.

Issue #384 requires those definite denials to retain work and forbids automatic
retry, especially for throttled mutations.

Needed improvement: preserve a typed rejection cause from Git's correlated
per-ref/transport result and authorize automatic retry only for the exact safe
fast-forward race case.

### Restarting a nonterminal executor caused an unbounded read-and-status storm

After the second gate, the supervisor restarted the retained Run to let the
same Codex thread return its terminal report. In about 38 seconds the process
wrote 158 MiB of public NDJSON and consumed roughly one CPU core. The Journal
grew to 3,679 records: 1,834 `TaskTrackerReadIntentRecorded` events and 1,832
`TaskTrackerFactsObserved` events, while the only executor report remained the
original `ExecutorWorkExecuting` at position 232 and its last durable state
observation remained `ExecutorStateUnreadable` at position 233. No integration
event was recorded.

The supervisor stopped the process cleanly rather than waiting for the five
minute bound because direct Journal evidence distinguished tracker churn from
executor progress. Raw output is retained at
`/tmp/dalph-384-supervised.7kSCeQ/evidence/run-384-resume-after-gate.ndjson`.

Needed improvement: a nonterminal executor wait must not continuously allocate
fresh tracker-read operations or republish the complete expanding status. It
needs a stable wait keyed to a provider observation/wakeup, bounded polling, and
incremental or size-bounded presentation.

### Resuming the exact Codex thread directly also failed to advance

To distinguish coordinator recovery from provider behavior, the supervisor used
Codex's supported `exec resume` interface on the exact recorded thread
`01a0bb3a-3e2f-7b53-98cf-5fb72159da2c`, with the same Sol model, medium
reasoning, unattended policy, and worktree. The follow-up named the scoped
review blockers, prohibited another full gate, and requested focused checks and
one repair commit.

The thread read the relevant publication/configuration files, then produced no
tool call, message, worktree edit, or commit for the rest of its bounded run.
The supervisor stopped it at the announced 17:30 EDT boundary after about 13
minutes. The candidate remained clean at `0ec589dad1b2cb4fcbd2dc66fd9485bc024f644f`.

This experiment separates two failures: Dalph adds a tracker/status storm while
waiting on an unreadable executor, and the provider thread itself can remain
nonterminal after a concrete bounded follow-up.

Needed improvement: retain a finite provider-response deadline and expose a
typed stopped/suspended disposition that permits supervised replacement or
manual candidate adoption without editing private state.

### No autonomous review-and-repair loop ran

Dalph sent one Begin command through the planned-attempt executor boundary and
then passively observed that executor. It did not start an independent
specification or repository-standards review, did not turn review findings into
a repair handback, and did not require finding closure before accepting an
executor result. The current domain and architecture explicitly leave review,
retry, handback, restoration and convergence inside a future opaque production
executor algorithm.

The review which found the optional-publication, late-admission, rejection and
acceptance-evidence gaps was a supervisor action after the provider stopped
advancing. The direct Codex resume was also a manual diagnostic experiment; it
was not a Dalph-owned review cycle. The run therefore did not test an
autonomous review loop because no such production loop is currently composed.

The provider transcript also rules out missing specification context as the
initial cause. The executor read the complete accepted direct-publication
scenario and initially planned explicit S1/S3/S5/S6/S7/S8 coverage plus scoped
review closure. It then selected what it called the "smallest complete protocol
boundary": publication events, a Git adapter, late promotion composition and
focused component/model tests. It committed after those checks and described
the candidate as internally consistent without completing or reconciling the
original scenario-to-test plan. The optional configuration and post-integration
entry point were visible in the files it changed. Its attention then moved to
full-gate metadata and unrelated baseline repair. No later independent review
returned the omitted acceptance obligations to the implementer.

The initial implementation failure was therefore scope drift from an
end-to-end accepted slice into a component milestone, combined with an
unenforced planning checklist. The system failure was allowing that drift to
remain unchallenged: passing focused checks and a commit were treated as enough
progress even though named acceptance evidence and review closure were still
absent.

Needed improvement: specify and implement a finite production executor
algorithm which obtains independent specification and standards findings,
hands attributable findings back to an implementer, reruns only affected review
axes, and returns terminal success only after every blocking finding is closed
and required acceptance evidence is mapped. Dalph's generic orchestration
boundary can remain coarse while the executor owns this internal convergence.

## Effective behavior worth retaining

- Exact-Base task worktrees and distinct journals/private stores allowed failed
  attempts to remain intact while a clean retry proceeded.
- Restart reconciliation reused the exact approval-bound Codex thread and did
  not duplicate `turn/start`.
- The corrected unattended thread discovered the linked parent specification
  and repository guidance from the issue and Base worktree without a copied
  parent body in its initial prompt.
- Once unblocked, the task agent amended governing invariants and architecture
  before runtime behavior, then integrated the new durable events through the
  journal, cassette, renaming, and occurrence-projection contracts.

## Historical self-dogfood disposition

The retained candidate is evidence from the autonomous attempt. The supervisor
will not repair it into the #384 solution because doing so would bypass the
dogfood objective: Dalph's executor must be able to discover and close the
specification gaps itself. A later #384 attempt should start only after the
operational failures and the missing autonomous review-and-repair capability
have an accepted path. This disposition describes that historical self-dogfood
mechanism; it does not govern the current user-directed orchestrator attempt
recorded below.

The demonstrated operational failures are tracked in
[issue #390](https://github.com/dearlordylord/dalph/issues/390). General bounded
status output and graceful Exit remain tracked in issue #378.

At the final custody check, hosted `master` had advanced from the planned Base
to `986d5b8321bc6b75f9dc9663306f8df46c39495c`. The isolated target checkout
remained clean at the planned Base, the task candidate remained clean at
`0ec589dad1b2cb4fcbd2dc66fd9485bc024f644f`, issue #384 remained open, and no
Dalph claim label or supervised process remained. The supervisor did not push:
the candidate is unqualified, has unresolved specification blockers, and an
ordinary push can no longer fast-forward the advanced hosted branch without a
new integration candidate.

## Review-instructed fresh canary

The supervisor started a fresh issue #384 canary on 2026-09-19 at 18:30 EDT.
The runtime is the clean detached build at
`1e61fe2e5b824110d7a261751e187b109b69586c`, which adds the configurable,
bounded internal Codex review instruction. The executor is Codex
`gpt-5.6-sol` at medium reasoning effort in an isolated unattended Codex home.
The clean target clone and all run evidence are rooted at
`/tmp/dalph-384-review-canary.RuqT7G`.

Before starting the run, the supervisor proved that the prior run's exact
Dalph-owned claim label was attached to no issue and deleted that stale label.
A recurrence of the claim, approval-policy, or provider-stall failures tracked
by issue #390 will stop this canary; the supervisor will not repair around it.
The executor receives issue #384 by tracker link and owns implementation,
review, and repair. The supervisor will provide custody, time bounds, process
evidence, and the transitional ordinary fast-forward publication only. The
outer run stop is 19:22 EDT.

### Review-instructed canary stopped on an unbounded executor edit

The fresh Run started at 18:33 EDT and the supervisor stopped it at 18:42 EDT,
well before the outer deadline. Dalph acquired one task claim, created one exact
Base worktree, and began one Codex turn under the intended unattended policy.
The executor found the accepted parent scenario, mapped the remote-first cut to
the governing documentation, both Quint models, the runtime boundary and the
S1/S3/S5--S8 tests, then began implementation without supervisor steering.

The executor subsequently issued a JavaScript tool script whose `while (true)`
loop repeatedly applied this transformation to every occurrence in two Quint
test files:

```text
.then(offerPromotionPremise(1))
```

became a sequence which ended with the same
`.then(offerPromotionPremise(1))` text. A successful patch therefore recreated
its own match and the loop could not reach its intended no-match exit. In about
95 seconds, `specs/acceptedResultIntegration_test.qnt` grew to 92,674 bytes and
added 1,470 lines while the number of remaining matches stayed at eight. The
negative test had not yet been reached. The supervisor sent SIGINT rather than
allowing the loop to consume disk until the outer deadline. Dalph exited with
status 130 and no supervised process remains.

This attempt did not reach focused checks, the full gate, a candidate commit or
the configured independent review rounds. Issue #384 remains open and no
candidate was published. The exact dirty worktree is retained under
`/tmp/dalph-384-review-canary.RuqT7G/task-worktrees`; the Codex rollout is
1,487,514 bytes with SHA-256
`71821b3173718959a1b0588afaa2992d6711a330ab4ebbdce277755d0748994d`.
The 200,208,593-byte CLI stream and 348-row Journal are retained in the same run
root.

The stopped Run's repository-scoped claim record remains as
`dalph-claim-20265f7f41bde838eca510225e8f5821` with owner `dalph:384b` and its
exact operation/token. The supervisor did not delete it: issue #390 records
that process exit and absence from the issue's visible labels do not authorize
claim release or replacement. A subsequent #384 canary therefore needs the
accepted recovery/release mechanism from #390, or an explicitly authorized
disposition that provides equivalent proof. The new evidence also shows that
an accepted provider turn can remain live while a self-matching tool loop
performs unbounded writes; provider-response liveness alone does not bound that
effect.

### Issue #390 cancellation implementation and retained-run result

On 2026-09-20, issue #390's production cancellation implementation passed its
frozen full gate and was published to hosted `master` as
`fb91ec236454034190c6ceb8bb43b55e1f193b1e`. The gate run was
`1af7dee7-f92b-48f4-bb5c-18867d3c886c`; it passed 4,269 tests with 41 skipped,
the required coverage thresholds, repeatability, formal checks, and baseline
comparison.

The supervisor then invoked the shipped command against the retained canary:

```text
dalph cancel github:dearlordylord/dalph#384 --production --config /tmp/dalph-384-review-canary.RuqT7G/production.json
```

The first invocation lacked provider authentication and failed before starting
cancellation, with exit status 78 and no Journal mutation. A second invocation
received the existing authenticated GitHub token through its process
environment. It selected the exact unfinished Run and durably appended
`RunCancellationApplied` at Journal position 349. Focused tracker observation
then occupied positions 350--353.

Cancellation stopped fail-closed with the public typed failure
`cancellation.blocked`: it could not prove `UnsettledResponsibility` had ended.
The retained executor-private record still describes the exact planned attempt
as `Running`, while the prior Journal observations at positions 17--19 record
`ExecutorWorkExecuting` followed by `ExecutorStateUnreadable`. No conclusive
execution-substrate observation proves that the executor-owned containment has
no live writer and cannot resume. The supervisor did not retry because the
accepted unavailable-proof scenario says redelivery must not weaken that proof
requirement.

Accordingly, no `CancelledAttemptImplementationAbandoned` or
`WorkflowRunTerminated` event was appended. The exact claim was not released,
the task-work position and responsibility remain retained, and the dirty
worktree, transcript, private executor state, and evidence remain preserved
under `/tmp/dalph-384-review-canary.RuqT7G`. Issue #390 therefore has a shipped
implementation but is not operationally closed. The next discriminating action
is to determine why recovery cannot read or conclusively reconcile the retained
executor containment, then rerun the same cancellation command only after that
proof path is available. A fresh #384 attempt remains blocked.

The retained evidence then exposed two narrower implementation gaps. Commit
`da59b40e0cf9f88b08024073f6c3fa844386be09` lets durable Run cancellation
select the exact suspension boundary after the earlier passive
`ExecutorStateUnreadable`; full gate
`988f4e17-852e-4dc5-a990-bbe2912c667d` passed 4,269 tests with 41 skipped.
Commit `86ca4b57b50989064207d1f7478716dcee1bed96` bounds an unanswered retained
Codex `thread/resume` request and closes its exact owned app-server; full gate
`53b3e3da-7c56-451c-8acc-db796508db35` passed 4,270 tests with 41 skipped.
Both commits were published to hosted `master`.

The first repaired invocation proved that the recovered frontier proposes
`SuspendPlannedAttemptExecutorWork` for the exact attempt. The proposal was
consumed, but the real retained Codex provider did not return before the
120-second outer bound. After the bounded-resume repair, reconciled invocations
with 100-second and 180-second outer bounds also failed to return. Each stopped
invocation left Journal position 357 as the last record: no executor command
intent, abandonment, claim release, or termination crossed the Journal
boundary. Each exact app-server PID was proved absent afterward. The rollout,
run transcript, and six dirty worktree files remained unchanged; only the
private app-server launch evidence advanced.

The remaining blocker is below cancellation selection: the real retained
provider's resume/deadline-close path does not return a typed result within 180
seconds, despite its exact app-server process being absent after the caller's
bounded stop. No further cancellation retry is authorized until that shutdown
path is characterized and made finite. Issue #390 remains open, and starting a
fresh #384 attempt remains blocked by the retained claim and responsibility.

### Issue #390 retained-run closure

On 2026-09-20, the completed implementation was verified on hosted `master`.
The final runtime change is `63b21235d`; the accompanying metadata and test
changes include `772c713cb`, `6bdc09684` (shared production Codex private-state
ownership), `162f31f5b` (scenario mapping), and `f3d36a5e3` (provider-mismatch
coverage), which is the current `HEAD` of hosted `master`. The final frozen
gate, `ae46bcad-11e8-425d-80d8-b636f4f9ac47`, passed 4,278 tests with 41
skipped, changed-production coverage 131/131, and repeatability 20/20. An
earlier passing gate, `84d06882-2adf-454f-ba76-f2bbd91d108d`, qualified the
runtime used for the authenticated production retry below; that retry exposed
the live retained-state anomaly repaired afterward.

Using the original retained `CODEX_HOME`, the authenticated cancellation
completed in 4.4 seconds. Its Journal suffix recorded Suspend intent at
position 358, the safe response at 360, the safe report at 361,
`CancelledAttemptImplementationAbandoned` at 362, `TaskClaimReleaseIntended`
at 365, `TaskClaimReleased` at 369, and `WorkflowRunTerminated` with
`Cancelled` at 372; positions 363--371 contain the focused reads and
observations between those effects. The claim label was independently absent
(issue #384 has only `ready-for-agent`), no retained Codex process remained,
and the retained worktree content digest stayed
`892e0cde24ec23d4595b6bab4265b4facde5377a3a40f555644193b096af0654`.

An exact cancellation redelivery completed in 1.5 seconds, returned
`Cancelled`, and left the Journal at position 372, proving settled idempotent
redelivery. The private append log briefly recorded `SafelySuspended`, then
stale provider cleanup wrote `Running` with `serverLaunch` null; the terminal
Journal remained authoritative. The cause was independent private-state store
instances, fixed by `6bdc09684`; its regression coverage proves that future
runs persist `SafelySuspended` with a cleared launch record.

Three review cycles reached the configured maximum and were autoaccepted with
these residual notes: the restart test originally proved only store round-trip
rather than exact cross-scope executor reconstruction (the later shared-store
regression materially strengthens production restart/close coverage but does
not resolve that exact unresolved-stop reconstruction); an older contradiction
followed by a later transient can still be erased by the latest-only
authority predicate; and a bounded passive background-terminal census
`ResponseDeadline` is not covered by the special stop-intent catch, which
covers the retained resume path only.

Issue #390's retained-run closure is complete. Issue #384 remains open; its
candidate is unmodified and unpublished.

## Current user-directed orchestrator method

The latest user instruction supersedes the historical self-dogfood mechanism for
the next #384 attempt. The work starts from the exact fresh worktree
`/workspace/typescript/dalph-worktrees/issue-384-fresh` at planned Base
`1f8cf021e129cb2590dcc9c4906ab44a3d806098`, with the assistant as the
user-directed orchestrator. Mechanical work is delegated to the Luna max
sub-agent; difficult implementation work is delegated to the Sol medium sub-agent; blocker analysis
is delegated to the Astra medium sub-agent. A reviewer may run at most three
rounds; after the third round, unresolved non-blocking notes are recorded and
the review is auto-accepted with those residual notes.

This execution method coordinates the accepted #384 implementation and its
issue-owned follow-ups. It is not hosted issue #388 qualification, and it does
not turn a controlled fixture or a prior local run into hosted acceptance
evidence. The #384 direct-publication scenario remains the authority for
publication order, exact proof, destination admission, bounds, waits, Exit, and
finality; #385, #386, and #387 retain their successor, grant, and resume scopes.

Every failed candidate, retained Run, worktree, journal, provider transcript,
and raw evidence remains preserved at its existing locator. The orchestrator
must use a fresh exact Base/worktree and may inspect those candidates as
historical evidence, but it must not overwrite, resume, publish, or silently
repair them. This section records the execution method and boundaries only;
the current documentation prerequisite makes no claim that the #384 runtime,
models, focused tests, full gate, or disposable S1 dogfood have passed.

### Development checkpoint, 2026-09-20 23:36 UTC

The fresh worktree has committed the governing premises, Git boundary
characterization, destination types, integration/finality models, and formal
profile obligations. Runtime work remains unqualified. No hosted publication or
issue closure has occurred.

The disposable S1 public CLI run reached `RemotePublicationIntended` after
destination admission, task execution, and integration. Its remaining push,
local promotion, tracker completion, cleanup, and later dependant release are
unproven. Repeated fixture failures exposed root-task-only assumptions in the
controlled provider's graph, status, proposal, and history validators. The
changed experiment audits those shared assumptions before one complete-story
rerun. Focused controls cover empty pre-graph history, root-only and root-plus-
dependant graphs, and foreign/duplicate identities; logs are retained at
`/tmp/public-s1-guard-audit.log` and
`/tmp/public-s1-history-pregraph-audit.log`. The audit completed by its 23:35 UTC
stop time. The next public run supplies unique evidence of actual production
CLI ordering across Git, SQLite, and the controlled tracker; prefix unit tests
cannot substitute for it.

S3 still needs distinct safe-fast-forward versus competing-head observations.
S5 still needs the complete intent/effect/append restart matrix and local
catchup. S4/S6/S7/S8 still need durable retained outcomes, finite bounds,
Pause/Exit custody, and proof-versus-finality permission tests. Passing model,
registry, adapter, or cassette tests does not close these missing seams.

The earlier MBT invocation timed out without proving the requested two suites.
The next experiment invokes Vitest with the two explicit paths directly and
checks suite selection before interpreting failures. Its timeout is not a
conformance pass. The later recorded process group was proved absent; the
earliest handle lacked its original process identity and remains unproven
qualification evidence. Full qualification and scoped review have not begun.

At 23:41 UTC the one public rerun had stopped after publication intent, before
any numbered push intent. The adapter had tested only whether remote H
contained candidate M, then misclassified the ordinary H-ancestor-of-M case as
competing work. The distinguishing repair tests ancestry in both directions;
only a proven remote ancestor authorizes an ordinary push. No additional public
rerun is justified until that focused repair passes.

The exact two-path conformance invocation reached a new model action,
`observeRemotePublicationContradiction`, absent from the runtime driver. Its
90-second bound expired and its recorded process group was proved absent;
the result is a missing-conformance finding, not a pass. Runtime and driver
owners are implementing the missing supported actions. A design clarification
is pending for the source of an optional later contradiction observation;
neither finality nor restart may manufacture a mandatory post-proof remote read.
