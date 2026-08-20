# Workflow worktree-reconciliation deletion experiment (#234)

This directory is disposable evidence. It is a new package and does not change
the production packages or the immutable #233 prototype.

## Starting point and dependencies

- Exact starting commit: `b0b4a15d3a4c1e75b129c0c620042a64c2178692`.
- Prototype branch: `prototype/issue-234-workflow-deletion-leverage`.
- Effect: `4.0.0-beta.106`.
- `@effect/platform-node`: `4.0.0-beta.106`.
- `@effect/sql-sqlite-node`: `4.0.0-beta.106`.
- Vitest: `4.1.10`.
- Workspace `@dalph/contracts` and `@dalph/orchestrator`: the exact starting
  revision above, built locally only so the child can load their package
  exports. No production source is edited.

The fixture keeps one branded `OperationId`, Run, Attempt, Base SHA, branch,
and worktree locator across the parent harness, both child processes, the
Workflow payload/Activity, controlled Git calls, Activity evidence, and Journal
events. The Activity name is also stable and exact.

## Chronological evidence

Each test uses a fresh temporary workspace. The parent sends `SIGKILL` at the
named boundary and starts the same Workflow idempotency key again.

| Case | Controlled Git ledger | Activity/Journal ledger | Current decision |
| --- | --- | --- | --- |
| Unstored Activity result | `read absent → create applied → restart read ready → current read ready`; one create | First child reaches `AfterCreateBeforeActivityStorage` with `{code:null, signal:SIGKILL}`; successor stores the result and appends one `TaskWorktreeReady`; production responsibility projection is `Ready` → `Settled` before proposal removal | Continue only after Journal publication and a fresh read |
| Stored result before Journal | `read absent → create applied → read ready`; no successor adapter call | First child reaches `AfterActivityStorageBeforeJournal` with `{code:null, signal:SIGKILL}`; successor replays the stored result and appends one idempotent outcome; projection becomes `Settled` before proposal removal | No post-replay Git decision is made in this cut; Journal publication removes the proposal |
| Facts changed during downtime | Same first-child ledger; downtime changes the controlled observation to absent; successor makes one fresh read absent | Historical result is replayed and one Journal outcome is published; projection is `Ready` → `Settled`; executor-boundary contact probe remains empty | Wait/fail closed from the fresh controlled read; no executor admission |
| Blind retry (negative control) | Second Activity sends a second create | Successor exits normally, but the two-create ledger fails the one-create rule | Negative control fails |
| Suppressed Journal (negative control) | No successor adapter call | Journal outcome is suppressed; successor is killed with `{code:null, signal:SIGKILL}`; proposal remains present | No delivery advancement |
| Historical readiness (negative control) | Two Activity reads only; successor makes no current read | Replayed result is deliberately recorded as current | Incorrectly Continue; this is the forbidden authority substitution |

The durable ledgers are deliberately separated:

- `workflow.sqlite` is the local Effect Workflow/Activity execution store. Its
  rows are inventoried individually as Workflow invocations, Activity replies,
  or runtime migrations; it is not Run chronology or delivery state.
- `journal.sqlite` is the local Dalph Journal. It contains the begun Run, the
  exact acquired claim and focused current-claim observation that authorize the
  planned Attempt, `TaskWorktreeReconciliationIntended`, and at most one
  idempotent `TaskWorktreeReady` outcome. That claim precondition is why the
  production responsibility projection is `Ready` before Workflow entry.
- `controlled-git-world.json` is the controlled adapter's current outside-world
  observation and exact planned resource fixture.
- The `*.ndjson` files are append-only test evidence for controlled Git calls,
  Activity result-storage/replay boundaries, proposal visibility, production
  responsibility projection (the production `Ready`/`Settled` dispositions), executor-boundary contacts,
  and decision evidence. They are not reconstructed application state.

The harness inspects the workspace before cleanup. Its allowed durable
categories are `JournalChronology`, `WorkflowExecutionStore`,
`ControlledGitCurrentObservation`, `ControlledGitEvidence`,
`ActivityReplayEvidence`, `ProposalObservationEvidence`, `DecisionEvidence`,
`ResponsibilityProjectionEvidence`, and `ExecutorBoundaryContactEvidence`;
every inventory rejects unknown files, SQLite tables, Workflow rows, or Journal
rows and has an empty forbidden-category scan. SQLite string, integer, and Blob
cells are decoded for the forbidden-marker scan; SQLite `-wal`/`-shm` sidecars
left by a killed process are classified as their owning store but are not
treated as row stores. Journal rows are separately classified as RunLifecycle,
TaskClaimIntent, TaskClaimOutcome, TaskClaimObservationIntent,
TaskClaimObservationOutcome, TaskPlan, TaskWorktreeIntent, or
TaskWorktreeOutcome; no unknown Journal row is
accepted. No proposal/frontier/current-signal/task-work-position/live-owner/
physical-resource/UI state, real repository, Git command, GitHub call, or
executor process is persisted or started. The only child processes are the
throwaway Node harness children that are intentionally killed. The physical
worktree marker remains absent in every passing test. Application Exit is
constructed by the child shell outside the Run Workflow and only its admission
capability is supplied to the process-local delivery runtime. The executor
boundary contact ledger is consumed by the decision evidence path; it remains
empty because ordinary delivery never contacts the injected trap.

On restart, ordinary planning reads and validates the persistent Journal,
projects the exact worktree responsibility with the repository's
`deriveJournalResponsibilityFacts(runState)`, and reconstructs the pending
proposal. `DeliveryActionExecutor` then invokes the one exact Workflow
execution/Activity. After replay, ordinary code appends through the persistent
Journal, rereads and reduces it, and updates its current bundle only after the
production responsibility projection is `Settled`. The Workflow success is
only `WorktreeActivityResult`; the historical-read negative control deliberately
misuses that replayed proof in ordinary outer code and never stores a derived
decision in Workflow state.

## Scenario-to-test map

| Operational scenario | Acceptance test |
| --- | --- |
| Creation applies before Activity result storage; restart rereads and does not create twice | `reconciles the controlled worktree after an unstored Activity result without creating twice` |
| Stored result is replayed without a controlled Git call; one Journal outcome and publication-gated proposal removal | `replays the stored worktree result into the Journal without another controlled Git call` |
| Current facts change during downtime; fresh controlled Git read waits/fails closed with no executor admission | `reads controlled Git again before using replayed worktree readiness for a current decision` |
| Blind retry repeats create | `proves that a blind Activity retry repeats controlled create as a negative control` |
| Suppressed Journal publication retains proposal | `proves that suppressed Journal publication retains the proposal as a negative control` |
| Historical replay incorrectly authorizes current decision | `proves that replayed historical readiness would incorrectly authorize a current decision as a negative control` |
| Contradictory controlled facts fail closed with exact typed Activity reason | `fails closed on contradictory controlled facts with the exact Activity reason` |

## Explicit deletion test and verdict

The candidate was evaluated as a disposable implementation, not as a
production refactor:

| Responsibility class | Explicit result |
| --- | --- |
| Removed | From the Workflow handler only: proposal construction, graph/relation construction, Journal append, current-decision read, and the hand-built empty-contribution signal update. |
| Retained | The ordinary delivery runtime, exact `OperationId`/Run/Attempt/Base/branch/worktree qualification, typed controlled Git reconciliation protocol, Journal intent/outcome facts, publication-gated proposal disappearance, fresh current-fact read, process-local executor admission boundary, and process-wide Application Exit. |
| Added | One Workflow/Activity execution store, Workflow payload/result identity plumbing, injected controlled `GitWorktree` Layer, exact tagged `WorktreeActivityError` transport, executor-boundary trap, execution/exit/contact/projection ledgers, pre-cleanup row-level durable inventory, and source guards. |
| Duplicated | Worktree recovery still exists in both the Workflow Activity and the outer DeliveryActionExecutor seam; ordinary Journal reconstruction and the controlled evidence ledgers also repeat identity vocabulary around the production projection. |

| Consequence | Evidence |
| --- | --- |
| Module depth | Ordinary planning → DeliveryActionExecutor → exact Workflow execution → Activity → injected controlled `GitWorktree`; Journal reread/projection and current decision return through ordinary executor code. |
| Locality | The controlled adapter and executor trap are local and injectable, but identity, fault hooks, replay evidence, projection evidence, and Journal folding cross seven prototype modules. |
| Leverage | The Workflow protects Activity result storage/replay and makes the deletion boundary visible, yet it does not delete the existing ordinary reconciliation responsibility or any production protocol. |
| Test surface | Nine focused acceptance tests cover three named scenarios, four negative controls, exact process exits, row-level inventory, and a manifest source guard; the extra ledgers and child protocol are additional surface. |

The candidate therefore demonstrates the required boundaries but does not meet
the deletion-leverage bar: the existing restart procedure is not deleted and
the candidate introduces more concepts and test surface than it removes.

**Decision: no-go. Stop further Workflow evaluation and do not adopt this
prototype.** The prototype demonstrates the three recovery boundaries and the
negative controls, but it does not satisfy the deletion leverage required to
remove the existing restart procedure.

## Verification ledger

Focused results after the round-3 standards correction:

```text
pnpm --filter @dalph/workflow-worktree-reconciliation-prototype typecheck  PASS
pnpm --filter @dalph/workflow-worktree-reconciliation-prototype test       PASS (9/9)
```

The repository-wide `pnpm check:all` result is recorded below. The one final
`pnpm check:quint` run remains a parent-owned pending gate; no successor
experiment or production integration is part of this prototype.

Final gate results after this reviewer correction:

```text
pnpm check:all    PASS (369/400 successful output lines; 193 test files passed,
                       1 skipped; 1,789 tests passed, 2 skipped; no leaks)
pnpm check:quint  PENDING (the parent performs the one final model run)
```
