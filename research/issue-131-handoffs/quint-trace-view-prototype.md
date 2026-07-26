# Handoff: prototype a Quint trace explanation view

## Objective

Build a half-day, throwaway prototype that answers one decision: can a
frame-by-frame table plus one generated visual explain Dalph's existing
frontier-recovery Quint traces more clearly without becoming a second state
machine or correctness authority?

This is prototype/test tooling only. Do not change production orchestration,
production domain types, issue dependencies, or CI gates.

## Start here

Read these in order:

1. [The main control document](../issue-131-uncertainty-audit.md)
2. [The Effect Analyzer and Quint evaluation](../effect-analyzer-quint-evaluation.md)
3. [The canonical frontier specification](../../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md)
4. [The frontier-recovery Quint model](../../specs/frontierRecovery.qnt)
5. [The production comparison projection](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-projection.ts)
6. [The reconstruction MBT driver](../../packages/orchestrator/test/frontier-recovery/frontier-recovery-reconstruction.mbt.test.ts)

Follow the repository `AGENTS.md`. Use pnpm. Work in a temporary directory or
isolated prototype worktree. Do not add `effect-analyzer` to Dalph dependencies.
If used, pin exactly `effect-analyzer@2.1.0`.

## Required prototype

Use existing Quint ITF output and the existing closed Dalph conformance
projection. Do not derive Quint from Effect source and do not compute legal
transitions in the viewer.

Produce:

1. a schema-decoded normalized frame per ITF state containing the step, action,
   picked task, coordinator status, capacity, frontier, admission, occupied and
   reserved operations, exact explanation tags, and optional
   model/implementation comparison;
2. a simple step table;
3. one visual rendering from the same normalized frames, preferably
   MachineJSON through Effect Analyzer to Mermaid or SVG;
4. one normal sampled trace, one restart trace, and one counterexample trace;
5. tests proving frame-to-ITF and frame-to-existing-MBT-projection equality;
6. failures for an unknown action, malformed identity, lossy integer, and a
   deliberately removed decision-bearing field; and
7. provenance on every artifact: Dalph/model revision, projection version,
   Quint version, init, step, seed, and trace kind.

Use `S0`, `S1`, and so on as display positions. Never call one sampled path
“the state machine.” Keep the raw ITF state inspectable.

## Decision criteria

Return table and visual side by side. Recommend a durable visualization format
only if the visual is materially clearer than the table and every displayed
value traces to one decoded field. Otherwise recommend the table.

The prototype is not model checking, MBT, or a production design. A readable
picture is not proof of correctness.

## Required return

Return:

- paths or a commit containing the isolated prototype and fixtures;
- exact pinned commands and versions;
- test output for all positive and fail-closed cases;
- normalized output for all three trace kinds;
- table and visual artifacts;
- performance observations;
- a fidelity statement listing projected-away fields and unsupported inputs;
- a recommendation for visualization adoption; and
- an explicit statement that no production or CI dependency was introduced.

Do not decide whether Dalph should adopt Effect Analyzer for source analysis.
That is a separate later decision requiring the seven Decision B results in
[the research evaluation](../effect-analyzer-quint-evaluation.md), including
diagnosis of the incomplete whole-directory audit and one demonstrated unique
review finding.
