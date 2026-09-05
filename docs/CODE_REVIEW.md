# Code review checklist

Review the fixed candidate against accepted behavior/tooling requirements and
repository constraints. Reviewers report findings without editing it.

## Operational scenario gate

Apply [OPERATIONAL-SCENARIOS.md](OPERATIONAL-SCENARIOS.md) to the accepted issue,
specification, scenarios, tests, and handoff together. Missing chronological
scenarios or scenario-to-test mappings block behavior-changing work. Check
changed behavior is covered, governing-behavior pointers are valid, causal and
forbidden outcomes are proved, and documentation/tooling exemptions explain why
no runtime behavior changes. Aggregate totals are not scenario evidence.

## Implementation checklist

- **Language:** apply the [literal reading test](DEVELOPMENT.md#domain-language).
  Name the actor, action, state change, and boundary before canonical shorthand.
  Define abstract terms concretely or replace them.
- **Boundaries and failures:** parse tracker, executor, Git, configuration, and
  journal data with Effect Schema; branded values flow inward. Expected failures
  remain precise typed Effect failures; throws are defects or unavoidable bootstrap failures.
  Production casts/non-null assertions are forbidden except evidenced, narrowly
  suppressed casts at a named external decoding boundary.
- **Effect and tests:** follow Effect V4 architecture. Substitute services with
  Layers, not module patches or real sleeps. Tests prove behavior rather than
  restating compile-time guarantees; directly assert required counts, order,
  identities, correlations, and absence at boundaries/durable records.
- **One workflow:** dry-run, deterministic tests, partial integration, and
  production select the same workflow operations. Layers choose real/simulated
  boundary implementations for `WorkflowInterpreter`; simulated results must
  not select alternate operations. Controlled adapters may exercise production
  protocol code. A composition that can change external state must record intent
  at that boundary and claim only guarantees its implementations provide.
- **Facts and state:** trackers own task facts, Git owns Git facts, execution
  substrate owns execution observations, and the journal owns workflow history.
  Do not persist derived frontier/resource/presentation substitutes. Use tagged
  variants instead of sentinels or conditionally related optional fields.
- **Coupling and scope:** define rules that must agree once or enforce them with
  shared types. Every export/abstraction needs a current consumer. No speculative
  code or historical compatibility wrappers, upcasts, or fallback semantics
  unless the ticket names released data requiring them; unreleased schemas,
  fixtures, Git history, and Ralph are not compatibility targets.
- **Recovery:** preserve intent after an uncertain result and reread the request
  destination before retry: tracker for claims, Git for refs/worktrees, execution
  substrate for reports. Cleanup is also fail-closed.

### Review closure

1. Pin base and candidate SHAs; for dirty work capture the diff or its content
   hash. Review the complete candidate along three axes: domain/spec against
   CONTEXT and accepted requirements; architecture/connascence against
   ARCHITECTURE and this checklist; correctness/tests/complexity against the
   final diff.
2. Classify before repairing. A blocker names the actor/caller, trigger,
   boundary, violated requirement, and defect or missing-proof evidence. A
   supported-path defect may expose missing scenarios; establish the required
   scenario before a behavioral repair. Distinguish standards/handoff omissions
   from demonstrated safety failures. A code smell alone is not a blocker;
   internal hardening needs a supported caller or required misuse case, not an
   invented trust boundary.
3. Record each disposition: fixed with evidence, rejected with a concrete reason,
   or deferred with scope/owner. Deferral cannot waive accepted scenarios,
   blocking dependencies, safety failures, or required gates. Unrelated
   improvements belong in follow-ups.
4. Recheck fixes and affected behavior. Reopen settled findings only with new
   contradictory evidence. Changed accepted behavior or cross-module contracts
   warrant broader review; local fixes/checkpoint commits do not restart every
   axis or require fresh reviewers. Recurring defect classes call for a shared
   cause investigation before more local repairs.
5. Close when scoped blockers are resolved and required evidence is green,
   including `pnpm check:all` before handoff and applicable final
   `pnpm check:quint` before integration. See [development checks](DEVELOPMENT.md#commands).
