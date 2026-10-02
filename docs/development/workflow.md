# Development workflow

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

## Keeping implementation work finite

- Attempt a minimally instrumented complete-story diagnostic before polishing
  prefixes. Check accepted outcomes, causal requirements, and forbidden effects;
  predicted internal call order is a hypothesis. Record the first obstruction
  and unexecuted suffix. Reuse applicable evidence; workflow adoption does not
  restart completed characterization.
- After two attempts fail to advance the same outcome, name competing causes
  and run a distinguishing experiment. More reviewers, time, or gate reruns alone
  are not new evidence. Continue independent authorized work; ask only about
  unresolved choices that materially change accepted outcomes.
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
