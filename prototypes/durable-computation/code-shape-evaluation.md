# Effect Workflow and Dalph function colours

## Evaluation boundary

The concrete behavior remains the accepted issue-232 chronology. GitHub
applies one exact task claim, Dalph loses the reply and stops, and a new process
checks the task tracker before deciding whether to repeat the request. No Git
worktree is created and no executor is started because the chronology stops at
the current tracker decision.

This extension changes no Dalph runtime behavior. It asks whether the same
tested behavior can be written so that a reader sees Dalph's domain steps while
Effect Workflow remains an implementation of durability. The existing
child-process tests remain the behavioral acceptance seam. The additional
source-shape tests reject an apparent success that leaks Workflow or storage
vocabulary into the protected description.

## The standard being preserved

Current `master` describes delivery in seven statements:

```ts
export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
```

Every line is description-coloured. Planning, reconciliation, action, runtime,
establishment, and stabilization stay behind separately named compositions.
The source guard in `domain-colors.test.ts` imports the production file from
the pinned worktree and requires this exact body to remain unchanged.

## Shape A: preserve `delivery`, put Workflow below domain ports

The tracer-bullet decision now reads:

```ts
export const recoverCurrentRunDecision = Effect.gen(function* () {
  const claims = yield* ExactTaskClaimReconciliation
  const exactClaim = yield* claims.exactClaim
  if (exactClaim === null) return "Wait"

  const tasks = yield* CurrentTaskFactsRefresh
  const current = yield* tasks.currentTaskFacts
  return current.lifecycle === "Open" && current.targetMember ? "ContinueSameRun" : "Wait"
})
```

That module imports only `Effect`, the exact claim type, and the recovered
decision type. It has no Workflow, Activity, SQL, Journal, cluster, fault, or
storage vocabulary. A controlled test supplies ordinary Effect services and
proves the visible ordering: reconcile the exact claim, then read current task
facts, then decide.

The Workflow adapter supplies those ports:

```text
Dalph Run Workflow handler                         infrastructure/runtime
  recoverCurrentRunDecision                       domain composition
    ExactTaskClaimReconciliation.exactClaim       reconciliation port
      ReconcileExactTaskClaimV1/<OperationId>     durable Activity
    CurrentTaskFactsRefresh.currentTaskFacts      fresh owning-boundary read
```

The Activity still contains the difficult rule: read the exact claim, create
only when absent, disable interruption retries, and check again after an
unknown result. The current-facts read deliberately remains outside a stored
Activity result so replay asks the task tracker again.

For the full production architecture, the corresponding intended placement is:

```text
delivery                                           description, unchanged
  -> deliveryActionPlanning                       planning, unchanged
  -> runDeliveryRuntimePhase                      runtime/live ownership, unchanged
       -> DeliveryActionExecutor                  action-coloured port
            -> named Workflow Activity            durable invocation/result
                 -> existing typed leaf protocol  reconciliation/action
```

The Run Workflow would be runtime assembly around the ordinary activation, not
a replacement domain language. Process-local signals, proposal frontiers,
admission positions, fibers, live owners, and resource leases would not become
Workflow payloads or results.

### Constraints exposed by the executable spike

1. **One stable Activity identity per durable domain action.** In the pinned
   engine, invoking the same Activity name twice in one execution reuses the
   first result. `domain-colors.test.ts` proves this with a counter: two yields
   of `ExecuteDomainAction` execute once and both observe result `1`. A generic
   Activity named only `ExecuteAction` is therefore incorrect. The candidate
   claim Activity now includes its exact `OperationId` in the name.
2. **Replay must republish accepted domain facts.** Reusing an Activity result
   is not enough. The adapter must publish the decoded claim, attempt, Git, or
   integration result through the same current domain input that causes the
   proposal to disappear. Persisting the derived proposal or frontier would
   violate the architecture.
3. **Fresh facts stay fresh.** A tracker, Git, or executor observation required
   for a current decision cannot be replaced by an old Activity result. The
   accepted downtime tests still prove a later tracker read.
4. **Live ownership stays process-local.** Workflow continuation does not
   restore a resource lease, admission reservation, fiber, worktree handle, or
   executor process. A new activation establishes those through the existing
   runtime protocols.
5. **Exit remains outside the Run.** The process-wide cutoff admits no new
   action after Exit. A later explicit process start may resume the unfinished
   execution; Workflow cannot keep progressing in a surviving background
   runner.
6. **Code evolution is an infrastructure obligation.** Stable domain action
   identity and serialized schemas need explicit compatible routing. The
   prototype still fails closed when version B renames the stored claim step.

Shape A is therefore credible for the tested chronology. It is not yet proof
that every production delivery route can be converted mechanically: each
materialized action needs a stable durable identity and a schema-decoded result
that can be republished without recreating the Journal.

## Shape B: Workflow replaces `delivery`

Workflow could instead become the visible delivery model. A readable version
would resemble:

```ts
const runDelivery = Effect.gen(function* () {
  const graph = yield* refreshCurrentTrackerGraph
  const actions = deliveryActionsFor(graph)
  const results = yield* Effect.forEach(actions, executeDurableAction)
  return yield* settleDelivery(results)
})
```

This is a real verdict option, not a prohibited design. It may become the right
answer if Workflow cannot durably drive the existing runtime without duplicate
continuation machinery.

It is currently the larger fork for concrete reasons:

- the current graph is a changing signal, not one replay-stable snapshot;
- current `delivery` describes frontier, bounded tickets, responsibilities,
  settlement, and tracker reflection without performing an action;
- planning separately proves order, conflicts, isolation, and resources;
- runtime separately owns bounded admission, concurrent fibers, Exit, and
  quiescence; and
- replacing `delivery` would have to re-express all those semantics in a
  Workflow-native loop, not merely give the seven lines different syntax.

The replacement sketch is shorter only because those obligations are hidden
inside its four called functions. It becomes preferable only if those
functions remain equally domain-coloured and Workflow eliminates more runtime
machinery than the rewrite duplicates.

## Four verdicts

| Verdict | Evidence required | Current result |
| --- | --- | --- |
| Preserve `delivery`; Workflow fits cleanly below existing ports. | The full action set obtains stable durable identities/results without changing protected compositions or duplicating continuation. | Supported by the claim tracer bullet, not yet proven for every action family. |
| Preserve `delivery` with named architectural adjustments. | A small Workflow-backed action/establishment adapter is needed, while descriptions, planning, and live ownership remain intact. | Best fit to current evidence. Stable action naming and replay publication are explicit adjustments. |
| Workflow cannot fit the coloured architecture. | An accepted behavior requires Workflow/storage concepts in description or requires Dalph to rebuild a durable engine around Workflow. | Not observed in the tracer bullet. |
| Workflow can and should replace `delivery` with its own readable model. | A Workflow-native composition expresses the same description, planning, concurrency, ownership, Exit, and stabilization meaning more clearly and deletes more machinery than it recreates. | Valid fallback, but current evidence shows a substantially larger architectural fork and no necessity for it. |

## Scenario-to-test mapping

| Concrete outcome | Test |
| --- | --- |
| GitHub applies the claim, the reply is lost, and the successor checks the exact claim without a second create. | `checks GitHub after the Workflow Activity loses its response and does not repeat the request` |
| The successor asks GitHub for current task facts before deciding. | `reads fresh GitHub facts when Workflow replays after ordinary downtime` |
| The domain composition says reconcile, refresh, and decide without Workflow/storage vocabulary. | `expresses the recovered decision without Workflow or storage vocabulary` |
| A foreign or absent exact claim stops before the current-decision read. | `waits without refreshing task facts when the exact claim cannot be reconciled` |
| The protected seven-line description remains outside Workflow. | `keeps the seven-line delivery description outside Workflow` |
| Repeated durable actions cannot share one generic Activity name. | `requires one stable Activity name per durable domain action` |

