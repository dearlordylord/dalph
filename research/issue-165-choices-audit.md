# Issue 165 choices audit

The source-organization merge resolved the earlier concern that the cassette
library was not publicly accessible. `@dalph/dalph` now exports its cassette
barrel from the package root, so that resolved point is omitted below. Authored
cassettes now assert typed domain outcomes directly against Dalph and boundary
evidence, so the earlier “expected visible behavior” concern is also omitted.
Authored recovery cassettes now span coordinator death and journal-backed
startup recovery, so the earlier fresh-run-only and synthetic-recovery
concerns are omitted as well.

## 1. “Complete coordination loop”

- Choice: The cassette stops after the executor reaches its terminal report; it does not update the tracker and continue until the graph is completely done.
- Limited confidence: I interpreted completion according to the current coarse planned-attempt milestone and issue dependencies.
- Risk: If #165 intended end-to-end graph convergence, the central scenario is incomplete.
- Verify: Compare the stopping point directly with the accepted parent #163 scenario and dependency ownership.

## 2. Operational state versus complete state

- Choice: `stateEquivalent` excludes workflow history and journal position; those are compared separately by `workflowHistoryEquivalent`.
- Limited confidence: “Final state” could reasonably include history and applied position.
- Risk: The negative scenario’s claim that final state is unchanged may be misleading.
- Verify: Confirm the domain definition; otherwise rename it `operationalStateEquivalent` and expose a combined comparison.

## 3. Illegal early-start construction

- Choice: Modeled early start by moving `ExecutorWorkResponsibilityBegan` before worktree intent/readiness.
- Limited confidence: This represents Dalph accepting responsibility early, not necessarily the executor process physically starting early.
- Risk: The negative case may prove a weaker property than intended.
- Verify: Check the planned-attempt boundary definition; add a premature executor report/start observation if that is the prohibited event.

## 4. Alpha-renaming implementation

- Choice: Encode the cassette, recursively rewrite fields with known identity-property names, then decode it again.
- Limited confidence: This depends on a manually maintained list of field names.
- Risk: A newly introduced generated identity could silently escape equivalence checking.
- Verify: Add a test that enumerates every branded generated identity in the schema, or replace traversal with typed renamers per entry variant.

## 5. Which identities may be renamed

- Choice: Renamed attempt, command, operation, run, worktree, and related generated identifiers while treating task IDs, revisions, and Git SHAs as authoritative.
- Limited confidence: The repository has no single explicit taxonomy of generated versus externally authoritative identities.
- Risk: Equivalent recordings may compare unequal—or genuinely different recordings may compare equal.
- Verify: Record that taxonomy in the domain model and derive the renamer from it.

## 6. Generator breadth

- Choice: Property tests generate only small linear acyclic graphs with one final open task and capacity one.
- Limited confidence: Broader concurrent graphs caused nondeterministic trace ordering, so I narrowed the domain.
- Risk: Wide DAGs, multiple runnable tasks, concurrency, suspension, and other actor directions are not covered.
- Verify: Add separate generator families for wide and branching DAGs, with expectations based on explicit logical checkpoints.

## 7. Property-test strictness

- Choice: Reduced fast-check runs from 20 to 10.
- Limited confidence: This was a runtime concession, not a coverage argument.
- Risk: Shrinking and generated edge-case confidence are weaker.
- Verify: Run 100–1,000 iterations as a non-coverage/nightly test and retain 10 only in the expensive coverage gate.

## 8. Existing stress-test strictness

- Choice: Reduced an existing workflow-occurrence stress case from 10,000 pairs to 3,000 pairs.
- Limited confidence: The user authorized relaxing strictness for drastically slow tests, but 3,000 is empirically convenient rather than analytically justified.
- Risk: Performance regressions visible only at larger histories may no longer be caught.
- Verify: Benchmark 10,000 pairs outside instrumented coverage and establish a time or complexity threshold.

## 9. Global worker reduction

- Choice: Changed Vitest’s global maximum workers from four to two.
- Limited confidence: It stabilized coverage contention locally but affects every test mode.
- Risk: Normal CI may become unnecessarily slower.
- Verify: Compare CI timings and memory usage; likely refine this to two workers only under coverage.

## 10. Size experiment representativeness

- Choice: Measured a 100-task linear graph across three reads using UTF-8 JSON sizes.
- Limited confidence: Linear graphs, JSON encoding, and three reads may not represent production graph shapes or storage overhead.
- Risk: The “no compression conclusion” may not generalize.
- Verify: Repeat for wide/diamond graphs, several sizes, and actual journal storage bytes.

## 11. Starting-fact cross-field validity

- Choice: Schema-valid worktree observations and claims are not checked against the deterministically generated plan until execution.
- Limited confidence: That preserves unhappy-case authorability but allows contradictory “starting facts.”
- Risk: Invalid cassette states are representable and fail later at provider boundaries.
- Verify: Decide whether mismatches are valid modeled failures; otherwise add a cross-field validation phase.

## 12. Chronology of outside occurrences

- Choice: The authored occurrence list is split into boundary-specific queues rather than enforced as one global chronological script.
- Limited confidence: This makes providers deterministic but weakens chronology.
- Risk: A cassette can describe an impossible interleaving yet still run successfully.
- Verify: Author an intentionally impossible interleaving. If it passes, replace the queues with one boundary-checked scripted sequence.

## 13. Implicit tracker changes

- Choice: Later graph/spec provider returns may differ from starting facts without a separate explicit edit occurrence.
- Limited confidence: I treated each provider result as sufficient evidence of an outside change.
- Risk: A reader cannot always tell who changed the authoritative tracker state or when.
- Verify: Require an explicit tracker-edit occurrence before any changed return, if the operational-scenario standard expects that causality.

## 14. Empty-journal projection

- Choice: Recording an empty journal fails because no `RunId` can be inferred.
- Limited confidence: An empty journal is otherwise a legitimate fresh-run state.
- Risk: The library cannot project the simplest valid journal.
- Verify: Determine whether the API should accept `RunId` separately, then add an empty-journal test.

## 15. Test-defined catalog

- Choice: The cassette schema, recorder, renderer, and runner now live in the public `@dalph/dalph` application package, but the concrete cassette catalog still lives in test fixtures.
- Limited confidence: “Maintained library” might imply checked-in reusable cassette artifacts rather than only a public toolkit with test-defined examples.
- Risk: Other tools can import the cassette API but cannot discover or run a stable catalog of scenarios.
- Verify: Identify the intended consumer. If broader than tests, add a dedicated `cassettes/` catalog and loading API.

## 16. No Quint model change

- Choice: Ran exhaustive Quint checks but did not modify the model or add cassette conformance.
- Limited confidence: I judged cassette projection and fresh-run activation as testing infrastructure rather than new modeled behavior.
- Risk: The implementation and formal model could agree only indirectly.
- Verify: Ask whether occurrence ordering/equivalence is Quint-governed; if so, add an executable cassette adapter or model property.

## 17. Public support seams across package boundaries

- Choice: The public `@dalph/dalph` cassette runner consumes fresh-run, startup-recovery, live recovery-authority, and controlled tracker-mutation layers through the public `@dalph/orchestrator` root API.
- Limited confidence: The source-organization refactor gives these exports current consumers and clear package ownership, but they remain narrow support seams for authored cassette activations rather than broadly production-shaped capabilities.
- Risk: Other application code can depend on APIs whose semantics are intentionally narrow, making later recovery or tracker-adapter refactoring harder.
- Verify: Decide whether these are supported orchestrator contracts. If not, expose a purpose-named cassette support composition instead of the low-level seams.

## 18. GitHub and project-memory follow-through

- Choice: Pushed the implementation branches but did not comment on or close the issue, and did not add an OptMem note.
- Limited confidence: The user authorized the push but not tracker mutation, and the durable decisions are already checked into code/scenarios.
- Risk: The issue may remain operationally stale, or a reusable architectural decision may not be recalled.
- Verify: Confirm the repository’s post-implementation workflow before commenting/closing; search OptMem for an existing equivalent note before adding one.

## 19. Continuation authorization before executor contact

- Choice: Tentatively require one durable, non-recovery-specific action that authorizes continuation of the existing executor-work responsibility from fresh active-task continuation and exact-worktree observations.
- Limited confidence: The action closes the causal gap between current facts and executor contact without adding another executor-work identity, but its exact reducer shape has not yet been exercised in Reducer Lab.
- Risk: Too little durable evidence permits executor contact from stale facts; too much per-call identity leaks the milestone fake's method calls into the coarse `(RunId, AttemptId)` domain.
- Verify: After the cassette tickets land, model crash prefixes before and after authorization in Reducer Lab and confirm that Running and Terminal reports remain facts about one coarse responsibility.

## 20. Non-returning production before the next story item

- Choice: Keep normal cassette interpretation on one Effect fiber with no polling, timeout, queue, or driver fiber. A genuine non-returning defect initially relies on the test runner's outer timeout.
- Limited confidence: This keeps time out of cassette vocabulary but gives a deadlock slower diagnostics than an ordinary head-entry mismatch.
- Risk: A regression to `Effect.never` can consume the full test timeout.
- Verify: Add a deterministic watchdog only if an observed slow or hanging test demonstrates the need; do not add one to normal cassette semantics preemptively.
