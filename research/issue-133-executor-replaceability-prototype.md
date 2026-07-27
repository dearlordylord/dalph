# Issue #133 executor replaceability prototype evidence

Date: 2026-07-27

Branch: `prototype/issue-133-replaceability`

## Questions

1. Can a materially different second executor be selected without editing
   generic frontier, admission, or reconstruction modules?
2. What is the smallest seam that would let a future executor be installed
   without editing `managed-activation.ts`?
3. Can ESLint prevent generic orchestration from importing the selected
   executor adapter or its evidence/review/convergence internals?

## Verdict

Not completely in the current implementation.

`reconstructed-managed-run.ts` already receives an
`ExecutorReconstructionProtocol`, and `runnable-frontier.ts`,
`runnable-transition-recovery.ts`, `activation-coordinator.ts`, and
`task-admission-controller.ts` operate on executor outer invocations. Those
parts accepted the direct/no-review executor shape without changes.

Two source-level selections remain:

- `managed-history.ts` imports `selectedExecutorReconstructionProtocol` and
  passes it to `reconstructManagedRunState`.
- `managed-activation.ts` imports the selected projection, recovery, recovered
  stage, and task-execution lookup functions.

Therefore a second protocol cannot be installed today without editing one or
both of those modules. The issue #133 outer types are coarse enough for the
prototype's materially different executor: it declares only task-execution
invocations, consumes one task-work capacity position, and finishes immediately
after implementer exit. It has no evidence sealing, reviewer, findings
handback, semantic convergence, or executor retry-deadline stages.

## Minimal seam worth implementing

Move protocol choice to application composition and inject one
`ExecutorProtocol` bundle into managed-history reduction and managed
activation. The bundle needs to own:

- pure journal-to-responsibility reconstruction;
- pure outer projection;
- recovery of one exact outer invocation;
- recovered executor-owned stages and their runners;
- current resource-occupancy observation for declared outer resource use; and
- selected-protocol journal validation that currently remains in
  `managed-history.ts`.

The throwaway `executor-protocol.ts` demonstrates the first four items and
compiles both current and direct/no-review adapters against one generic kernel.
It deliberately does not claim production readiness: its error channels are
`unknown`, it does not extract the selected protocol's journal validation, and
it does not yet move capacity observation behind the bundle.

For the production change, keep the pure reducer pure. Prefer a factory such as
`makeManagedHistoryReducer(protocol.reconstruction, protocol.validation)` plus
an Effect service or captured protocol value for activation. Do not make a pure
reducer read an Effect service.

An executor registry belongs at composition. A configured executor name can
select the bundle once when one run permits only one executor. If planned
attempts in one run may use different `TaskExecutorLocator` values, a run-global
bundle is insufficient: the registry must resolve the protocol per invocation.
The current outer correlation contains task and invocation identities but no
protocol key. The cheapest honest choices are:

1. initially declare one configured executor protocol per run; or
2. add an executor-protocol key to the outer invocation/correlation and resolve
   it through a composition-owned registry.

That choice overlaps issue #127 and should be recorded there rather than
silently decided inside `managed-activation.ts`.

## ESLint result

ESLint's core `no-restricted-imports` rule is sufficient. A flat-config override
can name the generic modules and reject:

- `**/selected-executor-protocol.js`;
- `**/implementation-evidence*.js`;
- `**/implementation-review*.js`; and
- `**/implementation-convergence*.js`.

The good fixture importing only `executor-boundary.ts` passed. The bad fixture
importing `selected-executor-protocol.ts` failed with the intended message.

Running the same rule over the proposed generic module set exposed three current
violations:

- `managed-activation.ts` imports `selected-executor-protocol.ts`;
- `managed-history.ts` imports `selected-executor-protocol.ts`; and
- `managed-history.ts` imports `implementation-convergence.ts`.

This rule should be integrated only with the production seam refactor so it
does not require a temporary suppression. An exact `files` list is preferable
to a broad directory rule because the selected adapter intentionally imports
its internals.

## Commands and results

```text
pnpm install --offline --frozen-lockfile
PASS (620 packages reused; expected missing built dalph-bin warning)

pnpm exec tsc -p prototypes/issue-133-executor-replaceability/tsconfig.json --pretty false
PASS

pnpm exec eslint --no-config-lookup --config .../eslint.config.mjs .../generic-good.ts
PASS

pnpm exec eslint --no-config-lookup --config .../eslint.config.mjs .../generic-bad.ts
EXPECTED FAIL: one no-restricted-imports error

pnpm exec eslint --no-config-lookup --no-inline-config --config .../eslint.config.mjs \
  packages/orchestrator/src/{activation-coordinator,managed-activation,managed-history,reconstructed-managed-run,runnable-frontier,runnable-transition-recovery,task-admission-controller}.ts
EXPECTED FAIL: three boundary violations, all in managed-activation.ts or managed-history.ts
```

No full gate or review loop was run; this branch is disposable architecture
evidence.
