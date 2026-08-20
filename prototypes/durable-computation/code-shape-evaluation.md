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
The existing production source guard requires this exact body to remain
unchanged. `domain-colors.test.ts` adds the narrower evaluation assertion that
the production file imports no Workflow implementation and names no Activity
or Workflow engine.

## Shape A: preserve `delivery`, put Workflow below domain ports

The tracer-bullet decision now reads:

```ts
export const recoverCurrentRunDecision = Effect.gen(function* () {
  const claims = yield* ExactTaskClaimRecovery
  const exactClaim = yield* claims.recoverExactClaim
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
    ExactTaskClaimRecovery.recoverExactClaim      recovery action port
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
   engine, two separately constructed Activities with the same name in one
   execution collide: the second yield reuses the first result and never runs
   its own implementation. `domain-colors.test.ts` proves this with independent
   counters. A generic Activity named only `ExecuteAction` is therefore
   incorrect. The candidate claim Activity now includes its exact `OperationId`
   in the name.
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
| Preserve `delivery`; Workflow fits cleanly below existing ports. | The full action set obtains stable durable identities/results without changing protected compositions or duplicating continuation. | Not supported by the issue #233 closed loop: the current input requires a privately Journal-branded graph observation, so the candidate retains custom translation machinery. |
| Preserve `delivery` with named architectural adjustments. | A small Workflow-backed action/establishment adapter is needed, while descriptions, planning, and live ownership remain intact. | Best fit to current evidence. Stable action naming, provider-neutral accepted-observation input, and replay publication are explicit adjustments. |
| Workflow cannot fit the coloured architecture. | An accepted behavior requires Workflow/storage concepts in description or requires Dalph to rebuild a durable engine around Workflow. | Rejected for the tested tracker-read family: unchanged description and planning completed the real runtime loop. |
| Workflow can and should replace `delivery` with its own readable model. | A Workflow-native composition expresses the same description, planning, concurrency, ownership, Exit, and stabilization meaning more clearly and deletes more machinery than it recreates. | Valid fallback, but current evidence shows a substantially larger architectural fork and no necessity for it. |

## Scenario-to-test mapping

| Concrete outcome | Test |
| --- | --- |
| GitHub applies the claim, the reply is lost, and the successor checks the exact claim without a second create. | `checks GitHub after the Workflow Activity loses its response and does not repeat the request` |
| The successor asks GitHub for current task facts before deciding. | `reads fresh GitHub facts when Workflow replays after ordinary downtime` |
| The domain composition says reconcile, refresh, and decide without Workflow/storage vocabulary. | `expresses the recovered decision without Workflow or storage vocabulary` |
| A foreign or absent exact claim stops before the current-decision read. | `waits without refreshing task facts when the exact claim cannot be reconciled` |
| The protected seven-line description remains outside Workflow; production's existing exact source guard continues to own its body. | `keeps Workflow vocabulary out of the seven-line delivery description`; `keeps quiescence probes out of action planning and former scheduler runtime code` |
| Repeated durable actions cannot share one generic Activity name. | `requires one stable Activity name per durable domain action` |

## Issue #233 real runtime result

The production-shaped extension closes Shape A through the actual seam rather
than the miniature recovered-decision composition:

```text
controlled tracker facts
  → unchanged delivery
  → ordinary delivery-action planning
  → process-local admission and ownership
  → DeliveryActionExecutor
  → exact OperationId-named Activity
  → schema-decoded accepted tracker result
  → ordinary current delivery input
  → proposal disappears or advances
```

The Workflow handler encloses the ordinary delivery program. That placement
lets `DeliveryActionExecutor.execute` yield the durable Activity inside the
same exact Workflow execution. Two sequential actions therefore exercise the
known collision domain directly; they are not hidden behind one Workflow per
action.

The only custom continuation/publication machinery exposed by the loop is the
translation from a schema-decoded Activity result to the current
`JournaledTrackerGraphObservation` input. The experiment constructs that brand
through a process-local in-memory Journal. This persists no duplicate state,
but it is architectural duplication: a Workflow adapter should not have to
pretend its accepted result was journaled. A provider-neutral accepted
tracker-observation type would let both Journal and Workflow adapters publish
the same domain fact without weakening authority or persisting a derived
frontier.

The final standards review suggested one shared closed-loop runner for the
Workflow and Journal arms. This experiment deliberately retains separate
top-level runners because the comparison includes where each adapter
reconstructs or rereads facts; hiding those sequences behind one injected
callback would make that architectural difference harder to inspect. Shared
identity allocation and the current-facts decision are defined once, while
adapter-specific chronology remains side by side. This accepted duplication
is prototype evidence, not a production organization recommendation.

| Concrete issue #233 outcome | Test |
| --- | --- |
| A killed child resumes one execution, reuses one stored Activity result, republishes it, and removes the real proposal without a second boundary read. | `reuses the stored action result after restart, republishes its accepted fact, and does not call the boundary twice` |
| A fact changed during downtime is learned from the controlled tracker after replayed publication and supplies the `StopOutsideTarget` decision. | `reads current facts after replayed publication before the next current-state decision` |
| Two exact materialized operation identities survive separate crash cuts and never reuse each other's result. | `keeps two delivery actions distinct through Workflow and republishes each matching result` |
| Journal and Workflow histories differ while accepted action/result correlations, final proposal state, and current-facts decision agree. | `projects the same delivery consequences through the Journal baseline and Workflow adapter` |
| Suppressing publication leaves the proposal present; a generic Activity identity correlates operation 2 with operation 1's result. | `records the suppressed replay-publication negative control`; `records the generic Activity-identity negative control` |
| Workflow and storage terms remain absent from the exact description and action planning. | Existing seven-statement source guard; `keeps Workflow and storage vocabulary out of delivery action planning` |
