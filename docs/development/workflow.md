# Development workflow

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

## Keeping implementation work finite

- **Close a complete outcome before expanding another adapter.** Establish one
  accepted end-to-end recovery path through the actual owner early, including
  refusal and custody. Keep its unexecuted suffix in the existing issue. Finish
  that suffix before adding more helper laws or another provider's equivalent
  machinery; narrow passing tests do not move the delivery milestone by themselves.
- **Batch edit-loop checks.** Use `pnpm typecheck:dev` for incremental diagnostics
  within one worktree, then focused scenario tests and lint for the changed batch.
  Run the fresh `pnpm typecheck` at a coherent milestone or to distinguish a
  suspected stale diagnostic. Existing submission and qualification commands
  keep their fresh checks. The incremental cache supplies no qualification credit.
- **Publish one coherent candidate.** Finish the intended target merge, scoped
  checks and review before pushing the final task head. Read the remote branch
  SHA back and compare it with the qualified local head before creating a PR.
  Creating the PR and then pushing a pending merge triggers redundant CI events.
  During CI, keep that candidate frozen and use another worktree for independent
  repairs or documentation. Changes that repair a demonstrated failed boundary
  form an explicitly new candidate after the focused repair passes.
- **Observe the exact CI run.** Bind observations to workflow, head/candidate,
  run ID and attempt. A PR rollup can temporarily show an older cancelled run's
  aggregate while its replacement is executing. Inspect the named run and its
  stage evidence to distinguish them; never credit the cancelled run's missing
  stages or restart the live replacement merely because the rollup is red.
- **Choose the next action before waiting.** When sending a candidate to CI,
  select independent work in another worktree or read-only planning for a blocked
  successor. Return to the job on completion, failure evidence, or its recorded
  deadline; repeated observations of a live handle do not advance implementation.
- **Retire tests by acceptance value.** Identify each expensive test's unique
  accepted scenario before repair. Move deterministic rules to controlled unit
  tests; delete redundant orchestration fixtures when their boundaries have
  direct coverage, retaining the real composition proof and its explicit gaps.
- **Bound generated work as well as replayed work.** Model-based tests set
  `maxSamples` explicitly alongside `nTraces`; the latter limits retained
  traces, not the generation budget. Read the
  [replay budget guidance](../QUINT-GUIDE.md#model-based-replay-budgets) before
  increasing a replay timeout or reducing its accepted trace count.

- Attempt a minimally instrumented complete-story diagnostic before polishing
  prefixes. Check accepted outcomes, causal requirements, and forbidden effects;
  predicted internal call order is a hypothesis. Record the first obstruction
  and unexecuted suffix. Reuse applicable evidence; workflow adoption does not
  restart completed characterization.
- For a failed test, complete these steps before another broad check:
  1. Locate the failed boundary in retained evidence. Record competing causes,
     the observation that distinguishes them, and the stopping result.
  2. Put pure validation and decisions in controlled unit tests. For each native
     fixture, name its unique OS acceptance fact and set an isolated provider
     home. Use dedicated, explicit custody for ambient-home inheritance and
     same-home contention. Remove redundant process fixtures once their accepted
     behavior is covered; preserve native spawn, lock, writer-absence, and cleanup
     proofs. Use minimal typed events for projection and serialization checks.
     Keep one composed replay for each distinct ordering or authority requirement;
     put additional readback assertions into that replay instead of starting the
     same graph again.
     When a verification helper gains an import, update its shared copied-runtime
     fixture and run the composed consumer tests; an isolated helper test cannot
     prove that dependency closure. After JavaScript fixture changes, run the
     full type-aware lint census once: selecting only those files can omit types
     discovered in the complete program.
  3. Run one bounded diagnostic that supplies the recorded observation. A passing
     isolated test leaves an order-dependent cause unresolved. Choose a different
     observation when the diagnostic cannot discriminate; an unchanged rerun,
     added reviewer, or longer timeout supplies no evidence.
  4. Repair the identified cause and observe the focused acceptance check pass.
     Then select the affected checks once using [choosing checks](checks.md#choosing-checks).
  These steps govern test development and change no Dalph runtime behavior.
  Continue independent work while a boundary is unresolved; ask only about
  choices that change accepted outcomes.
- Before a focused authored-cassette diagnostic, trace each requested fact to
  the adapter actually selected by that story (including conditional interpreter
  routes). Name the observation point and prove it executes *before* the first
  possible mismatch or assertion failure. A hook reached only after the failed
  boundary, or an assertion skipped by an earlier failure, cannot distinguish
  the alternatives. Record the required fields and a missing-field outcome
  before one bounded run. If a required field is absent, stop and repair the
  observation route; do not edit a cursor position or append a story response
  based on a partial trace. Prefer event identity and correlation over numeric
  cursor positions when carrying evidence across fixture revisions. For an
  attempt-choice story, distinguish the immutable planned task revision from
  the current tracker revision observed to authorize Continue; check the
  accepted finality rule before expecting that attempt to complete. This is
  diagnostic procedure for test adapters and changes no Dalph runtime behavior.
- Apply the [#307 churn controls](../postmortems/issue-307-qualification-churn.md#prevention-plan-and-validation)
  after two non-advancing attempts or 30 minutes of active repair without a new
  distinguishing result. Within the next 10 minutes of active work, record the
  changed experiment and a costly test's unique acceptance value in the existing
  task. Before another broad/hosted submission, record the focused reproduction
  and passing repair, or the concrete reason it cannot run locally. Subtasks do
  not reset the parent outcome's budget.
- Keep outcomes, test mappings, revision, obstruction, and next experiment in
  the existing issue/specification/scenario. Link it from parent issues. Record
  deadlines with units and timezone; dependencies, reviews, and renamed
  checkpoints do not reset the parent budget or its accepted stop rule.
- Use [choosing checks](checks.md#choosing-checks). Repair failures and check affected
  behavior before rerunning. Reconcile scenario-to-test mappings and close
  [scoped reviews](../CODE_REVIEW.md#review-closure) before handoff; intermediate
  commits need no handoff ceremony.
- Bounded commands use detached process groups so timeout cleanup can reach
  descendants. A timeout settles only after the direct child closes and the
  Unix process group is absent, or after a bounded explicit failure to prove
  absence. A nested detached command must opt into parent-signal relay; the
  delivery repeatability runner does so for every child and Git lookup. Do not add an
  outer GNU `timeout` around `check:all`.
- Admitted gates have one absolute `DALPH_GATE_DEADLINE` (ISO UTC, for example
  `2026-09-22T06:00:00.000Z`), defaulting to one hour from invocation. Record the
  expected duration and choose the deadline before starting. Worktree-lock and
  clone-slot waiting consume this same budget. The run persists it; nested
  commands may shorten but cannot extend it. Deadline expiry stops new work and
  invokes bounded descendant cleanup. Missing stopped-writer proof retains the
  fence for explicit reconciliation; a timeout never qualifies the candidate.
  This tooling policy does not change Dalph runtime behavior or accepted task
  execution deadlines.
- Diagnose a failed `check:all` from retained gate evidence at the failed
  boundary. When a launched child stage exits nonzero, the top-level failure
  message and retained child-stage log identify that stage. Dependency
  preparation or input-guard failures can happen before a child stage launches,
  leaving no stage result or child-stage log. Run a focused reproducer or
  diagnostic for the failed boundary; run a test directly only when the failed
  child was a test. Repair its cause and observe the focused check passing before
  another full qualification. The ordinary candidate runner does not consult
  historical recovery records for admission. Incomplete writers retain custody
  fences until stopped-process proof. This tooling policy does not change Dalph
  runtime behavior.
- Hosted preflight repeats each failed stage's name and error in its final
  summary after independent checks finish. The CI failure step uploads its
  retained child logs for a bounded follow-up; inspect the named stage before
  another hosted submission. This reporting change cannot alter Dalph runtime
  behavior.
- For the workflow pilot, use the next existing milestone to record broad review rounds, reopened findings
  with new evidence, full-gate restarts, and closure time. Verify that required
  scenario evidence survives and reproduced accepted-path defects still block
  closure. Fewer rounds alone do not demonstrate improvement. Use the existing
  task record, not another ledger.
