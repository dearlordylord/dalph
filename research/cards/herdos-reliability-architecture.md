# HerdOS reliability architecture

## 1. Scope, pin, and evidence boundary

This card audits HerdOS at commit
[`afb8e527fee2f9081963310bad1645bdc2806d68`](https://github.com/herd-os/herd/tree/afb8e527fee2f9081963310bad1645bdc2806d68).
The evidence boundary is that commit's Go source, tests, GitHub Actions
workflows, and repository documentation. The audit assumes one coordinator for
one repository, as requested; it therefore treats unprotected active-active
coordination as a residual deployment risk, not as a failure of the intended
operating model.

No destructive crash experiment was run. Claims about killed processes,
ambiguous responses, and delayed restarts are deductions from reachable error
paths and persisted state. HerdOS itself records a pre-v1 concurrency audit as
open work, including duplicate workers, reviews, fix issues, and conflicting
pushes, so this card does not treat that document as proof that those cases have
already been eliminated
([audit](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/specs/v1-release-09-concurrency-model-audit.md#L1-L28)).

## 2. Plain-language architecture

HerdOS turns a GitHub milestone into a batch of issues. Issue body front matter
contains dependencies, issue labels express lifecycle, and the milestone groups
the batch. A dispatcher finds ready issues, changes their labels to
`herd/in-progress`, and starts a `herd-worker.yml` workflow with the issue
number, batch branch, timeout, and runner label
([dispatch](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L101-L250),
[worker workflow](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L1-L56)).

Each worker uses a deterministic `herd/worker/<issue>-<slug>` branch. It invokes
a coding-agent CLI in an Actions checkout, validates the result, force-pushes
the worker branch with lease protection, posts a report, and changes the issue
to done. The prompt asks the agent to commit and push after logical units and
to maintain `.herd/progress/<issue>.md`
([worker lifecycle](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L149-L333),
[incremental-progress prompt](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L116-L130),
[final push](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L497-L513)).

When a worker workflow finishes, the integrator finds every done issue that
still has a worker branch, merges those branches into the milestone's batch
branch in issue-number order, advances dependency tiers, opens or updates a
batch pull request, performs agent review, and checks CI
([consolidation scan](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L106-L238),
[workflow sequence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L25-L53)).
The scheduled monitor looks for abandoned, failed, stale-ready, or stuck work
and triggers retries or alerts
([patrol](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L180),
[schedule](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-monitor.yml#L1-L27)).

The control plane is therefore a set of short-lived commands and Actions jobs
that repeatedly read GitHub and Git. There is no separate task database or
workflow journal in the platform abstraction: it is composed of issue, pull
request, workflow, label, milestone, runner, repository, and check services
([platform interface](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L105)).

## 3. State-owner table

| State | Owner and representation | Reliability consequence |
|---|---|---|
| Task identity and requirements | GitHub issue number, title, body, acceptance text, and dependency front matter ([issue type](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/types.go#L5-L15), [dependency reads](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L645-L670)) | A new coordinator can rediscover the task without local state. |
| Task lifecycle and soft claims | GitHub labels such as ready, in-progress, failed, done, retry-pending, and CI-fix-pending ([label definitions](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/issues/labels.go#L1-L48)) | Labels are durable and visible, but separate remove/add/dispatch calls are not one atomic state transition. |
| Batch identity and grouping | GitHub milestone plus deterministic `herd/batch/<number>-<slug>` branch ([batch derivation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L174-L185)) | The batch can be reconstructed, but the branch head may move between attempts. |
| Attempt observation | GitHub Actions run ID, status, conclusion, inputs, head branch, and head SHA ([run type](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/types.go#L48-L60)) | A retry is a new run; there is no single durable attempt record joining all effects. |
| Partial implementation | Commits pushed to the deterministic remote worker branch, including the progress file and validation artifacts ([resume path](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L187-L250)) | Only pushed Git objects survive a fresh checkout reliably. |
| Human-visible progress | Issue comments periodically copied from the local progress file ([poster](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L832-L889)) | Comments aid diagnosis but are mirrors, not executable checkpoints. |
| Accepted batch result | Batch branch, batch PR, reviews, and checks ([PR type](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/types.go#L17-L32), [review workflow](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L122-L155)) | GitHub and Git remain authoritative for integration. |
| Review exclusion | Append-only JSON lock records in commits on a dedicated review-lock branch ([lock state](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L16-L52)) | This is the clearest durable claim with an actual compare-and-swap fence, but it protects review rather than all workflow effects. |
| Agent process/session | Provider CLI process and its stdout/stderr inside the current job ([agent interface](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/agent.go#L5-L18), [Codex ephemeral invocation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/codex.go#L95-L106)) | Process identity and provider conversation are not a durable HerdOS checkpoint. |

## 4. Scheduling and capacity

Dependencies are arranged into tiers. `Advance` waits until the current tier's
issues are closed or done, dispatches remaining work in that tier, and advances
only after the tier completes
([advance](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L355-L481),
[tier construction](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L645-L670)).

Capacity is a read-then-act calculation. The CLI batch dispatcher subtracts
the number of `in_progress` workflow runs from `workers.max_concurrent`; its
run query is not scoped to the worker workflow and it does not count queued
runs
([CLI capacity](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L101-L179),
[active count](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L277-L285)).
The integrator's advance path is stronger: it counts queued and in-progress
`herd-worker.yml` runs and correlates their `issue_number` inputs before
dispatching
([advance admission](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L484-L579)).
The patrol's stale-ready path again counts only in-progress runs
([patrol capacity](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L254-L339)).

Admission changes labels and dispatches the workflow in separate calls. If
dispatch fails, the code tries to restore a failed label; if the request
actually succeeded but its response was lost, the issue can be marked failed
while a worker is already queued. Later run-input correlation can repair some
of that ambiguity, but there is no atomic per-issue claim or dispatch
idempotency key
([dispatch sequence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L200-L250),
[correlation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L526-L579)).
The worker workflow has no Actions `concurrency` group, while integrator event
paths use several operation-specific groups
([worker workflow](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L1-L56),
[integrator groups](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L25-L30)).
Under the one-coordinator assumption, the practical risk is primarily retries,
overlapping GitHub events, and delayed visibility rather than two intended
long-lived leaders.

## 5. Restoration layers

### Control-plane task and run

Issue identity, body, milestone, labels, comments, and workflow-run history
survive a coordinator restart in GitHub. Patrol reconstructs abandoned work by
comparing in-progress issues with active runs, moves an orphaned issue to
failed, and counts completed failed runs to choose retry, backoff, or escalation
([orphan repair and retry](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L147),
[failure count](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L394-L418)).
This restores the task and its observable attempts, not the exact interrupted
command continuation.

### Agent session, context, and logs

`ExecOptions` contains repository root, system prompt, and maximum turns, but
no session identifier or resume token
([options](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/agent.go#L35-L55)).
The Codex adapter explicitly adds `--ephemeral`; worker retry calls
`Agent.Execute` again with a newly rendered prompt
([Codex arguments](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/codex.go#L95-L106),
[worker invocation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L268-L315)).
Therefore “resume” means a fresh agent reads the pushed branch, progress file,
issue, and possibly saved validation errors. HerdOS does not restore the same
Codex/Claude session, its hidden context, or a provider-side transcript.
Actions retains the workflow log according to GitHub policy, but the audited
code does not import an old log into the next agent context.

### Git worktree state

Committed and pushed commits survive. A handled agent timeout checks for dirty
state, stages `.` into a checkpoint commit, and pushes it; already committed
work is pushed directly
([timeout checkpoint](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L566-L618)).
That preserves file contents visible to `git add .`, but deliberately collapses
the previous staged-versus-unstaged distinction into one commit. Ignored files
are not added; stash entries are never exported; an in-progress conflict's
index stages are not modeled as a separate checkpoint; and an abrupt runner
loss before the timeout handler runs loses all state that was not pushed.
These negative conclusions follow from the checkpoint's `IsDirty`, `Add(".")`,
`Commit`, and push sequence and the fresh Actions checkout
([Git dirty/add operations](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/git/git.go#L136-L181),
[checkout](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L42-L56)).

### Live process, container, or VM

The durable live-process observation is a GitHub workflow run with status and
inputs, not a HerdOS-owned process lease
([run fields](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/types.go#L48-L60)).
The worker runs in a self-hosted Actions job with a timeout; the next run
checks out again and launches a new agent process
([worker job](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L31-L56)).
HerdOS can observe or cancel a run, but it does not adopt a surviving child
process, container, terminal, memory image, or exact filesystem from another
job
([workflow service](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L61-L69)).

## 6. Immediate restart

For a coordinator CLI crash while an already-dispatched Actions worker remains
alive, the worker continues independently in GitHub. A newly invoked
coordinator can see its queued/in-progress run and issue input; the strongest
advance path avoids dispatching that issue again
([active-run correlation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L526-L558)).

For a worker-job crash, GitHub eventually reports completion or absence. The
integrator handles failed/cancelled conclusions by moving the issue to failed,
and patrol handles an in-progress label with no active run
([failed conclusion](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L106-L169),
[orphan detection](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L102)).
A retry is a new Actions run and new agent invocation. It checks out the
existing remote worker branch if one exists, merges the latest batch branch,
and uses committed progress to orient the fresh agent
([worker resume](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L187-L250)).

There is no general intent-before-effect record. In particular, label changes,
workflow dispatch, comments, branch deletion, and cleanup are usually separate
calls. Immediate restart is therefore operation-specific: observe runs before
redispatch, observe branch containment before remerge, reread PR state before
review or merge, and let close events retry cleanup
([dispatch](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L200-L250),
[containment check](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L251-L269),
[merge reread](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/merge.go#L24-L60)).

## 7. Restart after a week and external drift

After a week, issues, labels, milestones, remote branches, PRs, checks, comments,
and retained Actions history remain the usable control-plane facts. Retry
count and backoff depend on retained failed workflow runs; if GitHub retention
or manual deletion removes them, the source has no independent attempt ledger
from which to reconstruct the same count
([failure counting](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L394-L418)).

When a remote worker branch survives, the retry merges the current remote batch
branch into it. That updates the work to external batch drift rather than
replaying from a stored immutable base SHA. If the merge conflicts, HerdOS
aborts, deletes the local branch, best-effort deletes the remote worker branch,
removes the progress file, and starts a fresh worker branch from the batch
branch
([drift handling](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L193-L230)).
This is an explicit restart policy, but it sacrifices the previous remote
partial branch when automatic reconciliation fails.

A complete progress checklist plus a committed validation-pass marker can skip
the coding agent on retry. Complete progress without that marker does not; saved
validation errors are injected and the new agent is warned that the checklist
is stale
([resume decision](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L241-L283)).
Nothing in that decision restores a week-old provider session, local stash,
ignored files, conflict index, or live process.

## 8. Git starting-point and integration behavior

The batch branch is created from the then-current default-branch SHA if it does
not already exist. The task attempt does not persist a separate immutable
planned base SHA; subsequent workers start from or merge the evolving batch
branch
([batch creation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L252-L275),
[worker branch setup](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L184-L238)).

Worker publication uses `git push --force-with-lease`, which protects against a
remote ref moving beyond the local lease, but the worker does not record a
separate publication intent or reread the remote immediately after every
ambiguous push failure
([Git push methods](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/git/git.go#L67-L77),
[worker publication](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L497-L513)).

Integration checks whether the worker tip is already contained in the batch,
merges locally, removes progress artifacts, and uses a normal push to the batch
branch. A concurrent batch update causes a non-fast-forward failure, leaving
the worker branch for retry and changing the issue to failed
([consolidation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L240-L352)).
The normal push is a useful Git-level compare-and-swap fence. If the push
actually succeeds but its response is lost, a later containment check can
recognize the merge while the worker branch still exists; the immediate error
path itself does not first reread the remote.

Integrator Actions serialize the main `integrate` job by a head-branch-derived
group and do not cancel an in-progress job. Other event paths have distinct
groups, so they are not one global integration mutex
([integrate group](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L25-L53),
[other groups](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L55-L227)).
Review adds a stronger application fence: it appends a lock commit and advances
the lock branch without force, retries ref-update conflicts, binds the lock to
the batch SHA, and expires it after two hours
([acquisition](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L54-L99),
[staleness](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L101-L123),
[release](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L125-L171)).

## 9. Code organization by layers and end-to-end slices

The code has recognizable technical layers:

- `internal/platform` defines GitHub-shaped service boundaries and types; the
  GitHub implementation supplies production effects
  ([interface](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L105)).
- `internal/git` wraps local Git commands and exposes checkout, merge, push,
  diff, status, commit, and cleanup operations
  ([Git wrapper](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/git/git.go#L1-L181)).
- `internal/agent` and its provider adapters invoke Claude, Codex, or OpenCode
  behind one interface
  ([agent interface](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/agent.go#L5-L32),
  [factory](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/factory/factory.go#L18-L33)).
- `worker`, `integrator`, `monitor`, `planner`, `commands`, `dag`, and `issues`
  implement workflow slices and domain helpers
  ([worker entry](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L149-L171),
  [integrator entry](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L106-L125),
  [monitor entry](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L54)).
- `.github/workflows` supplies event wiring, permissions, checkout, job timeout,
  and concurrency grouping
  ([integrator workflow](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L1-L227)).

The end-to-end worker and integrator functions are substantial vertical slices:
they interleave reads, local Git, agent execution, validation, comments,
labels, workflow dispatch, and cleanup. That makes the chronology readable in
one place, but recovery policy is distributed across defer blocks, monitor
patrol, event handlers, and retry commands rather than expressed as one
replayable workflow algebra
([worker slice](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L149-L513),
[integrator slice](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L106-L579)).

## 10. Production, test, fake, and dry-run dependency seams

Production injects a `platform.Platform` and `agent.Agent` into worker,
integrator, monitor, and planner functions, while local Git is usually
constructed directly from a repository path inside the slice
([worker signature and Git construction](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L149-L188),
[platform interface](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L31)).
This gives strong seams for GitHub and agent behavior, but a narrower seam for
local Git command faults, clocks, and process crashes.

Tests use in-memory mock platform services and mock/scripted agents extensively;
Git wrapper tests use temporary repositories
([orchestration mock agent](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/orchestration_test.go#L711-L744),
[monitor mocks](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol_test.go#L18-L74),
[Git tests](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/git/git_test.go#L1-L40)).
Provider adapters are tested with fake executable scripts, which validates
argv and output parsing without a real model
([Codex fake](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/codex_test.go#L14-L79)).

The dispatch CLI has a dry-run branch that reports prospective issue dispatches
without performing them
([dry-run dispatch](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L155-L179)).
It is not a production-shaped interpreter for the complete worker,
integration, review, retry, and cleanup workflow; those paths are exercised by
tests through mocks and temporary Git repositories.

## 11. Verification inventory

The default Make target runs `go test ./...`, and CI runs the full Go suite
with the race detector. CI also has a separately tagged GitHub-platform
integration test job
([Makefile](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/Makefile#L1-L19),
[CI](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/ci.yml#L1-L66)).
The suite covers DAG logic, issue parsing, config, Git operations, provider
adapters, worker timeout/resume/validation behavior, monitor retry behavior,
integrator consolidation/CI/review, and broad orchestration scenarios
([DAG tests](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/dag/dag_test.go#L1-L20),
[worker resume tests](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker_test.go#L1490-L1570),
[review-lock tests](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_test.go#L760-L1028),
[orchestration tests](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/orchestration_test.go#L1-L25)).

There is also an opt-in end-to-end target under `tests/e2e`, separate from the
default unit suite
([Makefile](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/Makefile#L15-L19)).
At the pinned commit, searches found no Go fuzz target, property-testing
framework, state-machine model checker, TLA+/Quint specification, or
systematic crash/fault-injection harness. The repository's concurrency-model
audit is a requirements note with open questions rather than an executable
model
([audit](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/specs/v1-release-09-concurrency-model-audit.md#L1-L28)).

## 12. Chronological failure table

| When the interruption occurs | Durable evidence left | What the next invocation does | Gap or duplicate risk |
|---|---|---|---|
| After ready is removed but before in-progress is added | Issue may temporarily have no status label ([label sequence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L220-L229)) | Later scans depend on recognized status labels. | No transaction repairs this exact half-transition automatically. |
| After in-progress is added but before dispatch | In-progress issue, no run ([dispatch](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L220-L242)) | Patrol sees no active run, comments, and changes it to failed ([patrol](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L102)). | Repair waits for patrol or manual action. |
| Dispatch accepted but response lost | A queued run may coexist with a failed label. | Advance can correlate queued/in-progress worker inputs before another dispatch ([correlation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L526-L558)). | CLI and patrol paths use weaker snapshots; duplicate workers remain possible. |
| Agent times out normally | Timeout handler may push existing commits or create one checkpoint commit ([checkpoint](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L566-L618)). | Issue becomes failed and monitor retries with the remote branch. | Exact index/worktree shape and session context are not restored. |
| Runner dies abruptly during edits | Last pushed worker commit and GitHub run record only. | New job checks out and starts a fresh agent. | Unpushed staged, unstaged, untracked, ignored, conflict, and stash state is lost. |
| Worker push succeeds but completion labels fail | Remote branch contains the result; issue may remain in-progress/failed. | Retry detects branch and may skip the agent only with complete progress plus validation marker ([skip condition](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L241-L250)). | No unified publication receipt ties push and label transition together. |
| Batch push loses a race | Worker branch remains; issue becomes failed ([push failure](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L326-L337)). | A later integrator resets from the latest batch and retries. | Conflict may require a resolver or human. |
| Batch push succeeds but response is lost | Remote batch may contain worker tip; worker branch normally still exists at that point. | Later containment check makes remerge a no-op and deletes worker branch ([containment](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L251-L269)). | Immediate error path first marks failed; visible state can be temporarily contradictory. |
| Review job dies holding lock | Lock commit includes owner, run, batch SHA, and expiry ([lock state](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L229-L244)). | Same-head review waits until expiry; a changed batch head can reclaim stale ownership ([blocking rule](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L101-L123)). | Up to two hours of delay is intentional. |
| PR merge succeeds but cleanup fails | PR is authoritatively merged; some issues/milestone/branch may remain. | PR-close workflow invokes cleanup again ([merge and cleanup](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/merge.go#L24-L96)). | Cleanup suppresses many per-item errors, so partial cleanup can be quiet. |

## 13. Maintenance risks

The highest reliability risk is split-brain workflow state across labels,
workflow runs, Git refs, PR state, comments, and checks without one durable
operation record. Each artifact is sensible, but maintainers must preserve the
ordering and compensation rules of many multi-call transitions
([dispatch sequence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L200-L250),
[cleanup](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review.go#L1291-L1351)).

Capacity and duplicate suppression are implemented differently in CLI
dispatch, integrator advance, and patrol. One counts broad in-progress runs,
one counts queued and in-progress worker runs, and one counts broad
in-progress runs while dispatching stale work
([CLI](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L277-L285),
[advance](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L484-L579),
[patrol](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L254-L339)).
Future fixes can easily land in one path but not the others.

“Resume” spans two different ideas in the source: reuse a Git branch and
progress checklist, versus resume an agent session. Only the former exists.
The conflict fallback then deletes that saved branch rather than preserving it
under a recovery ref
([resume/fallback](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L193-L230)).
That terminology and destructive fallback can surprise operators diagnosing a
week-old attempt.

The GitHub workflow file contains multiple event-specific concurrency groups,
and the repository explicitly calls a complete trigger-pair audit unfinished
([workflow groups](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L25-L227),
[audit](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/specs/v1-release-09-concurrency-model-audit.md#L1-L28)).
Even with one intended coordinator, GitHub may deliver distinct events for the
same batch, so cross-group idempotency remains important.

## 14. Ideas Dalph should consider

1. **Use authoritative GitHub/Git rereads as recovery inputs.** HerdOS shows the
   value of rebuilding from issue, run, branch, PR, and check state instead of
   trusting local coordinator memory
   ([platform surface](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L105)).
2. **Keep attempt identity separate from agent-session identity.** A remote
   branch can continue the task without pretending to continue the same model
   conversation
   ([agent options](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/agent.go#L35-L55)).
3. **Make every ambiguity-crossing effect reconcile before retry.** HerdOS's
   branch-containment check is a strong pattern; dispatch and cleanup would
   benefit from equally explicit receipts and rereads
   ([containment](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L251-L269)).
4. **Use append-only ref CAS for narrow, durable exclusion.** The review lock
   demonstrates a repository-native claim with owner, target SHA, expiry, and
   conflict retry
   ([lock acquisition](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L54-L99)).
5. **Preserve recovery evidence rather than deleting it on drift.** If an old
   attempt cannot merge, move its ref to a recovery namespace and record a
   disposition before starting over; HerdOS currently best-effort deletes it
   ([conflict fallback](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L206-L230)).
6. **Centralize admission accounting.** One implementation should count the
   intended run kind, both queued and running states, and a durable claim before
   dispatch, rather than three related snapshots.
7. **Test the four restoration layers independently.** In particular, test
   committed, staged, unstaged, untracked, ignored, conflicted, and stashed Git
   states instead of treating “dirty” as one condition
   ([current dirty/checkpoint logic](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L579-L618)).
8. **Keep production, fake, and dry-run on one workflow algebra.** HerdOS has
   useful platform/agent seams, but its dispatch dry-run does not exercise
   integration and recovery
   ([dry run](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L155-L179)).

## 15. Confirmed unknowns and negative-claim search record

Confirmed unknowns:

- GitHub Actions retention is deployment policy, so the exact week-later
  availability of run logs and failure history cannot be determined from the
  pinned repository. The code relies on listing runs and their inputs,
  conclusions, and creation times
  ([run filters and fields](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/types.go#L48-L60)).
- A self-hosted runner may leave a checkout directory on disk after failure,
  but the workflows do not promise adoption of that directory; they invoke
  `actions/checkout` for the next job
  ([worker checkout](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L42-L56)).
- The exact GitHub expression value used by
  `github.event.workflow_run.head_branch` for every manual-dispatch topology is
  external platform behavior. The source proves only the configured
  head-branch-or-ref concurrency expression
  ([group expression](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L25-L30)).
- A network error from `git push` does not distinguish rejection from
  response loss. Source inspection establishes the subsequent error path, not
  which side received the update
  ([batch push path](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L326-L346)).

Negative-claim searches were run across the pinned tree for `resume`,
`session`, `session_id`, `conversation`, `transcript`, `journal`, `sqlite`,
`database`, `wal`, `lease`, `idempotency`, `Fuzz`, `quick.Check`, `gopter`,
`rapid`, `property`, `TLA`, `Quint`, `model check`, `stash`, `MERGE_HEAD`,
`reflog`, `dry-run`, `concurrency`, and workflow `concurrency:` declarations.
The reachable code confirms:

- no provider session/resume field in `Agent.Execute` or `ExecOptions`, and
  Codex worker execution is explicitly ephemeral
  ([agent API](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/agent.go#L5-L55),
  [Codex args](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/codex.go#L95-L106));
- no independent database or journal in the platform boundary
  ([platform composition](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L31));
- no stash export/import or full worktree manifest in the timeout checkpoint,
  which stages and commits `.` instead
  ([checkpoint](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L579-L618));
- no fuzz/property/model-checking target at the pinned commit; the concurrency
  model is a prose audit backlog
  ([audit](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/specs/v1-release-09-concurrency-model-audit.md#L1-L28)); and
- no worker-workflow concurrency group, while integrator event paths do declare
  multiple narrower groups
  ([worker workflow](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L1-L56),
  [integrator workflow](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-integrator.yml#L25-L227)).

## 16. Technical and user-visible consequences

Technically, HerdOS can recover useful workflow progress after an ordinary
coordinator restart because GitHub and remote Git hold the important task,
attempt, and integration artifacts. Deterministic branches, run-input
correlation, timeout checkpointing, branch-containment checks, normal
non-fast-forward push behavior, Actions concurrency groups, and the review-lock
ref each reduce a specific duplicate or lost-update class
([worker resume](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L187-L250),
[integration fence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L251-L352),
[review lock](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L54-L99)).

The boundary is equally important: recovery is not exact process, session, or
worktree restoration. A user may see an issue temporarily carry a failed label
while a run exists, duplicate progress or command comments after ambiguous
calls, a fresh agent re-read old committed progress, or partial work disappear
if it was never pushed. On batch drift, a conflicting saved worker branch may
be deleted and work restarted from the current batch
([dispatch compensation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L220-L250),
[progress posting](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L832-L889),
[conflict fallback](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L206-L230)).

For a one-coordinator deployment, the architecture is practically restartable
at GitHub/Git artifact boundaries and has several thoughtful self-healing
paths. It is not a durable replay engine: correctness across ambiguous
boundaries depends on each operation's bespoke reread, compensation,
idempotency, or Git fence, and those protections are not yet uniform across
dispatch, work, integration, review, merge, and cleanup.
