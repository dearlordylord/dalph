# Durable-computation evaluation

This disposable prototype evaluates issue #232 from the exact base
`d4128e475ddfdda6970ac7951ce7696d7736685a`. It changes no Dalph production
runtime and is not an adoption vehicle.

The evaluation order is fixed:

1. [Responsibility inventory](responsibility-inventory.md)
2. [Shared harness contract](harness-contract.md)
3. Journal baseline adapter
4. SQL-backed Effect Workflow-only adapter
5. [Comparative evidence](evidence.md)
6. [Domain-coloured code-shape evaluation](code-shape-evaluation.md)

The current Journal and the candidate receive the same exact identities,
controlled outside-world facts, fault script, provider-call ledger, and
canonical semantic trace contract. No adapter calls GitHub, a target Git
repository, or an executor.

Passing the experiment supplies evidence for the project owner's step-4
decision. It does not authorize merging this branch, changing Dalph's stable
architecture, removing the Journal, or adopting Effect Workflow.
