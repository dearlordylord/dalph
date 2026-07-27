# Reducer-lab parity audit

Date: 2026-07-26

## Scope

This inventory compares the browser prototype in
[`prototypes/reducer-lab`](../../prototypes/reducer-lab) with the production
managed-history fold, reconstructed-managed-run reducers, runnable-frontier
selector, admission controller, and finality decision. “Supported” below means
implemented by those production units; it does not imply the still-open
activation loop automatically supplies every required observation.

## Current gaps

| Surface | Production source of truth | Production behavior not exposed by the lab |
| --- | --- | --- |
| Graph knowledge | [`reconstructed-managed-run.ts`](../../packages/orchestrator/src/reconstructed-managed-run.ts), [`reconstructed-managed-run.test.ts`](../../packages/orchestrator/src/reconstructed-managed-run.test.ts) | Repeated arbitrary target-membership observations; compatible replacement; explicitly proven membership change; incomparable membership conflict; focused conflict resolution; multiple tracker targets; revision, coverage, and proven-absence details. The reducer currently retains target membership only, not prerequisite/grouping edges. The lab has one fixed A–D observation and one fixed “B absent” observation. |
| Managed history | [`journal-store.ts`](../../packages/orchestrator/src/journal-store.ts), [`managed-history.ts`](../../packages/orchestrator/src/managed-history.ts) | The event schema has 33 top-level journal tags spanning graph read, claim, attempt planning, worktree, work session, execution, evidence, review, retry, and convergence. The lab constructs only graph intent/outcome and claim intent. It cannot explore invalid position/key/run identity, missing predecessor, duplicate/contradictory intent or outcome, attempt/session mismatch, retry ordering, or terminal-history violations. |
| Reconstructed responsibility | [`reconstructed-managed-run-state.ts`](../../packages/orchestrator/src/reconstructed-managed-run-state.ts), [`reconstructed-managed-run.ts`](../../packages/orchestrator/src/reconstructed-managed-run.ts) | Seven responsibility variants exist: claim, worktree, work session, execution, evidence sealing, implementation review, and review-findings handback. The lab can create only claim responsibility. It also does not show `appliedThrough` or reconstructed invariant failures. Pause is not a missed lab capability: production reconstruction itself still has only `RunUnpaused` and `NoTaskPauses`. |
| Frontier decision | [`runnable-frontier.ts`](../../packages/orchestrator/src/runnable-frontier.ts), [`runnable-frontier-responsibilities.test.ts`](../../packages/orchestrator/src/runnable-frontier-responsibilities.test.ts) | Production accepts nine fresh dispositions. The lab supplies only `Ready`, `ForeignClaimIsolation`, `MissingClaim`, and `Paused`; it omits dependency wait, final outcome, relinquishment, settlement, and unreadable-boundary wait, plus missing/duplicate-facts typed issues. Production can emit nine transition variants; the lab reaches only fresh claim intent, claim check, and claim reconciliation. |
| Admission and finality | [`task-admission-controller.ts`](../../packages/orchestrator/src/task-admission-controller.ts), [`runnable-frontier.ts`](../../packages/orchestrator/src/runnable-frontier.ts), [`runnable-frontier.test.ts`](../../packages/orchestrator/src/runnable-frontier.test.ts) | The lab limits capacity to 1 or 2, supplies no freshly occupied invocation, recreates the controller on every projection, and cannot apply consume/release observations or bind/release reservations. It hard-codes the tracker target as unsettled, so it cannot reach `RunMayTerminate` or distinguish the complete finality matrix. |

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
