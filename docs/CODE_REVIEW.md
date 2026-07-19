# Code review checklist

Review changes against both the accepted behavior and these implementation
constraints.

- Boundary input and persisted data are parsed with Effect Schema; parsed and
  branded values flow inward instead of raw primitives being revalidated.
- Expected failures remain precise typed Effect failures. Throws represent
  defects or unavoidable bootstrap failures only.
- Services, Layers, configuration, schedules, streams, time, and concurrency
  follow the repository's Effect V4 architecture.
- Tests substitute services through Layers. They do not patch modules, depend
  on real sleeps, or merely restate compile-time guarantees.
- Product types do not admit impossible field combinations. Tagged variants
  replace sentinel values and bags of conditionally related optional fields.
- Tracker, Git, execution substrate, and journal facts retain their documented
  authority; derived frontier, resource, and presentation state is not stored.
- No new literal, parser, projection, protocol ordering, or default creates
  distant facts that must change together. Centralize or encode such coupling.
- Every export and abstraction has a current consumer. No speculative code is
  added for possible future use.
- Casts and non-null assertions are absent from production code. Boundary
  exceptions require concrete evidence and a narrowly scoped suppression.
- Cleanup and ambiguous effects preserve intent/observation/reconciliation and
  fail-closed semantics.

Before handoff, run `pnpm check:all` and perform domain/spec,
architecture/connascence, and strict code-review passes. Record why any
reasonable finding is rejected.
