# Reducer-lab parity audit

Date: 2026-07-26

## Scope

This inventory compares the browser prototype in
[`prototypes/reducer-lab`](../../prototypes/reducer-lab) with the production
managed-history fold, reconstructed-managed-run reducers, runnable-frontier
selector, admission controller, and finality decision. “Supported” below means
implemented by those production units; it does not imply the still-open
activation loop automatically supplies every required observation.

## Current parity status

| Surface | Production behavior now exposed by the Lab | Remaining explicit boundary |
| --- | --- | --- |
| Graph knowledge | Arbitrary task-card CRUD on two independent controlled tracker targets, repeated explicit observations, invalid topology failures, latest successful topology, controlled authority topology, durable membership conflicts, revision, coverage, proven absence, and observation position. | The two-target fake exercises the production target-closure model; it is not a provider-specific GitHub-project editor. |
| Managed history | The accepted path and production task-work lookup/start failures, executor request/observation failures, failed/interrupted/resource-emergency outcomes, semantic findings and handback, rework, and bounded technical retries all cross the production journaled interpreter. Authenticated pause/unpause requests produce `ControlCommandRecorded`. | `TaskWorkSessionResultReported` remains excluded because current production has no workflow operation that reads this result (issue #29). Raw malformed journal injection is intentionally not a UI command because the Lab driver must not invent events. |
| Reconstructed responsibility | All four current production responsibility variants are created by executable scenarios, retain exact operation identity, display `appliedThrough`, and accept every production disposition. After crash/restart, the coordinator control routes the journal prefix through production `activateRecoveredResponsibilities` to quiescence. | The Lab exposes operation-boundary crash points; it does not split one synchronous fake adapter call between intent and outcome. |
| Frontier decision | Every responsibility disposition is interactive, including dependency wait, tracker final outcome, relinquishment, settlement, unreadability, executor retry wait, and executor settlement. Missing and duplicate fresh-fact cardinalities reach the production typed-issue explanation. Fresh `CommitFreshTaskClaimIntent`, `ContinueFreshWorkflowOperation`, and `StartExecutorInvocation` are executable. Exact operation identities prevent simultaneous responsibilities from collapsing into one button. Production recovery transitions are visible and the recovery coordinator can execute the selected recovery frontier. | Raw contradictory fact payloads remain outside the UI; cardinality and every production disposition are controlled separately. |
| Admission and finality | Capacity 1–3, exact reconstructed reservations, capacity waits, target settlement, `RunMustRemainActive`, and `RunMayTerminate` are interactive. | Live capacity resizing remains outside current production behavior. |
| Control commands | Run/task pause and unpause requests invoke the authenticated production control service and enter the journal. | Production reconstruction still returns `RunUnpaused` / `NoTaskPauses`; the Lab does not fabricate application of the requested direction. |

## Fail-closed parity design

Do not make the FoldKit view construct journal events. Put a browser-safe
exploration driver beside the production workflow algebra. The driver should:

1. Own controlled tracker, Git, task-work-provider, and executor authority
   states; expose generic commands such as edit authority, observe, activate one
   selected operation, crash, restart, and change capacity.
2. Invoke the real [`WorkflowInterpreter`](../../packages/orchestrator/src/workflow.ts)
   and reducers so that valid journal events are consequences, not UI-authored
   fixtures.
3. Export `availableCommands(state)` plus a schema-typed projection. FoldKit
   renders this command inventory instead of maintaining a separate handwritten
   button list.

Add exhaustive coverage registries using mappings such as:

```ts
type Coverage<Union extends { readonly _tag: string }> = {
  readonly [Tag in Union["_tag"]]: {
    readonly status: "Interactive" | "Observable" | "IntentionallyExcluded"
    readonly reason?: string
  }
}
```

Require registries for `WorkflowOperation`, `WorkflowJournalEvent`,
`WorkflowResponsibilityEntry`, `ResponsibilityDisposition`,
`RunnableFrontierTransition`, `FrontierExplanation`, and
`RunFinalityDecision`. A new union tag then causes a TypeScript failure until it
is classified.

Finally, add three proportional gates to the maintained exploration driver,
not to the disposable view:

- every production union tag is classified;
- every `Interactive` item has a driver scenario that reaches it, and every
  `IntentionallyExcluded` item has a reason;
- the driver builds for the browser without a Node-platform shim.

The final gate matters now: importing the pure fold reaches a static
`@effect/platform-node` import through the all-events/evidence dependency
chain. The current prototype shims that unused import. A browser-safe production
core must remove the shim before the driver can be an authoritative shared
surface.

## Recommendation

Keep the FoldKit UI throwaway. Maintain the browser-safe exploration driver,
capability registry, and parity tests as production test-support. This preserves
one workflow algebra while allowing the visual design to change freely. It also
distinguishes automatic behavioral parity—provided by calling the real
driver—from meaningful presentation, which still requires human design.
