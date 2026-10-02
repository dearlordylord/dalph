# Development harness

Use pnpm and Node 24.20.0. [package.json](../package.json)
`engines.node` defines supported versions; CI tests each declared minimum.
Before adding a Node major, prove a frozen install and the production exclusive
coordinator lock in [ARCHITECTURE.md](ARCHITECTURE.md). Require a matching native
binary or an explicitly supported source-build toolchain.

## Operational scenario gate

Before behavior-changing work, follow [OPERATIONAL-SCENARIOS.md](OPERATIONAL-SCENARIOS.md):
accepted chronological scenarios precede implementation; plans and handoffs map
each scenario to tests. Documentation/tooling exemptions must explain why no
Dalph runtime behavior changes. Aggregate gate totals cannot replace this proof.

## Find the owning guidance

Read the section for the boundary you are changing, then follow its concrete
scenario and test links. Reuse guidance already read unless its owner changed.

| Task | Owner |
| --- | --- |
| Keep implementation and failure diagnosis finite | [Development workflow](development/workflow.md#keeping-implementation-work-finite) |
| Select focused checks or qualify a candidate | [Choosing checks](development/checks.md#choosing-checks) |
| Find a command and its preparation requirements | [Commands](development/commands.md#commands) |
| Inspect retained failure evidence, stop writers, or reconcile custody | [Gate custody](development/gates.md#heavy-gate-admission) |
| Prepare source imports, package declarations, or built CLI fixtures | [Artifacts](development/artifacts.md#current-source-and-built-artifacts) |
| Install browsers and prepare real-host checks | [Browser setup](development/browser.md#browser-and-real-host-setup) |
| Run protected live qualification | [Live qualification](development/live.md#protected-disposable-live-qualification) |
| Create and dispose of a production walkthrough | [Walkthrough](development/walkthrough.md#disposable-production-repository-walkthrough) |
| Supervise a Dalph-on-Dalph delivery | [Own-repository Dogfood](development/own-repository-dogfood.md) |
| Interpret coverage and retained output | [Coverage](development/coverage.md#coverage-and-output-budgets) |
| Request formal proof or inspect its applicability | [Formal verification](development/formal.md#formal-reuse-and-handoff) |
| Change CI, lint, supply-chain, or check-selection policy | [Harness policy](development/harness.md#safety-and-supply-chain) |

[Repository navigation](NAVIGATION.md) maps behavior and tooling to their owners.
Git preserves superseded instructions; the working tree contains current guidance.
Qualification evidence names its exact candidate and tested boundary; it never
qualifies a later candidate merely because the earlier command passed.

This organization and the documentation checker change no Dalph runtime behavior:
they neither select workflow actions nor call providers, Git task adapters, or
the Journal. Accepted scenarios and their required proof remain in their owners.
