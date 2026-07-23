# Code review checklist

Review changes against the applicable accepted implementation specification,
accepted tooling requirements, and these implementation constraints.

- Domain language passes the literal reading test in
  [DEVELOPMENT.md](DEVELOPMENT.md): each important sentence names the actor,
  action, changed state, and the exact boundary reread for evidence. Standalone
  “managed,” “controlled,”
  “mutation,” “substrate,” “authority,” “ambiguity,” and generic “operation”
  require replacement or an immediate concrete definition and example.
- Data received from task trackers, task-work providers, Git commands,
  configuration, and journal storage is parsed with Effect Schema; parsed and
  branded values flow inward instead of raw primitives being revalidated.
- Expected failures remain precise typed Effect failures. Throws represent
  defects or unavoidable bootstrap failures only.
- Effect `Context.Service` tags, Layers, configuration, schedules, streams,
  time, and concurrency follow the repository's Effect V4 architecture.
- The workflow algebra invokes the same operations in dry-run, deterministic
  test, and production modes. Coherent Effect Layers interpret those operations
  differently. Reject workflow branches that select different operations only
  because a prior result was simulated, and reject exported Layer compositions
  that combine a simulated intent/recording operation with a live
  ambiguity-crossing effect.
- Tests substitute services through Layers. They do not patch modules, depend
  on real sleeps, or merely restate compile-time guarantees.
- Dalph domain types do not admit impossible field combinations. Tagged variants
  replace sentinel values and bags of conditionally related optional fields.
- Current task state is read through the task tracker, Git state from Git,
  task-work session and worker-process state through the task runner, and
  Dalph-recorded workflow history from the Dalph workflow journal. Derived
  frontier, resource, and presentation state is not stored as a substitute.
- If two code locations must agree on the same literal, parser rule, event
  order, or default, define that rule once or represent the relationship with a
  shared type.
- Every export and abstraction has a current consumer. No speculative code is
  added for possible future use.
- Casts and non-null assertions are absent from production code. An unavoidable
  cast while decoding data from a named external application, command, config,
  or store requires concrete evidence and a narrowly scoped suppression.
- For an uncertain request outcome, recovery preserves the recorded intent and
  rereads the request's destination: the task tracker for a claim, Git for a ref
  or worktree, or the task runner for a task-work session. Cleanup follows the
  same fail-closed rule.

Before handoff, run `pnpm check:all` and perform three reviews:

1. Domain/spec: compare domain names and behavior with `docs/CONTEXT.md` and the
   applicable accepted implementation specification.
2. Architecture/connascence: compare dependency direction and facts that must
   change together with `docs/ARCHITECTURE.md` and this checklist.
3. Strict code review: inspect the final diff for correctness, typed failures,
   invalid states, tests, and accidental complexity.

Record why any reasonable finding is rejected.
