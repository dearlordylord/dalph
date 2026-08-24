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
execution.

The check reports an exact missing registration or missing controlled-contract
evidence and exits unsuccessfully. It does not import the adapter, contact a
tracker, invoke Git, start an executor, write the journal, or take a provider
mutation branch. A process crash and retry do not apply: this is a bounded
read-only source audit with no outside request or durable state to reconcile.
The maintainer sees the failing identity and can register the real contract or
remove the unsupported assembly before continuing.

Acceptance test: `rejects an assembled production layer that is absent from the
registry`, plus `audits source text without loading or invoking a live provider`.

## A maintainer changes an existing registration

Before the action, the inventory contains one entry for each accepted family,
including the three separate disposition authorities for planned worktrees,
planned branches, and quarantined Integrator predecessor candidates. The
controlled and production implementations that exist in this repository are
named by source identity. Completion and the outer Integrator have controlled
evidence but record typed production N/A reasons because their production
boundaries are supplied by the application host and no repository-owned
provider exists. The three cleanup families share the production cleanup
boundary implementation while remaining separate authority records.

The maintainer edits the inventory or composition and runs the focused gate.
The gate first checks the fixed accepted family set, then checks duplicate
families and duplicate identities within a family, controlled/production
contract execution evidence, typed N/A details, source markers, composition
uses, and unregistered exported Layers. It reads no provider and performs no
runtime composition.

For a deleted family, duplicate, stale marker, one-sided contract, or
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
contract test that stops invoking the shared helper`, and `is part of
check:all`.

## Scenario-to-test handoff

| Scenario | Concrete outcome | Passing test or gate seam |
| --- | --- | --- |
| Production adapter added without controlled evidence | The source-backed composition comparison rejects the unregistered exported Layer without invoking a provider. | `rejects an assembled production layer that is absent from the registry`; `runCapabilityRegistrationGate` |
| Production adapter added without controlled evidence | Source auditing remains read-only and dependency-neutral. | `audits source text without loading or invoking a live provider` |
| Existing registration changed | Every current implementation has a contract execution and current source/composition evidence. | `runs every registered controlled and production implementation through its named contract family` |
| Existing registration changed | Missing, duplicate, stale, one-sided, and no-current-consumer mutations fail closed. | `rejects a missing family even when the inventory is otherwise unchanged`; `rejects duplicate family and implementation registrations`; `rejects stale implementation and composition evidence`; `rejects one-sided contract evidence` |
| Existing registration changed | A provider-side contract test cannot silently stop invoking the shared contract helper. | `rejects a production contract test that stops invoking the shared helper` |
| Existing registration changed | The focused gate cannot be omitted from the repository acceptance path. | `is part of check:all`; `pnpm check:all` |
