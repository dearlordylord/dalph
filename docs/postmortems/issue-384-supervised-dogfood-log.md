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

## Run still in progress

The retained task candidate is under supervisor repair after scoped review.
This log must still be extended with the repaired commit, focused/model/gate
results, Dalph restart and Integrator behavior, remote publication result,
tracker reconciliation, and any additional stalls before the dogfood exercise
is considered closed.
