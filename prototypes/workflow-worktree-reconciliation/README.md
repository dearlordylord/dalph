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
| Unstored Activity result | `read absent → create applied → restart read ready → current read ready`; one create | First child reaches `AfterCreateBeforeActivityStorage`; successor stores the result and appends one `TaskWorktreeReady` | Continue only after Journal publication and a fresh read |
| Stored result before Journal | `read absent → create applied → read ready`; no successor adapter call | First child reaches `AfterActivityStorageBeforeJournal`; successor replays the stored result and appends one idempotent outcome | No post-replay decision is made in this cut; Journal publication removes the proposal |
| Facts changed during downtime | Same first-child ledger; downtime changes the controlled observation to absent; successor makes one fresh read absent | Historical result is replayed and one Journal outcome is published | Wait, with `executorAdmissions: 0` |
| Blind retry (negative control) | Second Activity sends a second create | Shows why retrying create without a controlled reread is unsafe | Negative control fails the one-create rule |
| Suppressed Journal (negative control) | No successor adapter call | Journal outcome is suppressed; proposal remains present | No delivery advancement |
| Historical readiness (negative control) | Two first-child reads only; successor makes no current read | Replayed result is deliberately recorded as current | Incorrectly Continue; this is the forbidden authority substitution |

The durable ledgers are deliberately separated:

- `workflow.sqlite` is the local Effect Workflow/Activity execution store. It
  contains Workflow execution and stored Activity result state only; it is not
  Run chronology or delivery state.
- `journal.sqlite` is the local Dalph Journal. It contains the begun Run, the
  exact planned Attempt, `TaskWorktreeReconciliationIntended`, and at most one
  idempotent `TaskWorktreeReady` outcome.
- `controlled-git-world.json` is the controlled adapter's current outside-world
  observation and exact planned resource fixture.
- The `*.ndjson` files are append-only test evidence for controlled Git calls,
  Activity result-storage/replay boundaries, proposal visibility, and decision
  evidence. They are not reconstructed application state.

No proposal, frontier, current signal, task-work position, live owner,
physical resource, UI state, real repository, Git command, GitHub call, or
executor process is persisted or started. The only child processes are the
throwaway Node harness children that are intentionally killed. The physical
worktree marker remains absent in every passing test. Application Exit is
constructed by the child shell outside the Run Workflow and only its admission
capability is supplied to the process-local delivery runtime.

## Scenario-to-test map

| Operational scenario | Acceptance test |
| --- | --- |
| Creation applies before Activity result storage; restart rereads and does not create twice | `reconciles the controlled worktree after an unstored Activity result without creating twice` |
| Stored result is replayed without a controlled Git call; one Journal outcome and publication-gated proposal removal | `replays the stored worktree result into the Journal without another controlled Git call` |
| Current facts change during downtime; fresh controlled Git read waits/fails closed with no executor admission | `reads controlled Git again before using replayed worktree readiness for a current decision` |
| Blind retry repeats create | `proves that a blind Activity retry repeats controlled create as a negative control` |
| Suppressed Journal publication retains proposal | `proves that suppressed Journal publication retains the proposal as a negative control` |
| Historical replay incorrectly authorizes current decision | `proves that replayed historical readiness would incorrectly authorize a current decision as a negative control` |

## Deletion test and verdict

The candidate keeps the production `recoverTaskWorktreeOperation`, its retained
intent lookup/manual reinvocation path, the controlled Git read/create/reread
protocol, Journal intent/outcome events, exact planned-resource qualification,
fresh-current-fact rule, process-local admission, and Application Exit
semantics unchanged. It adds a Workflow execution store, Activity result schema,
Workflow/Activity identity plumbing, and a second recovery implementation in
the Activity. Therefore the existing restart responsibility is not deleted,
and the candidate introduces more concepts and test surface than it removes.

**Decision: no-go. Stop further Workflow evaluation and do not adopt this
prototype.** The prototype demonstrates the three recovery boundaries and the
negative controls, but it does not satisfy the deletion leverage required to
remove the existing restart procedure.

## Verification ledger

Focused results before handoff:

```text
pnpm --filter @dalph/workflow-worktree-reconciliation-prototype typecheck  PASS
pnpm --filter @dalph/workflow-worktree-reconciliation-prototype test       PASS (6/6)
```

The final handoff records the exact `pnpm check:all` and one final
`pnpm check:quint` result after they run. No successor experiment or production
integration is part of this prototype.

Final gate results:

```text
pnpm check:all    FAIL (unrelated project-memory stage: 12 scenarios expected
                       the master-worktree context; build, package boundary,
                       typecheck, Effect diagnostics, format, circular,
                       complexity, and duplicate stages completed)
pnpm check:quint  PASS (complete model gate; 277.96s)
```
