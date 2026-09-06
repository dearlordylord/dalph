# Issue 79: capability registration gate

This ticket changes repository tooling only. It does not add a Dalph runtime
decision, external call, journal occurrence, provider, or environment-specific
workflow branch. The accepted GitHub issue is the authority for the capability
families and these two maintenance scenarios describe how the checked-in gate
behaves.

## A maintainer adds a production adapter without controlled evidence

Before the action, the maintainer has a checked-out Dalph repository. The
production composition contains the currently selected exported Layers, the
typed inventory names the accepted capability families, and the focused
controlled contract tests are available. No GitHub issue, Git ref, worktree,
executor process, or journal record is changed by this check.

The maintainer adds or assembles an exported production adapter and runs the
capability-registration check. The check reads the authored TypeScript source
files and the checked-in inventory. It compares the exported Layer references
in the listed controlled and production composition sources with registered
implementation identities and explicit support bindings. It also checks that
each registered implementation and contract marker still exists at the named
source location and that every implementation side has a named shared-contract
call. It also checks that the declared implementation identity is the value
consumed by its composition marker, resolving the declaration and runtime
binding rather than accepting a same-name local value. TypeScript source parsing recognizes direct
Layer values, typed Layer values, local aliases, default/namespace exports, and
relative re-exports without executing the source. A contract call is accepted
only when its AST binding resolves to the named shared contract source and its
stable selector (such as cleanup authorization or evidence label) matches.

The check reports an exact missing registration or missing controlled-contract
evidence and exits unsuccessfully. It does not import the adapter, contact a
tracker, invoke Git, start an executor, write the journal, or take a provider
mutation branch. A process crash and retry do not apply: this is a bounded
read-only source audit with no outside request or durable state to reconcile.
The maintainer sees the failing identity and can register the real contract or
remove the unsupported assembly before continuing.

Acceptance test: `rejects an assembled production layer that is absent from the
registry`, `audits exported Layer values without a Layer suffix and through
re-exports`, `audits local aliases, default exports, and namespace/default
re-exports`, plus `audits source text without loading or invoking a live
provider`.

## A maintainer changes an existing registration

Before the action, the inventory contains one entry for each accepted family,
including the three separate disposition authorities for planned worktrees,
planned branches, and quarantined Integrator predecessor candidates. The
controlled and production implementations that exist in this repository are
named by source identity. The GitHub tracker composition registers graph read,
active claim, completion claim, and task completion as four exact families.
The outer Integrator still has controlled evidence and a typed production N/A
reason because no repository-owned provider exists. The three cleanup families
share the production cleanup boundary implementation while remaining separate
authority records.

The maintainer edits the inventory or composition and runs the focused gate.
The gate first checks the fixed accepted family set, then checks duplicate
families and duplicate identities within a family, controlled/production
contract execution evidence, typed N/A details, source markers, composition
uses, and unregistered exported Layers. It reads no provider and performs no
runtime composition. The GitHub active-claim contract now exercises the real
`githubTrackerMutationLayer` and counts as its production implementation edge.
Node target-promotion qualification remains test-only and does not count as a
repository-owned production consumer, so that side retains its
application-supplied N/A reason.

For a deleted family, duplicate, stale marker, one-sided contract, comment or
string-only contract residue, wrong shared-contract binding or selector, or
unconsumed production registration, the gate reports the concrete family or
identity and exits unsuccessfully. It must not silently infer parity from a
filename, restore a repository lock, register TraceReader or Lab layers, or
allow one environment-specific workflow path. A process crash and retry do
not apply because the check has no external mutation or durable write; rerun
simply reads the current source again.

Acceptance tests: `runs every registered controlled and production
implementation through its named contract family`, `rejects a missing family
even when the inventory is otherwise unchanged`, `rejects duplicate family and
implementation registrations`, `rejects stale implementation and composition
evidence`, `rejects one-sided contract evidence`, `rejects a production
contract test that stops invoking the shared helper`, `rejects journal production
when its shared contract edge is removed`, `rejects comment and string residue
when shared-contract execution is removed`, `rejects a local same-name contract
function that is not the imported public contract`, `rejects a destructuring
shadow of an imported shared contract`, `rejects one cleanup family when its
same-helper production call is removed`, `rejects only the removed evidence
implementation call by its label argument`, `runtime value consumption
excludes type-only references`, `rejects a registered implementation identity
that is not consumed by its declared composition`, `rejects implementation
evidence pointed at a consumer instead of its declaration`, `rejects a
same-name local composition value that shadows the registered Layer`, `requires
source-backed support binding evidence and a concrete reason`, `keeps the
required family denominator outside a mutated inventory`. These assertions also
run through `test:coverage` within `check:all`.

## Scenario-to-test handoff

| Scenario | Concrete outcome | Passing test or gate seam |
| --- | --- | --- |
| Production adapter added without controlled evidence | The source-backed composition comparison rejects the unregistered exported Layer without invoking a provider. | `rejects an assembled production layer that is absent from the registry`; `runCapabilityRegistrationGate` |
| Production adapter added without controlled evidence | Multiline direct Layer values and aliased relative re-exports remain source-backed and closed. | `audits exported Layer values without a Layer suffix and through re-exports` |
| Production adapter added without controlled evidence | Local aliases, default exports, and namespace/default re-exports remain source-backed and closed. | `audits local aliases, default exports, and namespace/default re-exports` |
| Production adapter added without controlled evidence | Source auditing remains read-only and dependency-neutral. | `audits source text without loading or invoking a live provider` |
| Existing registration changed | Every current implementation has a contract execution and current source/composition evidence. | `runs every registered controlled and production implementation through its named contract family` |
| Existing registration changed | Missing, duplicate, stale, one-sided, fixed-denominator, and no-current-consumer mutations fail closed. | `rejects a missing family even when the inventory is otherwise unchanged`; `keeps the required family denominator outside a mutated inventory`; `rejects duplicate family and implementation registrations`; `rejects stale implementation and composition evidence`; `rejects one-sided contract evidence` |
| Existing registration changed | A provider-side contract test cannot silently stop invoking the imported shared contract helper or substitute a local same-name function. | `rejects a production contract test that stops invoking the shared helper`; `rejects a local same-name contract function that is not the imported public contract` |
| Existing registration changed | A comment or string containing a helper name cannot substitute for executing the helper call. | `rejects comment and string residue when shared-contract execution is removed` |
| Existing registration changed | Removing one of several same-helper cleanup or evidence calls fails only that family/role through semantic AST arguments. | `rejects one cleanup family when its same-helper production call is removed`; `rejects only the removed evidence implementation call by its label argument` |
| Existing registration changed | Type-only references do not count as runtime Layer consumption. | `runtime value consumption excludes type-only references` |
| Existing registration changed | A valid implementation declaration paired with an unrelated existing composition marker fails closed. | `rejects a registered implementation identity that is not consumed by its declared composition` |
| Existing registration changed | Pointing implementation evidence at a consumer/import file fails because the source must contain the named declaration. | `rejects implementation evidence pointed at a consumer instead of its declaration` |
| Existing registration changed | A same-name local value cannot satisfy a composition; the runtime reference must resolve to the registered declaration. | `rejects a same-name local composition value that shadows the registered Layer` |
| Existing registration changed | Removing the journal suite's direct SQLite shared-contract call fails only the journal production execution. | `rejects journal production when its shared contract edge is removed` |
| Existing registration changed | A destructured local helper shadow cannot satisfy an imported shared-contract execution. | `rejects a destructuring shadow of an imported shared contract` |
| Existing registration changed | Every non-capability support layer has declaration-backed evidence and a concrete reason. | `requires source-backed support binding evidence and a concrete reason` |
| Existing registration changed | Capability assertions remain required by repository acceptance. | `scripts/capability-registration.test.ts` in coverage mode; `test:coverage` within `pnpm check:all` |
