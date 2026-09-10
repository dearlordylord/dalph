# Alice sees six distinct ordinary deliveries

## Governing behavior

This independently constructed controlled recording implements the ordinary
B-through-G finality slice accepted in [#277](https://github.com/dearlordylord/dalph/issues/277)
and [#256 DS-21](https://github.com/dearlordylord/dalph/issues/256).
When Git qualifies and promotes each candidate, it preserves
[the reported candidate reaching promotion](issue-223-migrate-promotion-and-finality.md#the-reported-and-git-qualified-candidate-reaches-promotion),
`candidateQualificationRequiresExactParents`, `integratorResourceIsExactlyBound`,
and `promotionIntentPrecedesCompareAndSet` in
[`acceptedResultIntegration.qnt`](../../specs/acceptedResultIntegration.qnt).
When the tracker completes each task and removes its claim, it preserves
`exactProofAndBinding`, `trackerSuccessRequiresFocusedObservation`,
`freshTrackerSuccessPrecedesCompletionClaimDeletion`, and
`settledTaskRequiresExactCleanup` in
[`integrationFinality.qnt`](../../specs/integrationFinality.qnt).
The models and production protocols do not change.

## Starting facts and ordered boundaries

Alice observes Run R with a complete seven-task G5 graph. A is already successful;
its exceptional Integrator history and cleanup are outside this independent
fixture. B/C/D hold three positions with exact claims, planned worktrees, and
autonomously executing attempts. E/F/G are open and unstarted. Git has one target
ref at H. No accepted B-through-G results, integration sessions, completion
claims, or settlements exist initially. The tracker, executor, Integrator, Git,
evidence store, and Journal boundaries are controlled implementations of the
ordinary production workflow. No person commands the terminal executor reports.

B, C, D, E, F, and G report exact Accepted results in that order. Each immutable
result includes its own commit and evidence bytes. The Journal accepts each
report before releasing its task position and establishing its responsibility.
E/F/G reuse the released positions while B's Integrator is still waiting.

Release the six Integrator responses in order. Each call receives its own fixed
session and candidate resource, immutable accepted result, and current expected
head. Git returns the candidate's ordered direct parents `[current head, result]`.
Dalph records the qualification, exact promotion intent and numbered attempt,
then asks Git to compare-and-set precisely that head to that candidate. The next
task uses the preceding promoted candidate as its expected head.

For each task Dalph reads the exact active claim, replaces it with the
promotion-correlated completion claim, reads focused completion premises and
Git ancestry, and reopens its immutable evidence. It records the completion
request intent before asking the tracker to complete the task. An acknowledgement
alone does not prove success: Dalph separately reads and records the focused
`CompletedSuccessfully` observation. Only then does it release the original
active claim and delete the exact completion marker under the existing cleanup
protocol, independently rereading the owning records. It records one delivery
settlement after exact absence is established.

Alice sees six completed tasks and six distinct settled deliveries. This
recording stops at G's settlement: the later post-quiescence graph read and Run
termination belong to #278, and uninterrupted DS-01–DS-22 composition belongs
to #279. DS-21 therefore remains `NotImplemented` in the whole-story manifest.

## Crash, retry, and forbidden results

After B and C settle, cut D after durable terminal acceptance, after the
Integrator result, after promotion intent and success, after the tracker
completion request and acknowledgement, and after completion claim deletion
intent and result. Restart the ordinary application with the same Journal and
outside facts. Retain the exact attempt, result, session, resource, candidate,
promotion, request, and claim identities already fixed. Reconcile an unrecorded
mutation result with its owning boundary before any retry. Resume through D's
settlement with one terminal acceptance, one session, one promotion, one
completion mutation, one exact claim deletion, and one settlement.

Additional boundary holds after completion acknowledgement and after claim
deletion expose the prefixes directly: acknowledgement must not create focused
success or authorize deletion; deleting a marker must not imply active-claim
absence or settlement before the protocol's independent rereads. No live
provider or clock retry is involved; queues and explicit boundary holds control
the outside responses.

Dalph must not reuse another task's identities, force-update Git, infer focused
success from promotion or acknowledgement, infer claim absence from G5, delete
another claim, reopen evidence as mutable output, allocate A's FullRerun path,
or terminate this Run. These preserve the governing model laws above and
delivery invariants D12, D14, D24–D36.

## Scenario-to-test mapping

All tests are in `packages/dalph/test/cassettes/issue-277-distinct-finality.test.ts`.

| Scenario outcome | Acceptance test |
| --- | --- |
| Six distinct ordered ordinary deliveries, focused success and exact deletion before settlement | `settles B through G through distinct Integrator qualification promotion focused success and exact claim deletion paths` |
| Acknowledgement and marker mutation cannot substitute for later owning observations | `waits for focused success and exact claim absence before settling B` |
| Restart preserves D's exact identities at each named boundary | `recovers D after <cut> without duplicating delivery effects` (eight cuts: AcceptedResult, IntegratorResult, PromotionIntent, Promotion, CompletionRequest, CompletionAcknowledgement, ClaimDeletionIntent, ClaimDeletion) |

The tests use the shared six-task runtime wiring in fresh instances with
#277-owned finality observations and crash controls. #276 retains its existing
position-release assertions. Neither fixture invokes the other or treats its
completion as proof for the other issue.

## Implementation evidence

The independent full-slice diagnostic reaches G's settlement with the exact
head chain H → MB → MC → MD → ME → MF → MG. Its assertions bind every offer to
the corresponding Integrator session, ordered direct parents, accepted commit,
and immutable evidence reference. Separate assertions identify all six claim
replacements, completion requests, focused-success reads, original-claim
releases, marker deletions, and settlements, and compare their causal order.

All eight D recovery cases preserve the entire committed prefix. The lost
completion acknowledgement is resolved by a fresh focused tracker-success read;
the already-applied request is not sent again. After a durable deletion result,
restart adds settlement without another finality boundary call. The two B cuts
show that acknowledgement alone and marker deletion alone cannot settle work.

The shared runtime's failure notification is allocated per activation, like its
other process-local owners. A crash checkpoint waits on its explicit notification
instead of racing that notification against the intentionally interrupted process.
This changes only controlled test wiring; production behavior and formal sources
remain unchanged. #276's eight position-release tests and its maintained-observation
test preserve their existing assertions and chronology.

Local domain/spec review checked the exact promotion-to-claim bindings and kept
the full-story manifest deferred to #279. Architecture review confirmed both
fixtures enter the same production activation and use boundary controls only;
no protocol, planner, or persisted authority was copied. Correctness review
added actual Git offers, evidence reads, distinct request identities, the
ordered Journal assertions, and the post-marker active-record check. The
existing mixed #255 candidates were inspected but their A-specific FullRerun
chronology was not imported into this independent ordinary slice.

Focused verification passes all ten #277 cases and all nine retained #276
cases. `pnpm check:fast`, `pnpm check:duplicates`, and `git diff --check` pass.
`pnpm check:quint:changed` reports no governed source/model changes. The
orchestrator owns `pnpm check:all` and full `pnpm check:quint` on the frozen
candidate before integration; this local evidence does not replace those gates.
