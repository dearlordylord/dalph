# Handoff: implement the executor boundary in issue #133

> Historical note: issue #133 is closed, and reopened issue #131 supersedes
> this handoff's executor-declared capacity wording. Dalph now owns each task's
> zero-or-one capacity requirement. For example, an executor reports provider
> lifecycle but never asks Dalph to reserve a position.

Use the `implement`, `domain-modeling`, `effect`, `property-based-testing`, and
`code-review` skills only after the accepted issue #132 implementation and
validation result exists.

## Objective

Implement [Place evidence and review behind the executor boundary](https://github.com/dearlordylord/dalph/issues/133).
The current evidence-, review-, and handback-specific orchestration symbols are
transitional migration input, not the specification. The live issue warning
and local source comments name the affected symbols.

The main control document is
[the issue #131 uncertainty audit](../issue-131-uncertainty-audit.md).

## Required result

- Generic frontier, admission, reconstruction, and activation modules contain
  no evidence-sealing-, implementation-artifact-, review-, reviewer-,
  findings-, or handback-specific transitions or responsibilities.
- The selected executor protocol owns review strategy, internal restoration,
  and artifacts.
- The orchestrator sees only executor-declared outer invocations, waits,
  correlations, interruption/continuation behavior, capacity use, and outcomes.
- Capacity follows declared outer resource use rather than operation names.
- Existing same-session handback, fresh-reviewer, retry-scope,
  non-convergence, and evidence behavior remains proven behind the adapter.
- Transitional comments disappear with the transitional symbols.
- Update the canonical specification, frontier-recovery Quint model, executable
  adapter, readable scenarios, and applicable in-memory/SQLite reopening lanes
  atomically.
- Run all three mandated review passes and `pnpm check:all`.

Return commits, the old-to-new type mapping, exact model/MBT evidence, focused
and full gate results, review dispositions, and proof that no generic module
retains evidence-, review-, or handback-specific vocabulary. This result is
required before issue #62 and therefore before pause issues #134/#135.
