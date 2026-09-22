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

### Development checkpoint, 2026-09-21 00:35 UTC

The publication restart test now exercises seven cuts through the production
journal and accepted reader in both memory and reopened file-backed SQLite:
pre-intent loss, committed unsent intent, applied and unapplied lost responses,
success and retained-outcome commit acknowledgement loss, and unproven prior
sender custody. The focused test passes. An unsent numbered intent consumes
its ordinal; recovery proves custody and observes Git before spending the next
ordinal. SQLite acknowledgement-loss cuts use the post-COMMIT hook. This does
not yet prove initial catch-up, promotion, or tracker-close recovery.

The sender adapter now reserves durable execution custody before the workflow
records a numbered push intent. Its real host-kill test awaits fresh built
artifacts. The real-Git adapter test for branch deletion passes: ordinary exact
push can recreate the named branch, preserves another branch, and sends no local
tag. No atomic no-recreation guarantee is claimed.

The next public S1 attempt has a focused passing repair. A/B support had placed
the full attempt identity in an executor result filename, producing a component
longer than the filesystem limit. A bounded SHA-256 digest preserves distinct
A/B files and commits. Two real-Git/projection tests pass; evidence is at
`/tmp/public-s1-executor-focused.log`. Omitted command records in a public
historical snapshot were not missing durable records: the projection deliberately
omits those internal events. The public acceptance run remains unpassed. Its
next invocation follows a clean sole-owner emit and retains a bounded diagnostic
before fixture cleanup; no additional timeout-only retry is authorized.

Initial baseline/catch-up events now pass projection and cassette checks. The
required runtime service wiring and two-store catch-up recovery tests are still
being completed. Model conformance is being reduced to one supported trace
before another broad invocation. No full gate, formal review round, hosted
publication, or issue closure has occurred.

### Development checkpoint, 2026-09-21 00:49 UTC

The baseline recovery test now passes all seven initial catch-up cuts in memory
and reopened SQLite. The real host-kill test passes against fresh built CLI
artifacts: an escaped sender survives the disposable host's SIGKILL, replacement
custody stops it before a real remote read, and exact process/group absence is
proved. The independent decoder/admission tests reject missing pins and changed
restart destinations before effects, restore conclusive admission without a
new read, and recover an intent-only admission. No extra lifecycle read is
required by these repairs.

The next public S1 invocation exited in 5.29 seconds after
`RemoteBaselineObserved`, at controlled proposal validation. The child was
proved absent. The exact proposed transition and baseline observation variant
were not retained; a guessed transition name is not sufficient repair evidence.
The next distinguishing experiment preserves those details on every early
child exit, not only on timeout, then tests the actual rejected transition.
Evidence: `/tmp/public-s1-canonical-final.log`. Integration, publication,
promotion, closure, cleanup, and dependant settlement remain unproved by that
run.

The first `check:fast` stopped at root typechecking. Its console wrapper
truncated diagnostics; a separately bounded typecheck captured the complete
output at `/tmp/issue384-typecheck-0044.log`. Package-only checks had excluded
tests. Required service and publication-premise fixture repairs are distributed
by file ownership; a complete root check remains required. No full gate or
formal review has started.

The conformance timeout was isolated to generation cost: quint-connect expanded
one requested trace to its default 10,000 samples. A 35-step seed-57 replay with
one sample passed in 9.19 seconds; normal source settings were restored.
Evidence is `/tmp/issue384-accepted-35-sample1-20260921T004446Z.log` and its
companion metadata. Directed publication routes also pass. This is bounded
conformance evidence, not a claim that all deferred or unsupported model actions
have production implementations.

S7 tests using actual control and delivery admission reproduced a separate
cutoff defect: Pause or Exit could become effective while a remote read was
held, yet the same action could start a new push when the read returned. The
runtime repair must guard that boundary. Tests separately prove that an
already-produced successful push result can be retained after cutoff without
authorizing another effect. These are acceptance repairs, not a change to the
five-second Exit drain.

### Development checkpoint, 2026-09-21 01:11 UTC

The maintainer selected the existing no-extra-read rule. #384 adds no remote
check between confirmed publication and task closure; detection of a later
remote rewrite requires a follow-up trigger. This decision is recorded in the
accepted scenario. It does not authorize closing from missing publication proof
or ignoring changed tracker permission.

All worker agents stopped on a reported usage limit. The root continues locally;
no reviewer round or full gate has run. The final S7 phase repair present in the
worktree passes the six Pause/Exit cases and twelve engine tests, including
retention of already-produced successful read results. The root typecheck
passed at `/tmp/issue384-typecheck-0105.log` after repairing test fixture types
and a diagnostic helper signature regression.

The public CLI diagnostic exposed two production composition defects. Bounded
Git commands lacked the working-repository-to-common-directory mapping used by
ordinary commands; the mapping regression test now passes. After that repair,
S1 reached an aligned baseline, fresh lineage, candidate qualification, and a
typed `PushCustodyUnproven` retained outcome. A focused shared-memo test proved
that an earlier general Git layer without sender custody could satisfy the
publication layer. Giving publication its own layer construction fixes that
test. Both regression tests pass. Evidence is retained in
`/tmp/issue384-public-mapping-0107.log` and
`/tmp/issue384-public-retained-cause-0109.log`. The next bounded public run uses
fresh artifacts containing both repairs; its outcome is not yet claimed.

### Scoped follow-up record: authored capstone chronology

**Status:** completed by the bounded repair recorded below; no external issue or
follow-up was opened. The earlier attempt's stop condition remains historical;
the completion worktree and commit below supersede its blocked cassette state.

**Owner and scope:** the #384 orchestrator owns the maintained authored cassette
and its support helpers in `packages/dalph/src/cassettes/`. The follow-up may
change that cassette, its support builder, and the focused capstone execution
test. It may not change publication order, tracker/Git authorities, the
no-extra-remote-read rule, or the production CLI to make the cassette pass.

**Starting evidence:** the candidate at merge commit `e9e1667fc8bf3f81f3f48e9ff7ac08b59733d266`
passes `check:fast`, the controlled public S1, and the production S7 cutoff
test. The capstone reaches the F phase after the structural chronology repair.
At the G boundary after terminal G, runtime selects `ReadTaskClaim(G)` while
the cassette expects `ReadTrackerGraph`. The earlier F correlation was corrected
from `464/465/473` to `536/537/543`; the G tuple was not accepted as evidence
because the preceding operation order is still wrong.

**Next experiment:** construct one structural G-phase transcript from the
runtime's observed order (`terminal G -> claim G -> graph G -> integration`),
derive its correlation positions from that transcript, and run the focused
capstone execution test once in a fresh exact-Base worktree. Do not repair
successive absolute positions after a new mismatch; a second mismatch records a
new obstruction and stops the attempt.

**Acceptance and stop condition:** the focused capstone test must pass, the
support file must remain under the repository's 420-line limit, and the
maintained catalog/Lab entry must still render the same accepted story. If that
single structural experiment fails, preserve its log and open a narrower
follow-up or report the capstone blocked again; do not run baseline/full gates
or hosted dogfood against an unproven cassette.

### Scoped follow-up result, 2026-09-21 04:16 UTC

The fresh structural experiment changed only G's authored phase flag so its
transcript followed the observed order `terminal -> claim -> graph ->
integration`; no absolute correlation position was moved. The focused command
was run once from the fresh worktree with a 60-second wall-clock bound. It
reached the capstone, then failed after 4.09 seconds with
`IntegratorCandidateCleanupEvidenceReadFailure` while rereading provider-private
cleanup evidence at `packages/orchestrator/src/workflow/protocols/disposition-cleanup/loop.ts:498`.
The result is recorded in `/tmp/issue384-capstone-structural-g-001.log`.

This is a later cleanup-evidence obstruction, distinct from the former G
chronology mismatch. Per the stop condition, no further position repair, full
gate, or hosted dogfood is authorized from this follow-up; the capstone remains
blocked pending a separately scoped repair.

### Scoped follow-up completion, 2026-09-21 04:56 UTC / 00:56 EDT

A new completion worktree was created from Base `c64c3b899ca59eba8043d86a57ef93d23ef190c3` and used a fresh bounded repair method. The repair traced the cleanup activation boundary instead of moving absolute positions blindly. It supplied the provider-owned evidence and typed absent observations for candidate sessions A–G, then recorded the ordinary reactivation transcript after F cleanup: a second `ReadTaskClaim(G)`, a second G5 graph read, and G integration with the observed correlation tuple `queuedAt=582`, `startedAt=583`, `targetLineageObservedAt=602`. The support helper and replay comparison now derive from those facts. No production source or publication/no-extra-read rule changed.

The repair is committed as `2bd92dd43` (`test: repair maintained capstone cleanup chronology`). The complete maintained capstone file passes all three tests, including fresh replay and predecessor cleanup assertions. The focused direct-publication S1 test passes after building the required package artifacts, and the production S7 Pause/Exit test passes.

The first `check:fast` attempt reached typecheck and reported unrelated Base errors in `packages/dalph/test-support/*` and checkpoint fixtures. The separate changed-file lint pass also reports pre-existing clone-wide errors in `codex-integrator-cleanup.ts`; no repaired cassette file is named as an error. The required baseline/full-gate and hosted dogfood evidence remain outstanding and must run only after the current candidate is frozen and the documented gate admission rules are satisfied.

### Frozen candidate gate and review result, 2026-09-21 05:06 UTC

The frozen candidate is Base `c64c3b899ca59eba8043d86a57ef93d23ef190c3` through
HEAD `8735157f9` before the final review repair. Baseline run
`f209bc80-6a67-469d-9700-292f1d0c0fb2` closed with custody stopped and
qualification `UNPROVEN`: clone-wide lint reported three unused direct-publication
exports, and Reducer Lab reported two stale four-argument call sites. The
unused exports were removed in the follow-up repair; the Lab and other baseline
failures remain repository-wide work.

The final review commits are `a6b23eda7` and `fa80e1a0e`; they were made after
that frozen run, so no fresh full-gate qualification is claimed for the final
HEAD.

Full gate run `35d8cfba-9668-41f2-8719-a08279029432` ran from
`2026-09-21T04:58:47Z` through `2026-09-21T05:05:00Z`, then closed with custody
`stopped` and qualification `UNPROVEN`. Build, package boundaries, artifact
resolution, duplication, secret scan, and several control stages passed. The
candidate still has typecheck errors in existing test-support/checkpoint
declarations, formal-input mismatch, cyclomatic-suppression drift, the known
Reducer Lab errors, and timed-out gate-control/capability stages. No writer
remained after closure; the durable gate record is retained as evidence rather
than treated as a qualification.

The first scoped review round ran against the same Base. Standards findings
closed here are the invalid S3/S6 scenario test names, the stale capstone status,
and the three unused internal exports. The remaining acceptance evidence is the
fresh supervised disposable S1 journey after the #390 retained-run closure. The spec review
also found that a retained publication could be offered as a fresh frontier
action; `qualifiedIntegratorProgressTransitionsFor` now stops that action and a
controlled frontier assertion covers the retained boundary. At that frozen
point, the journal intent still did not carry the separately encoded refspec
required by D28b; the current candidate closes that gap as recorded below. The
accepted no-extra-remote-read rule is unchanged.

### Current candidate repair and bounded verification, 2026-09-21 05:40 UTC

The D28b evidence gap is now closed in commit `4abc4f52c` (`fix: persist exact direct publication refspec`). The numbered `RemotePublicationAttemptIntendedEvent` carries a branded refspec derived from the exact qualified candidate and pinned branch; state reconstruction, codec, restart, and Git request boundaries validate and consume that same value. The repair changed no remote read after successful publication and added no CLI operation. Focused validation reported 31 direct Git/publication tests, 51 codec/restart/finality tests, and 27 hermetic-qualification tests passing; both affected package builds and package typechecks passed.

The Reducer Lab fixture refresh is committed as `072c1a5d4` (`test: refresh reducer lab remote-target fixtures`). Its typecheck passes. The bounded `pnpm check:lab` run stopped at the recorded 90-second wall bound after smoke reached the maintained catalog and failed on the authored `deliveryInvariantStory` interaction mismatch; the preserved log is `/tmp/check-lab-issue384.log`. No full gate was started from that red fixture run, and lingering child processes were stopped at the wall boundary.

The current candidate's focused final check passed: the maintained 22-beat capstone execution and the direct-publication S1 order test both passed in `/tmp/issue384-focused-final.log`. The repository-wide full gate remains `UNPROVEN`, and the fresh supervised disposable hosted S1 remains unrun after the #390 retained-run closure. The no-extra-remote-read decision remains in force.

### Final bounded local verification, 2026-09-21 06:02 UTC

The authored chronology repair is complete in `3477139d1` (`test: align reducer lab chronology fixtures`). It corrected the maintained double-diamond queued positions and the Reducer Lab continuation assertion without changing production workflow behavior. The complete `pnpm check:lab` then passed in `/tmp/issue384-check-lab-session.log`: all 94 maintained cassettes passed, followed by the Vite build. The earlier 90-second run remains historical evidence of the time bound and is superseded by this completed run.

The test-support declaration repair is committed in `7fae5664c` (`fix: name qualification fixture effect boundaries`). `pnpm check:fast` passed after the repair, and the focused capstone/publication command passed again in `/tmp/issue384-focused-final-2.log`. These changes only name existing Effect boundaries and fixture result types; they do not add a remote read, a CLI operation, or a new workflow authority. The repository-wide full gate remains `UNPROVEN`, and the fresh supervised disposable hosted S1 remains unrun.

The admitted preflight `pnpm check:preflight --candidate=c64c3b899ca59eba8043d86a57ef93d23ef190c3` ran as `1d3ccb94-b627-4da4-bfbb-7afd8f58d88c` and closed with custody stopped and source unchanged. Its durable report is `.scratch/quality-gates/1d3ccb94-b627-4da4-bfbb-7afd8f58d88c`; the terminal command was `exit:1` before formal or application qualification. The remaining repository-control failures are recorded in that report: cyclomatic suppressions are out of sync, the checked-in hosted formal-input manifest is stale, three Git composition Layers are unregistered (`fileGitSenderCustodyLayer`, `nodeGitDirectPublicationLayer`, and `nodeGitRemoteBaselineLayer`), and one fresh workspace-state validation stage failed without retained diagnostic output. These are separate repository-gate repairs; no further runtime or no-extra-read change is justified by this preflight result.

### Post-merge preflight repair, 2026-09-21 06:17–06:22 UTC

The completion worktree merged `origin/master` at `e92a8edcfba6986eadec4d9f7b835ac49ee88644` before the next admitted check. The hosted formal-input manifest was regenerated in `94e13b888`, and the three production Git support layers were registered in `2c86ef418`; the scenario and postmortem status now identify #390's retained-run closure and the still-required fresh supervised S1. The focused formal-input control passes, capability registration passes all 58 tests, and the pnpm workspace-state control passes all three cases.

The follow-up preflight `pnpm check:preflight --candidate=e92a8edcfba6986eadec4d9f7b835ac49ee88644` ran as `5b7df06c-1b3a-4cb3-8b51-e622f1448c32` from `2026-09-21T06:17:46Z` through `2026-09-21T06:22:49Z`. Its custody is stopped, its source input is unchanged, and its only failed stage is cyclomatic suppression drift; formal controls, workspace-state validation, capability registration, builds, Reducer Lab, duplication, secret, and all other preflight stages passed. The repository-wide full gate remains unproven until that registry is repaired, and the fresh supervised disposable S1 remains unrun. The no-extra-remote-read decision remains in force.

The repaired registry is `da262ca85` (`fix: align complexity suppression registry`). A second admitted preflight with the same candidate base ran as `75c70826-4782-4028-b30e-9958c448ae57` from `2026-09-21T06:27:42Z` through `2026-09-21T06:32:26Z`; it passed with zero failed stages, closed custody, unchanged source input, and qualification `passed`. The implementation still has no post-publication remote read or new CLI operation. The required full gate and fresh supervised hosted S1 remain separate acceptance steps.

### Full-gate formal failure, 2026-09-21 06:33–06:47 UTC

The frozen local full gate `pnpm check:all --candidate=e92a8edcfba6986eadec4d9f7b835ac49ee88644` ran as `1fbb31ac-0154-4e79-aa9f-e6ed3164f3fa`. Preflight passed and formal execution started. The identified profile stopped at accepted-result integration sampled model with `QNT404`: the obligation registry requested `publicationRetryReadyReached`, but the current model no longer defines that phase or witness after commit `7c6c1d7a2`, which deliberately transitions publication retry through `PublicationReconciliation`. The retained child log is `.scratch/quality-gates/1fbb31ac-0154-4e79-aa9f-e6ed3164f3fa/logs/3b4bd516-ec47-41ca-815a-48163abba4f8.log`; the complete profile log is `7c62450b-799f-4134-8cf6-6ec8c16d266b.log`. Custody stopped and the gate exited with `UNPROVEN`; no runtime or no-extra-read behavior was changed in response.

### Formal repair and fresh preflight, 2026-09-21 06:56–07:02 UTC

The stale accepted-result witness and its pinned contract hash were aligned in
`daa8afde0` (`fix: align accepted-result formal obligations`). The resulting
sample then exposed a real model invariant counterexample: target reacquisition
could set `targetHeld` while the phase remained `PublicationResponseLost`, even
though that phase is the boundary that must first reconcile the lost response.
The model now excludes that phase from `targetReacquisitionPhase` in
`f62e8c826` (`fix: restrict target reacquisition phases`). The exact seed-270
sample explored 10,000/10,000 traces successfully; formal controls passed
133/133.

The fresh admitted preflight with the same candidate base
`e92a8edcfba6986eadec4d9f7b835ac49ee88644` ran as
`cb6d0ce4-b9e5-4fbd-8ccd-dbb113468a6f` from `2026-09-21T06:56:37Z` through
`2026-09-21T07:01:46Z`. It closed with custody stopped, unchanged source
input, qualification `passed`, and zero failed stages. The required fresh full
gate and the supervised disposable hosted S1 remain outstanding. The
no-extra-remote-read rule and runtime implementation are unchanged.

### Second full-gate formal finding and repair, 2026-09-21 07:03–07:16 UTC

A fresh local full gate ran as `20dd9742-c51e-4a93-8375-433fbff6df95` against
candidate `e92a8edcfba6986eadec4d9f7b835ac49ee88644`. Preflight and the earlier
formal profiles passed, including the accepted-result sampled model. The
integration-finality sampled model then found seed `0x2b45d`: after a claim was
derived and made current, the allowed later contradiction set
`publicationContradictionObserved`, which made
`completionClaimRequiresRemotePublicationProof` fail solely because that
invariant also required the flag to remain false. The accepted chronology
explicitly permits that later evidence and requires it to block unsent finality
rather than erase the historical proof or claim. The retained failure log is
`.scratch/quality-gates/20dd9742-c51e-4a93-8375-433fbff6df95/logs/07762ead-15b4-4c98-98e3-ed296851bbcf.log`; custody stopped and the gate remained `UNPROVEN`.

Commit `4219088d4` (`fix: retain publication proof after contradiction`) removes
only that overstrict invariant conjunct. The separate
`publicationContradictionBlocksUnsentFinality` invariant continues to forbid
completion intent, evidence, or requests after the contradiction. Seed `0x2b45d`
now passes 10,000/10,000 traces; integration-finality deterministic and
negative tests pass 30/30 and 23/23, and formal controls pass 133/133. The
workspace-state child log in the failed full-gate record is empty and belongs
to an expected negative nested resume-control fixture; the parent control stage
passed. No runtime or no-extra-remote-read behavior changed.

### Full-gate exhaustive timeout, 2026-09-21 07:44–08:19 UTC

A fresh full gate `bcf5c847-c176-45b8-a049-b89638b96290` reran preflight and
all earlier formal families successfully. The repaired integration-finality
sampled model passed, including seed `0x2b45d`; the exhaustive TLC stage then
ran CPU-active until the formal profile deadline at `2026-09-21T08:18:50Z`
without reporting a violation or completing. Its durable stage is
`.scratch/quality-gates/bcf5c847-c176-45b8-a049-b89638b96290/logs/17914da1-d48c-4b6d-b92d-86ae69c3ad8e.log`.
The owned Apalache server and TLC process groups were proven absent; custody is
stopped and qualification is `UNPROVEN`.

This is a formal qualification timeout, not a new invariant counterexample.
The local implementation and no-extra-remote-read rule are unchanged. The
fresh supervised disposable hosted S1 remains unrun, and this candidate must
not be called fully qualified until the exhaustive formal stage completes in a
separately bounded performance follow-up.

### Completion candidate gate and chronology repair, 2026-09-21 15:06–15:17 UTC

The completion worktree repaired the maintained S1 assertion so its completed
tracker graph is selected only after `IntegrationFinalitySettled`; the previous
test selected an earlier completed graph under parallel coverage load. The
repair is `9afc7f83c` (`test: assert later completion graph chronology`). It
changes only the controlled chronology assertion and does not change runtime
behavior or add a remote read.

The fresh admitted full gate
`pnpm check:all --candidate=e92a8edcfba6986eadec4d9f7b835ac49ee88644` ran as
`794f5e35-0255-4880-b313-4a0892698a87`. It completed with custody stopped,
source input unchanged, qualification `passed`, and 396 obligations complete.
Preflight, formal reuse, 20/20 repeatability iterations, and the full
application/coverage batch passed: 408 test files passed (4 skipped), 4,412
tests passed (41 skipped), and changed production and maintained-evaluation
coverage were both 100%. The fresh supervised disposable hosted S1 remains a
separate required acceptance step.

### User-authorized fresh S1 attempts, 2026-09-21 20:04–20:23 UTC

The supervisor used the logged-in GitHub account and an isolated Codex home as
requested. Each target was a new private disposable GitHub repository with one
open issue, a separate local clone, a pinned Base, disjoint Dalph state paths,
and a credential-free HTTPS publication target. The candidate source was
`3820a62a3a2233a21030d7314cbbc297a0aaeab6`; the run-specific task Base and
candidate commit facts are retained below.

The first target was
`dearlordylord/dalph-issue-384-s1-20260921#1` with task Base
`b024aafbb9feb63d147c6ee528041991bae98fc6`. The workspace-pinned Codex CLI
(`0.149.0`) ran with isolated `gpt-5.6-luna` and `max` reasoning. Run
`r1.eyJmcmVzaG5lc3MiOiIwMWEwYzU5My1mMmE1LTc4NjktYmU5Ni02ZTliNDEyZWJmY2EiLCJ0YXJnZXQiOnsiX3RhZyI6IkdpdGh1Yklzc3VlIiwiaXNzdWVOdW1iZXIiOjEsIm93bmVyIjoiZGVhcmxvcmR5bG9yZCIsInJlcG9zaXRvcnkiOiJkYWxwaC1pc3N1ZS0zODQtczEtMjAyNjA5MjEifX0` selected the issue and acquired the task. Codex created and committed
`WALKTHROUGH.md` as `55122aba4ed71fde38107912bba4868c16e56a52`, returning the
required correlation JSON. Dalph then kept the executor responsibility in
`Running`; no integrated commit M was produced. The first invocation ended
with `ApplicationExitDisposition: Failed` and
`lifecycle.exit_failed`. An identical next invocation selected the same Run as
`Recovered` and reached the same nonterminal executor state before the
supervisor stopped it. The raw captures and private state remain under
`/tmp/dalph-384-s1-KOhLLM`.

Independent checks after both stops showed the GitHub issue still `OPEN`, no
labels, and the remote `refs/heads/main` still at the Base SHA. Therefore there
was no remote acknowledgement, no published M, no local promotion, and no task
closure to claim. The observed failure is a real app-server lifecycle handoff
after a valid Codex completion, not evidence for adding a post-publication
remote read.

To distinguish the provider version, a second fresh target
`dearlordylord/dalph-issue-384-s1-codex155-20260921#1` used the logged-in global
Codex CLI `0.155.1`, again isolated to Luna/max. Its task Base was
`7dbddfda286c351b42d17f5c896b7ba94cef9812`; Run
`r1.eyJmcmVzaG5lc3MiOiIwMWEwYzVhMC01ODEzLTdhZmYtYmViYy1kZDIxYmM4NjRjNWUiLCJ0YXJnZXQiOnsiX3RhZyI6IkdpdGh1Yklzc3VlIiwiaXNzdWVOdW1iZXIiOjEsIm93bmVyIjoiZGVhcmxvcmR5bG9yZCIsInJlcG9zaXRvcnkiOiJkYWxwaC1pc3N1ZS0zODQtczEtY29kZXgxNTUtMjAyNjA5MjEifX0` was allocated, but the model emitted only its initial plan and made no tool call or worktree change. The supervisor stopped it with a successful graceful Exit; its issue and remote remained unchanged. Its evidence is under `/tmp/dalph-384-s1-codex155-wOX97u`.

These are preserved qualification failures, not acceptance evidence. The next
scoped action is a provider-lifecycle follow-up that proves the pinned
app-server completion handoff (or repairs that boundary) with a fresh bounded
run. Do not close either disposable issue, delete either repository, or claim
S1 acceptance until a run records M, independent remote-head acknowledgement,
local promotion, tracker closure, and exact cleanup.

### Exact-head full gate passed, 2026-09-21 21:27–21:59 UTC

The exact candidate `a29737d9b00612d407d6b7eb5c7de10fdb2bb29a` passed the
admitted `pnpm check:all --candidate=309a94e87ab7898e45cc81cc5240e64ae5b4092a`
run `24e9c9ee-1302-4b57-a1dd-0b533332148d`. The Base is
`309a94e87ab7898e45cc81cc5240e64ae5b4092a`; registration closed, custody
stopped, the source input was unchanged, and qualification passed with 506
obligations. The run passed 408 test files (4 skipped) and 4,414 tests (41
skipped). Overall coverage was 96.41% statements, 94.81% branches, 95.19%
functions, and 97.06% lines; changed production and maintained-evaluation
coverage were both 100%. The 20/20 repeatability checks produced digest
`6df6b575...`.

This records the frozen full gate as proven for the exact candidate. It does
not change the S1 result: the fresh supervised disposable journey remains the
sole unproven acceptance boundary. The no-extra-remote-read decision remains
in force, and the two preserved S1 attempts remain open evidence rather than
grounds for closing Issue #384.

### Provider lifecycle attach/Begin repair, 2026-09-21 22:13–22:15 UTC

The first supervised S1 failure left the Codex executor responsibility in
`Running` after Codex had returned its completed turn. Inspection of the
initial handoff found an attach/Begin race: a passive lifecycle attachment
could run its initial projection while the same attempt's `Begin` command was
still in flight. That projection could therefore settle before the durable
Begin path had established the current executor record.

Commit `eee7243f0034b3587992b0da275b5b139dfe3af7`
(`fix(codex): serialize lifecycle attachment with commands`) adds a
per-attempt semaphore to the lifecycle projection and shares it with
`Begin`, `Suspend`, `Resume`, and replacement commands. The candidate contains
the repair through merge `8051f891eddeb8bb404e21647672447096a1d80c`. Its
regression test
`serializes the initial lifecycle projection with an in-flight Begin` holds
`turn/start`, starts `Begin` and `attach` concurrently, and asserts attachment
has not settled before `Begin` releases. The focused command was:

`pnpm exec vitest run packages/dalph/src/application/codex-planned-attempt-executor.test.ts -t 'serializes the initial lifecycle projection with an in-flight Begin'`

It passed with 1 test passed and 178 skipped (179 total) in 2.33 seconds.
This is a provider-local lifecycle repair; it adds no CLI operation and no
remote read after publication. The fresh supervised disposable S1 remains
pending and cannot be claimed from this regression test.

### Initial Codex census handoff repair, 2026-09-21 23:54 UTC

The rebuilt public S1 reproduced a second provider-local boundary: Codex had
completed the owned turn and committed `WALKTHROUGH.md`, but the first
passive lifecycle projection saw a durable `Running` record before
`thread/resume` exposed the owned turn. Dalph converted that initial
`CodexTurnBoundaryUnknown` into an `Unreadable` projection and detached the
observer, so the existing completion hint could not trigger the exact reread.

The candidate now keeps the initial lifecycle attachment at exact
`ExecutorWorkExecuting` only when the durable record is the same attempt's
`Running` record. The existing provider hint then performs the normal exact
reread. If Codex omits Dalph's private token marker from `thread/resume`, the
persisted observed provider turn id remains the exact reconciliation key;
later contradictory or unreadable projections retain the fail-closed behavior
and do not schedule a passive retry. The controlled regressions are `keeps the
initial lifecycle attachment through a delayed owned-turn census` and
`reconciles a passive terminal by observed turn id when the provider omits its
token`. No command, CLI, or post-publication remote read changed.

### Exact completion candidate gate and real Codex thread-token boundary, 2026-09-22 02:27–02:41 UTC

The exact candidate `b6b671e440d3611cf1f0facad06c42b2df62e370` was frozen and
admitted to full gate run `369b0ccb-3804-4866-accd-0ae3bb77f03a` against Base
`309a94e87ab7898e45cc81cc5240e64ae5b4092a`. Custody stopped and the source
input remained unchanged, but qualification was `UNPROVEN`: the maintained
Reducer Lab exceeded its 300-second bound, the complexity registry was one
entry behind the changed Codex executor, and the gate-control suites exceeded
their 60-second bounds. No formal or application qualification stage started.

The registry-only repair is `e91e4d1ab` (`chore: align complexity suppression
registry`); it records the observed count of six for
`codex-planned-attempt-executor.ts` and does not change runtime behavior. The
Lab and gate-control timeouts remain separate tooling evidence and were not
converted into runtime repairs.

A direct JSON-RPC probe against the same authenticated Codex app-server path
then checked both the workspace-pinned Codex `0.149.0` and the global Codex
`0.155.1`. Both reported `gpt-5.6-luna` with `max` reasoning, and both accepted
`thread/start` in the exact candidate cwd. Neither returned Dalph's supplied
`metadata.dalphOwnedThreadToken` in the thread summary; the real provider
therefore leaves the Integrator's exact thread-ownership token absent. The
accepted Integrator chronology requires that token for lost-response adoption,
replay, and cleanup, so this is a provider-contract incompatibility rather than
evidence for weakening the fail-closed ownership rule. The supervised public
S1 remains unproven and no new remote read or CLI operation was added.

### Fresh supervised Kimi S1 and provider quota boundary, 2026-09-22 02:54–03:10 UTC

The fresh supervised S1 used the accepted named Kimi profile
`executor:kimi/for-coding` against the private disposable repository
`dearlordylord/dalph-issue-384-s1-kimi-20260922`, issue 1, with target Base
`a4011c8a1a78c4804518ce2a646c1d85bfd2fdd4`. The candidate source was
`472da42ffdcfaa5b260e10e3ee9e901254fb7502`; the Kimi configuration requested
maximum thinking effort.

The first run was stopped after the bounded setup window because its isolated
home lacked the GitHub credential helper. The same durable run was recovered
after copying the already-authorized Git configuration; no second run was
allocated. Recovery reached the tracker claim, planned worktree, executor
responsibility, and prompt-intent stages. Kimi Code then returned the real
provider response `403 You've reached your weekly (7-day) usage limit` at
2026-09-22T03:07:23.369Z. The private executor record remained
`PromptIntentRecorded` with `sessionClosed: false`, and no executor work
report, publication, local promotion, or tracker closure was observed.

The remote main branch remained at the existing Base and issue 1 remained
open. The normal production `cancel` operation appended `RunCancellationApplied`
but returned `cancellation.blocked` because it could not prove unsettled
executor responsibility. The retained claim, task worktree, and private
executor record are therefore preserved for fail-closed reconciliation; no
private state or worktree was manually deleted. This provider quota boundary
does not change runtime behavior, the accepted no-extra-remote-read rule, or
the conclusion that the fresh supervised S1 remains unproven.

### Supervisor takeover and non-convergence diagnosis, 2026-09-22

The maintainer stopped session `01a0c0de-71fe-7c70-af02-301446c67d23`
and authorized repair of its output and completion of #384. macOS verification
is explicitly deferred; it is not an active takeover task.

The retained session spans approximately 30 hours 49 minutes through the
initial audit, with 51 compactions, at least 35 distinct full-gate commands,
49 agent spawns, and 1,482 process-output polls. These are observations of
workflow churn, not proof that every invocation performed a complete gate.
The session used Astra/medium, then Sol/medium, then Luna/xhigh; supervised
Codex task execution separately used Luna/max. Attribution to Luna alone is
therefore not established.

Two late tool-call messages provide direct non-convergence evidence. The
04:03:16Z message contains 2,909 repetitions of a gate-status command in a
276,334-character input; the 04:41:44Z message repeats it 2,908 times in
276,274 characters. Both use a malformed hybrid run identifier and fail to
execute as intended. The sequence outlasted the recorded 03:32Z stop time.
A stronger model may reduce this risk, but this trace does not distinguish
model capability from long-context and harness interaction. Documentation
alone did not enforce the stop rule.

Independent product defects were reproduced rather than attributed to model
quality: the provider adapter assumed unsupported thread ownership metadata
and a turn-list RPC absent from the pinned Codex release; cleanup ran before
delivery but did not interleave after finality created new cleanup obligations;
and a conclusive non-fast-forward rejection consumed an attempt without its
own durable result record. The takeover repairs these boundaries while
preserving exact thread ownership, cleanup proof, consumed push allowances,
and the prohibition on an extra remote read after successful publication.

The provider protocol tests now cover the supported source marker, loaded and
persisted thread census, exact empty-thread response, legacy turn history,
and paginated full-item hydration. A real pinned app-server protocol fixture
also checks ownership without calling a live model. Direct-publication state,
protocol, recovery and historical projection tests passed together (64 tests),
including crash-after-rejection recovery in both stores. Cleanup tests cover
draining an existing owner while cutting off new admissions. A later complete
tracker graph is required by the new delivery phase's baseline, not by erasing
the journal's current graph; two distinguishing authored scenarios passed.

The gate launcher now propagates and persists one absolute deadline across
worktree-lock waiting, clone-slot waiting and nested commands. A child cannot
extend its parent's deadline. Expiry stops work and requires stopped-writer
proof; absent proof retains the custody fence. This is qualification tooling,
not an automatic deadline for accepted Dalph task execution. It does not
prevent an external coding agent from generating an enormous tool call or
starting indefinitely many new runs; enforcing a parent-session budget needs
the owning agent harness, outside this repository's gate boundary.

At this checkpoint, typechecking passes and the scoped review reports no
blocker in the new rejection record or per-phase cleanup baseline. One broad
focused-test batch hit its enforced 120-second bound before producing a
complete failure report; its build and public-S1 suffix did not start. The
next discriminating checks separate the suites and retain verbose output.
No takeover full gate, fresh live-provider S1, PR merge, or #384 closure is
claimed from this checkpoint.

At 06:08Z the isolated build passed, followed by all five public
direct-publication fixture tests. The complete controlled S1 took 13.2 seconds
and proved publication, promotion, completion, cleanup, and the later graph
before dependant release. All eight Run-composition tests also passed. These
checks do not substitute for the fresh Luna/max live-provider journey or the
frozen full gate. The prior broader test timeout occurred under shared-host
load about 35 on 12 CPUs; its isolated verbose failure was the test's
10-second timeout. The timed-out build's exact process group was subsequently
proved absent before rebuilding. Two completed audit searches were separately
found still running; their exact owned children were stopped and their parent
shells verified absent. Read-only delegated work also needs enforced process
bounds and explicit handle settlement.

The deadline repair's final review found that formal progress advertised the
enclosing gate deadline even when a child had a shorter timeout. The runner
now freezes one remaining timeout after registration and uses it for both the
progress deadline and the termination timer. Its deterministic regression
passes. The complete custody suite passes 54/54. That suite also exposed a
pre-existing spawn race: a child could reach its retained-log path before the
parent created the file. Retained-log creation now occurs after durable intent
but before spawn; append-failure and custody evidence regressions pass.

The provider suites pass 251 tests (16 opt-in tests skipped), the publication
state/protocol/recovery/projection suites pass 64 tests, and the actual pinned
Codex 0.149.0 app-server passes all 15 real-process tests against a local fake
Responses endpoint. This exercises real JSON-RPC, persistence, ownership,
restart, interruption, process-death cuts and cleanup without a live model
request. `pnpm check:fast` passes. These results qualify the focused repairs;
they still do not replace the frozen full gate or fresh Luna/max S1.

Baseline run `4af25434-af77-4988-a467-9b07d9734ff1` against candidate
`600f1ac9d2a0cd936e8aa8c13fdb0882b231ee4c` ended with stopped custody and
unchanged source. Its clone-wide census found four missing explicit `void`
markers in the new Node tests. Its independent Reducer Lab stage passed eight
named tests but exceeded the existing 300-second stage bound. The lint finding
is repaired directly. The Lab timeout is retained as separate fixture evidence
and is not converted into a successful baseline or current-candidate gate.
