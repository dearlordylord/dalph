# Scoreboard

Measured on darwin/arm64, Quint 0.31.0, Apalache 0.56.1, TLC from tla2tools
(2026-08 release), Agda 2.8.0, fast-check 4.9.0, Node 22.

Reproduce with the `run.sh` / `run.mjs` in each tool directory.

## Mutant detection

`caught` names the invariant that failed. `—` means the level is out of scope
for that encoding, not that the tool is incapable.

| Mutant | Defect | fast-check L1 | fast-check L2 | Quint simulate | Quint verify (Apalache) | TLC |
|---|---|---|---|---|---|---|
| M0 | none | clean 0.1s | clean 1.8s | clean 3s | no verdict, terminated at 45 min | clean 2s, 81 792 states |
| M1 | `rank <= capacity` | caught 0.0s | caught `boundRespected` 0.0s | caught 1s | not run | caught `BoundRespected` <1s |
| M2 | deliveries lose retained tickets | caught 0.0s | caught `retentionHolds` 0.0s | caught 1s | not run | caught `RetentionHolds` 1s |
| M4 | position released at suspension request | — | caught `positionDiscipline` 0.5s | caught 1s | not run | caught `PositionDiscipline` 1s |
| M5 | recovery plans a second attempt | — | caught `oneAttemptPerTask` 0.1s | caught 1s | not run | caught `OneAttemptPerTask` 1s |
| M6 | promotion drops compare-and-set | — | **missed, 0/10 runs** | **flaky, 4/10 runs** | **caught** 38s | caught `PromotionUsedExactHead` <1s |

fast-check budget: 50 000 runs, 40 steps, `size: "max"`. Quint simulate: 50 000
samples, 25 steps. Apalache and TLC: 12 steps and full reachability under
`StateConstraint`.

## Headline findings

**Random search on deep states is flaky, which is worse than failing.** M6 needs
eight ordered actions to reach. Over ten repetitions at the same budget:

| Engine | M6 caught |
|---|---|
| fast-check, 50 000 runs × 40 steps | 0/10 |
| Quint simulate, 50 000 samples × 25 steps | 4/10 |
| TLC | 10/10, <1s |

A tool that never finds a defect at least tells you so consistently. A tool that
finds it 40% of the time makes a green run meaningless and a red run look like a
flake to be retried. Quint's own witness counts show the mechanism:
`settledReached` appeared in 0.02% of 50 000 traces. Sampling coverage is the
number to look at, not the pass.

fast-check's 0/10 against Quint's 4/10 is an encoding difference, not a tool
difference: fast-check generates a blind action list up front, while Quint's
simulator picks among *enabled* actions at each step and therefore wastes far
fewer steps on disabled guards. `fc.commands` would close most of that gap.

**Exhaustive beats symbolic at this size, by a lot.** TLC enumerated all 81 792
distinct states in 2 seconds and caught every mutant including M6. Apalache
found M6 in 38 seconds, but on the faithful model it reached step 12, began
discharging the state invariants, and was terminated at 45 minutes without a
verdict — a refutation is cheap for it, a clean bill of health is not. Bounded
symbolic checking pays off when the state space is wide, not when it is small
and finite, which is the opposite of the intuition that "SMT is the serious
engine."

**The tool that catches a mutant fastest is not the tool that taught the most.**
M6 was originally undetectable by every engine, because the first model had no
`externalTargetAdvance` action: with an exclusive integration-target resource, a
captured head can never go stale, so the compare-and-set guard was unreachable
and I13 held vacuously. No engine reports this. It surfaced only from asking
"can a stale head actually occur?" — which is why the witness refutation is part
of the protocol, not decoration.

**Two invariants could not be stated as state predicates at all.** I8 (admission
ceiling) and I13 (promotion) are properties of transitions. Every encoding
carries a history variable for them. In the I8 case the naive state predicate
`|positions| <= capacity` is not merely weaker, it is wrong: a capacity
contraction legitimately leaves more holders than the ceiling. Run
`tlaplus/run.sh --m8`: TLC reports the *faithful* model violated in 1 second,
1 295 states, for every mutant including M0. The tool is right and the
specification is wrong, and nothing in the output says which.

`node fastcheck/run.mjs --m8` at a small budget reports M0 clean, because the
witness needs capacity raised to 2, two admissions, then a contraction — about
nine ordered actions. The same deep-state blindness as M6, now hiding a
specification error instead of a defect.

## The proof-and-structure tools

These do not fit the mutant table, because they do not search a state space.
Each states the invariant and either discharges it or refuses.

| Tool | Faithful | Mutants | Time |
|---|---|---|---|
| Agda | checks under `--safe` | n/a, defects are unwriteable or unprovable | <1s |
| Lean 4 | all proofs check | 3 rejected, `unsolved goals` | 2s |
| Dafny | 11 obligations verified | 3 rejected, `postcondition could not be proved` | 1s |
| Alloy 6 | 4 checks UNSAT, 2 witnesses SAT | M3 counterexample constructed | 2s |

Alloy is the only one of the four that reports a *counterexample* rather than a
refusal: `check parentsOrderedUnderMutant` returned SAT with a concrete
misordered candidate. Dafny and Lean name the unproved goal instead, which is
less informative about the input and more informative about the specification.

Two invariants exist here that no state-machine encoding could state honestly.
I11 (claim exclusivity with an exact token) and I12 (two ordered candidate
parents) are booleans in the Quint, TLA+, and fast-check models — a mutant
flips the flag and the "detection" tests the flag. In Alloy they are relations
over atoms, so the defect is a shape and the solver searches for it.

## Cost

| Tool | Setup | Encoding | Level covered |
|---|---|---|---|
| fast-check | none, already a dependency | 250 lines model + 100 lines harness | L1 + L2 |
| Quint + Apalache | `brew install quint`, Apalache auto-fetched | 440 lines | L1 + L2 |
| TLA+ / TLC | one 2 MB jar, no install | 300 lines | L1 + L2 |
| Alloy 6 | one 21 MB jar, no install | 95 lines | L1 + structural I11/I12, no transitions |
| Dafny | 100 MB release zip | 150 lines | L1 on code-shaped definitions |
| Lean 4 | elan, no Mathlib needed | 125 lines | L1, incl. half of I2 |
| Agda | `brew install agda`, no stdlib needed | 145 lines incl. a hand-rolled prelude | L1, without I2 |

Agda and Lean hold I3 the same way, and it is the reason both are here. I3
costs *zero* proof: `excluded` takes a head reason and a tail, so a reason-free
exclusion cannot be written. I1 and I4 cost real theorems but are then proved
for all inputs, not sampled.

I2 (order independence) is where they separate. Agda cannot afford it at all:
stating it needs a permutation relation and a proof that selection commutes
with graph-order normalization, larger than everything else in the file. Lean
gets the *length* half in three lines by rewriting through `select_exact`, and
still cannot afford the contents half. The same property is one fast-check line
and already exists against the real implementation.

That ratio is the lesson: type-level encoding is free where the invariant is
structural, cheap-ish where it reduces to arithmetic, and disproportionately
expensive where it is permutation-shaped.

## A finding about this repository's own gated models

`specs/acceptedResultIntegration.qnt` is checked by `pnpm check:quint`, and one
of its gated invariants cannot fail.

`candidateReadyHasExactOrderedParents` asserts that a result in phase
`CandidateReady` has `observedFirstParent == expectedTargetHead` and
`observedSecondParent == acceptedResultCommit`. `CandidateReady` is produced at
exactly one place — `observeExactCandidate` — and that action assigns those two
fields to exactly those two values. The invariant restates the assignment.

This is not a defect in Dalph. Per `docs/CONTEXT.md`, an integration candidate
*is* the commit Git proves has those two ordered parents, so a commit without
them is not a candidate and `observeInvalidCandidate` is the correct modelling.
The invariant is definitional by domain design, and the spec is right.

Mutation analysis then corrected the follow-on claim. The structural argument
predicted this invariant would catch nothing; it catches one mutant of 81 —
one that lets a wrongly-parented result reach `CandidateReady` through a
weakened guard. Restating an assignment is not the same as constraining
nothing, and reasoning about a spec is not a substitute for mutating it.

`GATED-SPECS-MUTATION.md` carries the full analysis across all five gated
specs, including the four invariants that really do kill nothing, the one
genuinely vacuous invariant that has since been repaired, and the finding that
witnesses catch nearly as many mutants as invariants do.
