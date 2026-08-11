# Settle one promoted task without completing the Run

Issue: [#141 Complete integration, tracker resolution, and responsibility finality](https://github.com/dearlordylord/dalph/issues/141)

Status: accepted on 2026-08-08. Issue #141 starts after issue #60 has
durably proved an exact candidate promotion. It replaces and later deletes the
task's exact claim and settles only that task's retained integration
responsibility. Issue #61 owns the request that tells the tracker to complete
the task and the focused task observation that proves successful completion.
Issue #53 owns the later complete graph observation that releases dependants.
Issue #102 owns whole-Run termination.

No person directly starts this protocol. The running Dalph coordinator reacts
to Git and tracker facts. Git owns the promoted commit and target ancestry; the
tracker owns the task lifecycle and claim record; Dalph's journal owns only the
ordered workflow intents and outcomes described below.

## A promoted task replaces its active claim with an exact completion claim

### Starting situation

Run R has task A, attempt T, active claim K, and an unsettled integration
responsibility. Git's target contains exact candidate M, and the journal has
the constructed-candidate, sealed passing verification, and promotion proof
that bind M to A, T, task revision V, expected head H, and the exact target.
The latest complete tracker observation still reports A open with exact active
claim K. No completion-claim replacement intent exists.

### Trigger and chronological behavior

1. Dalph derives one completion claim KC from K and the exact promotion proof.
   KC carries R, A, T, V, K's identity, and M's promotion correlation.
2. Dalph records the exact `K -> KC` replacement intent and waits for the
   append acknowledgement.
3. Dalph asks the tracker for A's exact current claim. Only exact K authorizes
   the replacement; exact KC instead proves a previously ambiguous request
   succeeded, while a foreign or unreadable claim produces a task-local wait.
4. Before each authorized request, Dalph records the next numbered replacement
   attempt intent and waits for the append acknowledgement.
5. Dalph asks the tracker to replace exact K with exact KC. The tracker reports
   KC current.
6. Dalph records the replacement outcome. The physical Git-target position is
   already released, but A's logical integration-completion responsibility
   remains unsettled.
7. Dalph waits for issue #61 to establish a fresh focused tracker observation
   that A completed successfully. It sends no complete-task request itself and
   releases no dependant itself. The focused observation covers A only and
   cannot release any dependant.

A maintainer sees M remain promoted and KC mark the exact task whose tracker
completion is pending. Dalph must not reopen A, start another integration
agent, reconstruct M, overwrite a foreign claim, infer tracker success from
Git success, or call the issue-#61 complete-task boundary.

A crash before step 2 leaves no replacement to reconcile. A crash after step 2
reconstructs the same KC and follows the ambiguous-replacement scenario rather
than allocating another claim.

### Acceptance tests and model checks

- `replaces the exact active claim with a promotion-bound completion claim`
- `restart after promotion resumes completion settlement without another integration agent`
- `completionClaimRequiresExactPromotionProof`
- executable integration-finality MBT replacement actions

## A lost replacement response is reconciled before retry

### Starting situation

The journal contains the exact `K -> KC` intent. The tracker request may have
landed, but its response was lost and no outcome is recorded. Dalph may have
crashed; process-local ownership is gone.

### Trigger and chronological behavior

1. Dalph reads A's exact current claim before sending another replacement.
2. If the tracker reports exact KC, Dalph records the replacement outcome and
   sends no second replacement request.
3. If it reports exact K, Dalph may ask for the same `K -> KC` replacement
   again, subject to the protocol's fixed request bound.
4. If it reports a foreign claim, unreadable claim state, or an incomplete
   response, Dalph records or exposes the typed wait/conflict and sends no
   mutation.

The maintainer sees one stable KC or a task-scoped wait. Dalph must not treat a
lost response as rejection, generate KC2, mutate a foreign claim, or loop
without a bound. Unrelated task B remains independently eligible.

### Acceptance tests and model checks

- `reconciles a lost completion-claim replacement without allocating another claim`
- `does not mutate a foreign claim while settling a promoted task`
- `waits without replacing when the current completion claim cannot be read`
- `lostReplacementResponseReadsBeforeRetryTest`
- `completionClaimRequestsAreBounded`

## A blocker discovered after promotion preserves M and the settlement

### Starting situation

M is already promoted and its exact proof is durable. Before KC replacement or
while KC is current, a fresh tracker graph reports that A has an unfinished
prerequisite. No fresh observation reports A completed successfully.

### Trigger and chronological behavior

1. Dalph keeps the exact integration-completion responsibility and promotion
   proof, but holds no Git-target position while waiting.
2. It sends no completion-claim mutation that the current tracker facts do not
   authorize, sends no complete-task request, and starts no successor
   integration session.
3. Later, a fresh complete graph reports the blocker cleared. Dalph continues
   the same KC/settlement protocol using M's existing promotion proof.

The maintainer sees the already-promoted code preserved while A waits. Dalph
must not roll Git back, delete M, re-run integration, silently drop A's
responsibility because the runnable frontier is empty, or let the wait stop B.

### Acceptance tests and model checks

- `blockerAfterPromotionPreservesTheSameProofTest`
- `freshBlockerClearObservationPermitsCompletionOfExistingPromotionTest`
- `reintegrationAfterPromotionIsDetectedTest`
- `preserves promoted M across a post-promotion blocker and resumes its same finality proof after clear`
- `releases a deferred owner, runs unrelated work, and retries only after a newer accepted fact`

## Fresh tracker success authorizes exact completion-claim deletion

### Starting situation

Exact KC is current and the integration-completion responsibility is
unsettled. A later focused tracker observation, recorded after KC replacement,
now reports A `CompletedSuccessfully` and still reports exact KC. The success
may have been written externally or by issue #61's completion request; #141
does not infer or own that request. This fresh task-scoped authority fact, not
Git promotion, an executor result, or a mutation acknowledgement, proves
tracker success.

### Trigger and chronological behavior

1. Dalph records intent to delete exact KC and waits for the append
   acknowledgement.
2. Dalph asks the tracker for A's exact current claim. Only exact KC authorizes
   deletion; an absent claim proves prior success, while a foreign or unreadable
   claim produces a task-local wait.
3. Before each authorized request, Dalph records the next numbered deletion
   attempt intent and waits for the append acknowledgement.
4. Dalph asks the tracker to delete only exact KC. The tracker reports it
   absent.
5. Dalph records the exact deletion outcome.
6. Dalph establishes A's task-scoped delivery settlement and settles A's exact
   retained integration-completion responsibility. Responsibilities for other
   tasks remain unchanged.
7. Dalph does not terminate R. Issue #102 later decides whole-Run finality from
   all subjects and current tracker evidence.

The maintainer sees A remain successful, KC removed, and no duplicate
integration work. Dalph must not delete K or a foreign claim, settle before
focused tracker success, infer dependant release from that focused fact, erase
another task's responsibility, or record `RunTerminated`.

### Acceptance tests and model checks

- `deletes only the exact completion claim after fresh tracker success`
- `settles only the promoted task and preserves unrelated responsibilities`
- `does not terminate an empty frontier while completion settlement is pending`
- `freshTrackerSuccessPrecedesCompletionClaimDeletion`
- `subjectSettlementIsLocal`

## A lost or failed deletion never reopens successful work

### Starting situation

Fresh tracker authority already proves A completed successfully. The journal
contains the exact KC deletion intent. The delete response is lost, the
tracker rejects the request, or Dalph crashes before recording the outcome.

### Trigger and chronological behavior

1. Dalph reads A's exact current claim before another delete request.
2. If KC is absent, Dalph records exact deletion success without another
   delete and settles A.
3. If exact KC remains, Dalph may retry the same bounded deletion request.
4. If a foreign claim is current or the read is incomplete/unreadable, Dalph
   preserves the fresh success fact and retains an exact cleanup
   responsibility with a typed conflict or wait.
5. Definite failure or request-bound exhaustion likewise leaves A successful
   and the cleanup responsibility visible for later reconciliation.

The maintainer sees successful A plus either settled cleanup or an exact
cleanup wait. Dalph must not reopen A, reacquire an active claim, re-run the
executor or integration agent, delete a foreign claim, drop the cleanup
responsibility, or retry forever.

### Acceptance tests and model checks

- `reconciles a lost completion-claim deletion without reopening success`
- `keeps successful work final when completion-claim deletion cannot converge`
- `keeps successful work final when the completion claim cannot be read before deletion`
- `failedDeletionKeepsSuccessfulTaskFinalTest`
- `completionClaimDeletionRequestsAreBounded`

## Empty runnable work is not task or Run finality

### Starting situation

No new task or integration action is runnable. A may be waiting on a blocker,
isolated by unreadable or conflicting tracker facts, holding KC while tracker
completion is pending, or holding an exact deletion-cleanup responsibility.
Other subjects may also have retained responsibilities.

### Trigger and chronological behavior

1. Dalph derives no forward action for the constrained subject and retains its
   exact reason and responsibility.
2. A later activation may continue only after the owning authority supplies
   the missing fact or the exact cleanup can be reconciled.
3. Settling one subject removes only that subject's settled responsibility.
   The Run remains nonterminal while any other retained responsibility exists.

There is no person or external boundary call in the empty-frontier decision:
it is a pure consequence of reconstructed responsibilities and current facts.
Dalph must not equate quiescence with completion, manufacture an empty target,
discard an isolated responsibility, or terminate the Run.

### Acceptance tests and model checks

- `does not terminate an empty frontier while completion settlement is pending`
- `settles only the promoted task and preserves unrelated responsibilities`
- `emptyFrontierDoesNotSettleRetainedResponsibility`

## Scenario-to-invariant mapping

| Forbidden result | Durable invariant |
|---|---|
| Replace or delete a claim before durable intent; retry before a read | D21 intent before ambiguity-crossing effects; D22 reconcile before retry |
| Infer tracker success from promotion, an executor report, claim removal, or a mutation acknowledgement | D24 no inferred completion across boundaries |
| Mutate a foreign or stale claim identity | D1 exact identity; D4 exclusive claim; D5 foreign ownership is never mutated |
| Lose the promoted work or restart integration while settlement waits | D10 retention; D16 work preservation; D31 recovery continues the same work |
| Let one task's wait or settlement affect another | D18 subject-local constraints; issue #141 subject-scoped settlement |
| Treat unreadable or incomplete facts as permission | D23 incomplete and unreadable never prove absence |
| Persist process-local target ownership after promotion | D29 authority separation; D30 crash is absence |
| Treat an empty runnable frontier as completion | D34 quiescence is not completion; D35 finality requires every responsibility settled |
