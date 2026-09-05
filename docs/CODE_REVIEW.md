# Code review checklist

Review changes against the applicable accepted implementation specification,
accepted tooling requirements, and these implementation constraints.

## Operational scenario gate

Missing operational scenarios or a missing scenario-to-test mapping are a hard
review failure for behavior-changing work. Read
[OPERATIONAL-SCENARIOS.md](OPERATIONAL-SCENARIOS.md), then verify:

- each scenario tells a chronological story using the affected person when one
  exists, concrete facts from the relevant GitHub/Git/executor/journal systems,
  actual boundary calls, applicable crash and retry outcomes, and the visible
  result;
- a scenario that omits a boundary, crash, or retry says concretely why it
  cannot affect that behavior instead of adding ritual filler;
- each changed command, workflow decision, external request, durable fact,
  retry, recovery rule, concurrency rule, cleanup action, and visible outcome
  appears in at least one scenario;
- each scenario maps to a named acceptance test or model check;
- when a scenario refines or composes existing accepted behavior, its
  `Governing behavior` pointer names the concrete decision, links the direct
  owners, states whether it preserves, refines, or supersedes the linked
  behavior, and bounds what the new scenario adds;
- the code does not add behavior absent from the scenarios;
- the handoff reports the result scenario by scenario rather than substituting
  aggregate gate totals; and
- any tooling-only or documentation-only exemption gives a concrete reason no
  Dalph runtime behavior can change.

Reject a scenario that merely replaces one abstraction with another. “Alice's
browser retries the pause command after losing Dalph's response” is an event;
“the client repeats an idempotent control operation” is not an adequate
operational explanation.

## Implementation checklist

- Domain language passes the literal reading test in
  [DEVELOPMENT.md](DEVELOPMENT.md): each important sentence names the actor,
  action, changed state, and the exact boundary reread for evidence. Standalone
  “managed,” “controlled,”
  “mutation,” “substrate,” “authority,” “ambiguity,” and generic “operation”
  require replacement or an immediate concrete definition and example.
- Data received from task trackers, executors, Git commands,
  configuration, and journal storage is parsed with Effect Schema; parsed and
  branded values flow inward instead of raw primitives being revalidated.
- Expected failures remain precise typed Effect failures. Throws represent
  defects or unavoidable bootstrap failures only.
- Effect `Context.Service` tags, Layers, configuration, schedules, streams,
  time, and concurrency follow the repository's Effect V4 architecture.
- The workflow algebra invokes the same operations in dry-run, deterministic
  test, partial-integration, and production compositions. The
  `WorkflowInterpreter` is the injected Effect service that executes those
  selected operations; an Effect Layer constructs it by choosing real or
  simulated implementations independently at each boundary. Reject workflow
  branches that select different operations only because a prior result was
  simulated. Permit controlled test adapters to exercise production protocol
  code beside simulated boundaries. If an adapter may change external state,
  require that composition to record intent at that exact boundary and claim
  only the safety and durability guarantees its selected implementations
  provide.
- Tests substitute services through Layers. They do not patch modules, depend
  on real sleeps, or merely restate compile-time guarantees.
- When an accepted scenario requires an action exactly once, before or after
  another action, for one exact identity or correlation, or not at all, the
  acceptance test directly asserts that count, order, identity, correlation,
  or absence at the relevant boundary or durable record. A matching final
  state alone does not prove those causal requirements.
- Dalph domain types do not admit impossible field combinations. Tagged variants
  replace sentinel values and bags of conditionally related optional fields.
- Current task state is read through the task tracker, Git state from Git,
  planned-attempt execution observations through the execution substrate, and
  Dalph-recorded workflow history from the Dalph workflow journal. Derived
  frontier, resource, and presentation state is not stored as a substitute.
- If two code locations must agree on the same literal, parser rule, event
  order, or default, define that rule once or represent the relationship with a
  shared type.
- Every export and abstraction has a current consumer. No speculative code is
  added for possible future use.
- Dalph is greenfield. Do not add or preserve compatibility wrappers, adapters,
  upcasts, or fallback semantics for historical shapes unless the current
  ticket names released data that must remain readable. Git history, unreleased
  schemas, fixtures, and the historical Ralph experiment are not compatibility
  targets.
- Casts and non-null assertions are absent from production code. An unavoidable
  cast while decoding data from a named external application, command, config,
  or store requires concrete evidence and a narrowly scoped suppression.
- For an uncertain request outcome, recovery preserves the recorded intent and
  rereads the request's destination: the task tracker for a claim, Git for a ref
  or worktree, or the execution substrate for a planned-attempt report. Cleanup
  follows the same fail-closed rule.

Before handoff, run `pnpm check:all` and perform three reviews:

1. Domain/spec: compare domain names and behavior with `docs/CONTEXT.md` and the
   applicable accepted implementation specification.
2. Architecture/connascence: compare dependency direction and facts that must
   change together with `docs/ARCHITECTURE.md` and this checklist.
3. Strict code review: inspect the final diff for correctness, typed failures,
   invalid states, tests, and accidental complexity.

### Review closure

Pin both ends of the reviewed change. For uncommitted work, record the base SHA
and a captured diff or its content hash; a moving worktree is not a fixed
candidate. Reviewers report findings without editing the candidate. The
implementer classifies the findings before starting repairs.

For each blocking finding, identify the actor or caller, concrete trigger,
affected boundary, violated accepted scenario or repository rule, and evidence
that demonstrates the defect or missing proof. A reproducible defect in a
supported path may instead expose missing scenario coverage; identify that
gap and establish the required accepted scenario before a behavior-changing
repair. Separate behavioral severity from a documentation or standards handoff
requirement: a missing test name
must be corrected, but is not itself a demonstrated production safety failure.
A code-smell heuristic alone is not a blocking requirement. For internal API
hardening, explain which supported caller or required misuse case reaches the
invalid state; do not silently add a new trust boundary to the task.

Keep a disposition for each finding: fixed with evidence, rejected with a
concrete reason, or deferred with its scope and owner. Deferral cannot waive an
accepted scenario, blocking dependency, safety failure, or required gate. An
independent improvement that is not required to deliver this task belongs in a
separate follow-up, rather than extending the current task's completion test.

Perform the three-axis review once on a complete fixed handoff candidate.
After that review, recheck the fixes and behavior they can affect. Reopen a
settled finding only with new contradictory evidence. A change
to the accepted behavior or a cross-module contract warrants a broader review;
a local correction or checkpoint commit does not automatically restart all
three passes or require a fresh set of reviewers. Stop reviewing when scoped
blocking findings are resolved and the required evidence is green. If another
round exposes the same class of defect, investigate the shared design cause
before continuing local repairs.
