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

The corrected attempt is implementing #384 in its isolated task worktree. This
log must be extended with the final task commit, focused/model/gate results,
Integrator and local-promotion behavior, manual remote publication result,
tracker reconciliation, and any additional stalls before the dogfood exercise
is considered closed.
