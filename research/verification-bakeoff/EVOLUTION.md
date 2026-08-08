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
```

The harness treats a timeout, missing verdict marker, unexpectedly passing
mutant, or zero-witness run as failure.
