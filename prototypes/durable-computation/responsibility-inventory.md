# Journal responsibility inventory

## Inventory boundary

This inventory freezes work-graph step 1 before runtime or test code changes.
It covers the closed `WorkflowJournalEvent` vocabulary at base
`d4128e475ddfdda6970ac7951ce7696d7736685a` and its production consumers.

The concrete question is: after Dalph stops, which earlier facts let the next
process continue the same Run, which outside systems must it check again, and
which past occurrences must remain explainable independently of continuation?
An Effect Workflow execution identity is never treated as a task, claim,
attempt, Git, executor, or current tracker fact.

The four candidate dispositions mean:

- **Workflow history**: the runtime may own continuation and reuse an exact
  completed step result.
- **Fresh owning-boundary read**: GitHub, Git, or the executor must be asked
  again before a current-fact decision.
- **Reduced semantic event**: a domain occurrence may need an independently
  queryable record even if Workflow owns continuation. This is a hypothesis;
  the Workflow-only arm runs first.
- **Delete**: no separately persisted Dalph fact is required if the runtime or
  an owning boundary supplies all accepted meaning.

## Durable record families

Every event tag in `WorkflowJournalEvent` appears once below. The disposition
is the experiment hypothesis, not an adoption decision.

| Current Journal records | Concrete restart decision or semantic query | First experiment disposition |
| --- | --- | --- |
| `WorkflowRunBegan`, `WorkflowRunTerminated` | Continue one exact `RunId` and target, reject a rival beginning, and distinguish unfinished from normally complete work. | Workflow history for exact execution identity and terminal result; derive the canonical beginning/termination trace from runtime evidence. |
| `TaskWorkCapacityChanged`, `ControlDirectionApplied` | Reconstruct the latest admission ceiling and applied Pause/Unpause direction, including the Operator action that changed it. | Workflow history for control flow; reduced semantic event remains a candidate for the Operator-attributed occurrence. |
| `AttemptChoiceApplied`, `AttemptStoppageIntended`, `AttemptImplementationAbandoned`, `StoppedAttemptClaimNoReleaseObserved`, `AttemptRestartAuthorityReadFailed`, `PlannedAttemptReplaced` | Preserve the first exact Continue/Restart/Stop choice, stop duplicate or competing choices, prove quiescence/read failure, and retain immutable replacement lineage. | Workflow history for first-wins continuation; fresh tracker, Git, and executor reads wherever the choice protocol requires current evidence; reduced semantic events remain candidates for the applied choice and replacement occurrence. |
| `TaskClaimReacquisitionDirected` | Coalesce exact Operator redelivery and authorize only the named replacement claim request. | Workflow history for request deduplication; reduced semantic event candidate for the applied Operator direction. |
| `TaskTrackerReadIntentRecorded`, `TaskTrackerFactsObserved` | Correlate a read with its result, rebuild durable graph/specification knowledge, and explain what was observed at that time. | Delete as a continuation mechanism when a named Workflow step result suffices; always perform a fresh GitHub read before a current-fact decision; derive the experiment trace from runtime and provider evidence before considering a reduced semantic event. |
| `TaskClaimAcquisitionIntended`, `TaskClaimAcquired`, `TaskClaimAcquisitionRejected`, `TaskClaimReleaseIntended`, `TaskClaimReleased` | Prove intent before the unsafe GitHub request, reconcile an unknown result, avoid duplicate acquisition/release, and explain the exact observed claim outcome. | Workflow history remembers the protocol point but is not proof of GitHub state; fresh exact-claim read after ambiguity; reduced semantic claim intent/outcome only if Workflow history cannot supply the accepted trace without becoming external authority. |
| `TaskAttemptPlanned` | Retain one immutable attempt with exact Run, task revision, Base SHA, branch, worktree, and executor locator; prevent a rival attempt after restart. | Workflow history with schema-decoded planned-attempt payload. No separate record unless the candidate cannot expose the exact plan for recovery and evidence. |
| `TaskWorktreeReconciliationIntended`, `TaskWorktreeReady`, `GitReadIntentRecorded`, `PlannedAttemptWorktreeObserved`, `TargetLineageObserved` | Reconcile an uncertain worktree request, prove exact path/branch/Base ancestry, and learn current target lineage. | Workflow history for completed step correlation; fresh Git reads whenever the next decision requires current worktree/ref facts; delete duplicate observation history unless a scenario requires independent semantic evidence. |
| `PlannedAttemptExecutorWorkResponsibilityBegan`, `PlannedAttemptContinuationAuthorized` | Hold one task-work position for the same exact Run/Attempt and authorize continuation only after the required current tracker/Git reads. | Workflow history for responsibility/continuation; fresh tracker, Git, and executor reads at the existing protocol boundaries; reduced semantic event candidate for the coordinator-initiated responsibility occurrence. |
| `PlannedAttemptExecutorCommandIntended`, `PlannedAttemptExecutorCommandProjectionObserved`, `PlannedAttemptExecutorCommandResponseContradicted`, `PlannedAttemptExecutorStateObserved`, `PlannedAttemptExecutorWorkReported` | Reconcile an uncertain start/continue/suspend command, reject foreign correlation, and reconstruct running/safely-suspended/terminal evidence. | Workflow history for command ordering; fresh exact `(RunId, AttemptId)` executor observation after ambiguity or process loss; reduced semantic report occurrence only if explanation cannot be derived independently. |
| `IntegrationResponsibilityBegan`, `IntegrationStarted` | Preserve accepted-result queue order and the non-cancellable integration cutoff. | Workflow history for continuation and order; reduced semantic events remain candidates because these are domain responsibility/action occurrences. |
| `IntegratorSessionFixed`, `IntegratorSuccessorSessionFixed`, `IntegratorRunStarted`, `IntegratorRunResultRecorded`, `IntegratorRunCandidateGitReadIntended`, `IntegratorRunCandidateGitObserved` | Resume one exact integration session, avoid duplicate agent runs, preserve conclusive reports, and qualify only the explicitly reported candidate. | Workflow history for session/run continuation; fresh Integrator/Git observations where their protocols require current facts; semantic event only if accepted explanation needs it independently. |
| `TargetPromotionIntended`, `TargetPromotionAttemptIntended`, `TargetPromotionObservedSuccess`, `TargetPromotionStale`, `TargetPromotionNonConvergence` | Reconcile an ambiguous compare-and-set, consume at most three attempt ordinals, prove promotion from Git, or preserve work after non-convergence. | Workflow history for request/attempt ordinals; fresh Git ref/ancestry read after ambiguity; reduced semantic promotion outcome only if runtime history cannot support the accepted trace. |
| `CompletionClaimReplacementIntended`, `CompletionClaimReplacementAttemptIntended`, `CompletionClaimReplaced`, `CompletionClaimDeletionIntended`, `CompletionClaimDeletionAttemptIntended`, `CompletionClaimDeletionReadObserved`, `CompletionClaimDeleted` | Reconcile exact completion-claim replacement/deletion without changing a foreign claim and preserve bounded attempt order. | Workflow history for continuation and ordinals; fresh exact-claim GitHub read after ambiguity; semantic record only if required independently from the provider ledger. |
| `PostPromotionBlockerCandidateAncestryReadIntended`, `PostPromotionBlockerCandidateAncestryObserved` | Check Git again when a post-promotion blocker changes and retain the exact ancestry evidence used by that decision. | Workflow history for completed read; fresh Git read for the current decision; delete duplicate durable observation unless required as semantic evidence. |
| `CompletionTaskIntended`, `CompletionTaskAttemptIntended`, `CompletionTaskAcknowledged`, `CompletionTaskResponseLost`, `CompletionTaskRejected`, `CompletionTaskCandidateAncestryReadIntended`, `CompletionTaskCandidateAncestryObserved`, `CompletionTaskRequestLookupIntended`, `CompletionTaskRequestLookupObserved` | Reconcile unknown tracker completion, keep attempt bounds, prove candidate ancestry, and distinguish acknowledgement, rejection, and lost response. | Workflow history for continuation and ordinals; fresh GitHub/Git reads after ambiguity; semantic result only if the accepted trace cannot be derived from runtime plus provider evidence. |
| `IntegrationFinalitySettled` | Establish terminal delivery only after exact promotion, tracker, and cleanup evidence agree. | Workflow terminal/step result for continuation; reduced semantic event candidate for independently queryable settlement. |
| `IntegrationQuarantined`, `IntegrationProviderRunActivityAbsent`, `IntegrationQuarantineDirectionApplied` | Preserve work, prove provider activity absent, and enforce the first exact Retry/Full-rerun direction after restart. | Workflow history for first-wins control and continuation; fresh provider observation where required; reduced semantic events remain candidates for quarantine and Operator choice. |

## Consumer responsibilities

The event-by-event reducers are numerous, but they consume Journal history for
the following distinct purposes. These are the seams the comparison must score;
file counts are not a substitute for the concrete responsibility.

| Production consumers at the pinned base | What they obtain from Journal history | Candidate replacement under test |
| --- | --- | --- |
| `workflow-journal/adapters/*`, `store.ts`, `run-lifecycle.ts`, `event-codec.ts`, `exact-record.ts`, `prefix-lineage.ts` | Atomic append/read/scan, exact keys and positions, schema/version failure, prefix ordering, Run beginning/termination. | SQL Workflow message/activity/execution storage and versioned schemas; no second general Dalph append log. |
| `coordination/run/journaled-run-bootstrap.ts`, `startup-recovery.ts`, `recovery-activation.ts`, `run.ts` | Discover one unfinished Run, validate its target/history, reconstruct it, and enter the ordinary activation path. | One exact versioned Workflow execution derived from `RunId`; restart re-executes the handler and no rival execution is established. |
| `coordination/reconstruction/*` | Validate causal order and rebuild policy, graph knowledge, outstanding task/executor/integration responsibilities, attempts, controls, and dispositions. | Workflow handler state/step results for continuation, plus current owning-boundary reads. Any independently necessary semantic query becomes an explicitly named reduced record, never a reconstructed general frontier. |
| `workflow-journal/journaled-interpreter.ts` and `workflow/protocols/*` | Record intent, reuse an exact completed result, and reconcile ambiguous tracker/Git/executor/integration effects. | Versioned Workflow activities/steps with unsafe retry disabled; explicit read-after-ambiguity remains in the handler. |
| `coordination/delivery/*`, `coordination/frontier/*`, `control/*` | Project exact outstanding responsibilities and controls into current process-local delivery/admission decisions. | Rebuild process-local projections from Workflow continuation evidence and fresh authority reads; never persist frontier, positions, proposals, or live owners. |
| `workflow/registry/occurrence-projection.ts` and `presentation/*` | Project selected actor-attributed/non-action occurrences for explanation. | Canonical experiment trace derived from actual candidate evidence. If Workflow-only cannot answer an accepted semantic query, record the smallest domain-named event in the reduced-log arm. |
| `coordination/application-exit/*` | Acknowledge already-produced Journal writes and leave unfinished work recoverable while stopping successor admission. | The process-wide Exit cutoff remains outside Workflow; admitted work reaches a runtime-recognized durable boundary without starting a successor step. |

## Frozen findings for the implementation

1. Workflow may replace durable continuation, but no stored activity result is
   current GitHub, Git, or executor authority.
2. The first tracer bullet needs only one claim mutation and later graph read,
   but its identities are production-shaped: exact Run, Attempt, task, claim,
   and Base SHA.
3. The harness observes behavior outside both adapters. It may persist the
   controlled outside world and provider-call ledger, but those records do not
   drive candidate continuation.
4. The Workflow-only arm must run before any reduced semantic log is added.
5. A reduced log is justified only by a named accepted scenario or semantic
   query that cannot be answered from Workflow history, fresh provider facts,
   and the external evaluation ledger.
6. The current-Journal-around-Workflow arm is diagnostic only and is not part
   of the authorized step-3 minimum unless needed to isolate an engine defect.

## Issue #233 closed-loop responsibility refinement

The real delivery loop sharpens the split without changing production code:

| Concrete responsibility | Owner in the Workflow arm | Durable disposition |
| --- | --- | --- |
| Describe the current graph, plan exact next actions, admit bounded work, own fibers/resources, and decide quiescence. | Existing Dalph delivery composition and process-local runtime. | Never persisted by the experiment. Rebuilt after every child start. |
| Identify the exact ambiguity-crossing action. | Dalph materializes `OperationId` before calling `DeliveryActionExecutor`; the adapter derives the Activity name one way from it. | Activity request/result is Workflow replay infrastructure. |
| Perform and schema-decode the controlled tracker read. | Workflow-backed `DeliveryActionExecutor`. | Stored Activity result is historical accepted read evidence, not current tracker authority. |
| Publish the accepted read into the current delivery input. | Dalph adapter beneath the executor result. | Publication itself is process-local. The current private Journal observation brand forces temporary Journal-shaped translation. |
| Learn a fact that changed while Dalph was stopped. | Controlled task-tracker boundary. | Read fresh after replayed publication; never answered from Workflow history. |
| Explain what the maintainer observed. | Parent-owned ledgers and canonical projection. | Evaluation evidence only; no ledger drives adapter continuation. |

This refinement leaves verdict 2 strongest: preserve `delivery` with a
provider-neutral accepted-observation input and exact durable action identity.
It supplies no authority to adopt Workflow or delete Journal evidence for
untested action families.
