# Alice still sees the admitted cleanup while nested release adds recovery work

## Starting facts and trigger

Alice's built production command has promoted the real merge M and acknowledged
task completion. The integration responsibility was queued at position 21 and
started at 22. One live, witness-admitted `DeleteCompletedTaskCompletionClaim`
action is still executing. Its original IntegrationOrder has frontier ordinal 0.

That outer cleanup invokes the ordinary nested release protocol. SQLite
acknowledges `TaskClaimReleaseIntended` at position 47 for
`CompletionOriginalClaimRelease`, using the exact claim acquired at 7 and the
acquisition/completion predecessors. Its result is not yet acknowledged.

The actual controller diagnostic proves that the next frontier contains
`ReconcileTaskClaimRelease` at listing position 0, followed by the still-needed
outer `DeleteCompletedTaskCompletionClaim` at 1. The same-ID owner/current
proposal pair has equal route, action identity, payload, wait, admission and all
other fields. Their IntegrationOrder has equal task, queuedAt 21 and startedAt
22; only its current listing position changes. The original complete opaque
admission witness remains valid. Nevertheless, the current comparison emits
`status.projection_conflict`, and Alice's command exits one before Run termination.

## Governing distinction

The integration frontier listing position is the current transition-list index,
not an integration responsibility ordinal or a Journal occurrence. The durable
integration task, queue/start positions and operation facts remain distinct.
This accepted #339 presentation repair preserves #300's exact original witness
and every causal identity/field. It permits only the proven current-listing
movement for matching IntegrationOrder proposals. Existing Graph/Recovered
evaluation-position rules and strict responsibility ordinals remain unchanged.
No workflow frontier, admission, recovery, retry or model transition changes.

The owner/current comparison is not an independent validator of the current
list's ranking algorithm. A well-typed different current listing index does
not change the action already admitted. Its original index stays bound by the
complete original witness. No parallel rank-attestation map or persisted
frontier/UI state is introduced for this read-only comparison. Validation of
actionable external ordering, if ever introduced, belongs at its ingestion or
admission boundary, not here.

## Ordered calls and visible result

1. The release protocol acknowledges its ordinary intent, then continues the
   already admitted outside call. Status reading neither invokes nor retries it.
2. The current frontier truthfully includes the new release reconciliation and
   still-needed outer cleanup. Neither is deleted to evade a status check.
3. The passive status boundary validates the original opaque witness against
   the entire original proposal, including its captured listing position.
4. It recognizes the unchanged cleanup action despite its changed current
   listing position. Task, queue/start positions, route, action identity, payload,
   wait, admission and all other causal/order fields remain exact.
5. Alice sees the original live cleanup and truthful current waiting/work facts.
   The existing protocol acknowledges the actual release/cleanup successor and
   independently proves completion or continued waiting. Status does not select
   success or fabricate an observation.

Crash/restart still reconciles the generic release responsibility before retry.
No live GitHub calls apply to this controlled fixture. A listing change grants
no permission to repeat a mutation, adopt a resource or infer completion.

## Scenario-to-test mapping

- Actual outer cleanup/nested release → a runtime test acknowledges the exact
  release intent while its original call is held; proves ordered reconciliation
  plus outer cleanup, a valid unchanged witness, coherent status and one call.
- Listing insertion/removal → focused projection tests permit genuine current
  IntegrationOrder listing movement without changing its task/queue/start facts.
- Forged/copied/rebound original witness or changed task/queue/start/route/action/
  payload/wait/admission → focused negative tests still report conflict.
- Different order tags, malformed/duplicate proposal records and changed
  RecoveredWorkflowOrder responsibility ordinal → existing negative cases remain.
- Complete ordinary command → #339's real SQLite/Git controller reaches actual
  CAS, M parents H,C and protocol-proven terminal output without projection failure.
