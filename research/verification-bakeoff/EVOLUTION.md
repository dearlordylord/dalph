# Verification follow-up experiments

This record covers GitHub issues #197–#201. It extends the verification
bake-off without changing Dalph runtime behavior: every transition below is a
bounded formal abstraction, and no production command, tracker request, Git
request, executor request, or workflow-journal event is added.

The executable model is `quint/deliveryEvolution.qnt`; its directed scenarios
are in `quint/deliveryEvolution_test.qnt`, and `quint/run-evolution.mjs` checks
the faithful model and requires every seeded negative control to fail.

## #197 — blocker changes and bounded arrival

Planned Base SHA: `cf93823b824255b9fdd54ac2f20f583302e9a979`.

### Model boundary and decisions

- The task tracker supplies complete blocker observations. Each task has zero
  or one blocker; blocker identifiers must name another modeled task.
- Blocker cycles are valid tracker states. They make every member ineligible
  but do not fail the Run, erase an exact obligation, or imply settlement.
- A blocker added after a claim stops the next modeled forward step. Removing
  it allows the same obligation to continue; no second attempt is created.
- Task arrival consumes `arrivalsRemaining` in the transition relation.
  Recycling a terminal task slot represents a later tracker task and consumes
  the same budget. No TLC `CONSTRAINT` truncates the behavior.
- The unbounded-arrival control removes the transition guard. TLC then finds a
  lasso that violates quiescence, proving the bounded result is not a
  state-constraint artifact.

### Scenario-to-test mapping

| Accepted scenario | Concrete result | Executable evidence |
|---|---|---|
| B is blocked by A, then a fresh observation removes the blocker | B is absent from `selected` while blocked and acquires a claim only after A settles and the blocker is removed | `blockerPreventsBClaimTest`, `blockerRemovalMakesBEligibleTest`; `deliveryEvolutionIgnoreBlockersTest` fails under mutant 1 |
| A is claimed before a later blocker arrives | A remains `Claimed`, stays in `deliveries`, cannot begin work, and continues after removal | `postSelectionBlockerPreservesObligationTest`, `blockerRemovalResumesSameObligationTest`; `blockerCycleIsValidAndIneligibleTest` records the cycle disposition |
| Tracker work arrives only within an explicit budget | Both arrivals exhaust the budget; under fair lifecycle steps and eventually-clear blockers the complete graph reaches quiescence | `boundedArrivalExhaustsBudgetTest`; TLC checks `reachesQuiescenceAfterBoundedArrival`; mutant 2 violates the same temporal property |

### Measurements

Quint 0.32.0 on Linux aarch64:

- deterministic scenarios: 6/6;
- sampled model: 10,000 traces, 20 steps, seed 197, no invariant
  counterexample; blocker 10,000/10,000, post-selection blocker
  6,776/10,000, and exhausted budget 10,000/10,000;
- TLC temporal check: 683 generated states, 141 distinct states, complete
  graph depth 11, approximately 0.9 seconds of checker time;
- unbounded-arrival control: temporal counterexample in approximately 0.9
  seconds.

## Reproduce

```sh
node research/verification-bakeoff/quint/run-evolution.mjs
research/verification-bakeoff/alloy/run-three.sh
TIMEOUT=30 research/verification-bakeoff/tlaplus/run-liveness.sh --three
```

The harness treats a timeout, missing verdict marker, unexpectedly passing
mutant, or zero-witness run as failure.

## #198 — finite work preserved through suspension

Planned Base SHA: `0376ef8c59b92e98bb75143b4c31d8da0d9ac984`.

### Model boundary and fairness result

- One modeled attempt has identity 1 and work counter `0..2`. `doWork`
  increments it; settlement is disabled below 2.
- Requesting suspension, receiving the safe-suspension report, and resuming
  keep the same attempt identity and counter. The counter is not an executor
  implementation stage; it is the finite-work measure required by #198.
- The explicit counter removes the earlier need to use action fairness as a
  *proxy* for work. It does not remove scheduling fairness itself. With endless
  operator suspension, `doWork` and settlement are only intermittently
  enabled: TLC accepts the strong-fairness property and finds a lasso under
  weak fairness. No `EventuallyUninterrupted` assumption was added.
- Two-task I18 produced no verdict within 120 seconds. The accepted bounded
  specialization is one task, matching the earlier liveness study; safety,
  directed scenarios, and sampled witnesses still run with two tasks.

### Scenario-to-test mapping

| Accepted scenario | Concrete result | Executable evidence |
|---|---|---|
| Work advances 0 → 1 → 2 and cannot settle early | Settlement requires exactly two work steps | `workCounterReachesEveryValueBeforeSettlementTest`, `oneWorkStepCannotSettleTest`, `twoWorkStepsPermitSettlementTest`; mutant 3 is rejected |
| Suspension after work 1 preserves progress and identity | The safely suspended and resumed ticket retains work 1 and attempt id 1, then reaches work 2 without a second attempt | `suspensionPreservesProgressAndAttemptTest`, `resumedAttemptContinuesFromOneTest`; mutant 4 is rejected |
| Recheck I18 with explicit finite work | Every begun one-task attempt eventually settles or is retained under strong scheduling fairness; weak fairness admits the suspend/resume lasso | TLC checks `everyBegunAttemptSettles`; `everyBegunAttemptSettlesUnderWeakFairness` is violated |

### Measurements

Quint 0.32.0 / TLC on Linux aarch64:

- directed progress scenarios: 5/5;
- two-task sampling: work 0 in 9,743/10,000 traces, work 1 in
  7,154/10,000, work 2 in 4,022/10,000, and safely suspended with preserved
  work 1 in 3,005/10,000 (20 steps, seed 197);
- one-task I18: 16 generated states, 13 distinct states, complete graph depth
  8, about 2.7 seconds checker time (about 9 seconds including startup in the
  fail-closed harness);
- weak-fairness control: counterexample in about 2.1 seconds checker time;
- two-task I18: no verdict within the explicit 120-second timeout.

## #199 — three-task scaling

Planned Base SHA: `7f99511c0bed1fbafcf44fb6a98cca431a12a274`.

### Scope and engine applicability

The cardinality experiment runs in the engines whose L2 encodings expose task
scope as model-checker data: Quint/Rust sampling, Quint/TLC, hand-authored
TLA+/TLC, and Alloy. Lean's journal theorem already quantifies over arbitrary
natural task identifiers, so rerunning it at three adds no theorem strength.
The historical Lean/Agda L2 encodings use a two-constructor task type, and the
Dafny L2 class hard-codes `{0, 1}`; this ticket does not silently report those
unchanged proofs as three-task evidence.

The focused Quint model adds two checker-sensitive defects:

- mutant 5 selects the two highest-ranked eligible tasks instead of the two
  lowest;
- mutant 6 turns A's local contradiction into failures in all three regions.

### Scenario-to-test mapping

| Accepted scenario | Concrete result | Executable evidence |
|---|---|---|
| A, B, C are open under capacity 2 | exactly A and B are selected; C waits behind their lower ranks | `threeTaskSelectionRespectsRankAndCapacityTest`; rank-reversal mutant 5 is rejected |
| A records a local contradiction while B continues | only A is failed, B advances work, C remains selected under rank/capacity, and the shared run state is unchanged | `failedAIsContainedWhileBContinuesTest`; failure-leak mutant 6 is rejected |
| Strengthened safety invariant must be inductive before reachability/liveness claims | Alloy finds no counterexample to the one-step induction check at exactly three tasks | `check invIsInductiveThree` in `alloy/DeliveryThree.als` is UNSAT |
| Attempt I17–I19 at three tasks | every timeout or checker failure is reported as no verdict | `tlaplus/run-liveness.sh --three`; the three temporal checks in `alloy/DeliveryThree.als` |

### Measurements

- Quint/Rust: 10,000 traces at 25 steps, seed 199, no invariant
  counterexample; three-task selection reached 8,184 traces and three-region
  containment reached 1,868.
- Quint/TLC safety: 13,342,513 generated states, 635,797 distinct states,
  complete graph depth 28, 15 seconds; no invariant violation.
- Quint/Apalache induction: no verdict because expanding the explicit set of
  task maps would blow up the solver. This is why Alloy is the prerequisite
  induction instrument here.
- Alloy induction: UNSAT in under one second. Reachable safety had no verdict
  in 60 seconds. I17, I18, I19, and the fair-trace witness each had no verdict
  in 30 seconds under exactly three tasks.
- Hand-authored TLA+/TLC I17–I19: no verdict. TLC 2.19 throws
  `NegativeArraySizeException` while constructing the three-task liveness
  checker, before it can enumerate a state. The harness reports that error as
  no verdict rather than pass.

## #200 — emitted journal refinement

Planned Base SHA: `ee56be710f7c08a214581470077432dcc0dc9fe0`.

This is research-only. It emits values inside the bake-off model; it adds no
production journal event, tracker call, Git call, or executor call.

### Correspondence boundary

`journal-events.json` is now the canonical ordered manifest for all 23 event
tags, their action/occurrence classification, and their ordered payload names.
`generate-journal-events.mjs` derives the constructors executed by
`fastcheck/journal.mjs`, an auditable JavaScript/Lean/Agda/Dafny mapping table,
and one compiling 23-constructor witness file for each prover. The prover
runners reject stale output and compile those witnesses. A changed tag,
payload arity/order, or wrapper therefore makes the consumers move together.

`lean/JournalRefinement.lean` makes emission part of an L2 step. One `emit`
both applies the concrete transition and appends that exact `Event`.
`emit_preserves_refinement` proves one-step preservation and
`emitAll_refines` proves it for arbitrary traces. Emission wraps the existing
concrete `Journal.step`; it does not define a second set of guards or effects.

### Scenario-to-test mapping

| Accepted scenario | Concrete result | Executable evidence |
|---|---|---|
| A claim intent is retained when the coordinator dies before the tracker result; appending the reread equals resuming the prefix | the prefix has `claimPending = true`; uninterrupted and resumed folds are equal | Lean `crash_prefix_retains_claim_intent` and `intent_outcome_resume_refinement`; fast-check directed P2 witness; reset-on-resume mutant M2 is caught |
| A fails locally while B progresses; a shared contradiction fails the Run | A has a failure, B reaches `Claimed`, and the Run remains live; an event naming an unknown task fails the Run | Lean `regional_failure_is_contained` and `shared_failure_fails_run`; P3 theorem and cross-region-write mutants in every prover |
| All 23 JavaScript/prover consumers share one alphabet | generated constructor witnesses compile in Lean, Agda, and Dafny; JavaScript constructors come from the manifest | `generate-journal-events.mjs --check`, each prover `run.sh`, and exhaustive-classifier mutants |

### Measurement and interpretation

Lean 4.32.2 checks the journal, refinement, and generated witness with the
other faithful Lean files in about 3 seconds (about 13 seconds including Lean
negative controls). The refinement adds no TLC state variable and therefore
has no state-space cost. Its authored cost is the trace induction; one-step
preservation reduces to the already-proved fold homomorphism.
