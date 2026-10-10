# Resume an Open task after owning Pause and Unpause

The owning host redelivers an already intended Resume to the same executor
attempt after Pause/Unpause when reconciliation proves it is still Safe.
The tracker task remains Open throughout. This is the outer composition of
[retained continuation](reopen-retained-c.md) and
[interrupted tool recovery](recover-interrupted-tool-item.md), accepted in
[issue 506](https://github.com/dearlordylord/dalph/issues/506) under
[491](https://github.com/dearlordylord/dalph/issues/491).

## R1: preserve the original command

The Operator previously paused the owning Run; Dalph recorded Suspend and
accepted exact Safe. The Operator unpaused it and Dalph recorded Resume7.
Its response was lost. Reconciliation first returned Unreadable, then exact
Safe for that same command. The executor proves native launch and independent
storage custody stopped before it can permit another turn. Tracker task,
specification, claim and dependency eligibility remain valid; Git still proves
the original worktree, Base and lineage.

Ordinary activation reconstructs a private revalidation permission from the
retained Resume and Safe projection. Unlike lifecycle reopening, this permission
does not require TerminalWithoutSuccess at the earlier Safe boundary. It reserves
capacity and reads current tracker graph, specification, claim, Git worktree and
lineage. Only the existing exact redelivery authorization can cross the executor
boundary. Dalph records ResumeRedeliveryIntended before the effect and correlates
its response with Resume7. The original attempt, thread, Run, claim, Base,
worktree and semantic ordinal survive; no Begin or new semantic Resume occurs.
Closed-to-Open recovery retains its separate lifecycle guard.

## R2: crashes and denials

A host can stop before redelivery intent, after that intent before the executor
effect, after the effect before its response, or after response before the next
activation. Reopening the same native history discards process-local permissions.
Uncertain effects are reconciled first. Executing or terminal evidence settles
the original command without another turn. Still-Safe needs a new unconsumed
projection and fresh authority before another redelivery; consuming or superseding
one projection cannot authorize another call.

Unreadable, foreign or mismatched attempt/ordinal observations cannot authorize
redelivery. Stale, superseded and consumed proofs, invalid specification, claim,
worktree, lineage or dependencies, paused/cancelled Run, and unproved native or
storage custody remain blocking edges. A closed task cannot continue solely from
this repair. Provider/tool deadlines are immutable. No production journal or
private-state editing, derived eligibility signalling, broad Suspend permission
from Unreadable, or persisted frontier/resources/UI state is introduced.

## Acceptance mapping and evidence limits

The controlled public workflow uses SQLite history and actual temporary Git
worktrees, with executor/tracker services substituted. Its original ordinal is 3
(the equivalent retained production ordinals are 7 and 5). The tests do not claim
native process custody or execution of the original production attempts.

| Scenario/boundary | Exact tests |
| --- | --- |
| R1: Open throughout, owning Pause/Unpause, Unreadable→Safe, finite fresh reads, one ordered redelivery/response, no new command/plan/claim | [production.test.ts](../../packages/dalph/test/scenarios/production.test.ts): `redelivers an Open task's reconciled Resume after owning Pause with bounded fresh authority reads` |
| R2: actual outer cuts before intent, after intent before effect, after effect before response, after response | Same file: `recovers Open-task Resume BeforeIntent without replacing its semantic command`, and `AfterIntent`, `AfterEffect`, `AfterResponse` variants; consumed projection requires projection2/redelivery2, Executing requires zero retries |
| R2: current closed task, changed specification, foreign claim, blocked dependency, detached worktree, non-descendant lineage, Unreadable or foreign executor | Same file: `denies Open-task Resume redelivery with Closed current authority`, and `Specification`, `Claim`, `Dependency`, `Worktree`, `Lineage`, `Unreadable`, `Foreign` variants |
| R2: exact eligibility, consumed/superseded/foreign projections, independent lifecycle guard | [recovery-activation.test.ts](../../packages/orchestrator/src/coordination/run/recovery-activation.test.ts): `mints pre-read capacity eligibility from lifecycle reopening or exact reconciled Resume` |
| R2: missing/stale five current witnesses, swapped/consumed proof, later executor evidence | [resume-redelivery-authorization.test.ts](../../packages/orchestrator/src/workflow/protocols/planned-attempt-continuation/resume-redelivery-authorization.test.ts); [admission tests](../../packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts) reject stale/swapped identities before reservation |
| Existing closed→Open and redelivery handoff cuts | [lifecycle-resume.test.ts](../../packages/dalph/test/cassettes/lifecycle-resume.test.ts): original ResumeIntent and RedeliveryIntent/Held/ResponseLost recovery cases |

The leaf repair cannot substitute for #491/#495/#503 recovery. The root must
publish/deploy it through Dalph and observe original Resume7/5 settle and execute
before claiming production recovery. #503 native qualification and #501 coherent
submission remain pending. No full gate is required for this scoped repair.
