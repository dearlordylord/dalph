# Scoreboard

Measured on darwin/arm64, Quint 0.31.0, Apalache 0.56.1, TLC from tla2tools
(2026-08 release), Agda 2.8.0, fast-check 4.9.0, Node 22.

Reproduce with the `run.sh` / `run.mjs` in each tool directory.

## Mutant detection

`caught` names the invariant that failed. `—` means the level is out of scope
for that encoding, not that the tool is incapable.

| Mutant | Defect | fast-check L1 | fast-check L2 | Quint simulate | Quint verify (Apalache) | TLC |
|---|---|---|---|---|---|---|
| M0 | none | clean 0.1s | clean 1.8s | clean 3s | no verdict, terminated at 45 min | clean 2s, 96 000 states |
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
flake to be retried. Quint's own witness counts show the mechanism, and `quint/run.sh --witnesses`
prints them: `settledReached` fires in 6 traces out of 50 000, 0.01%, while `crashReached`
fires in 99.91% of them. Sampling coverage is the number to look at, not the pass.

fast-check's 0/10 against Quint's 4/10 is an encoding difference, not a tool
difference: fast-check generates a blind action list up front, while Quint's
simulator picks among *enabled* actions at each step and therefore wastes far
fewer steps on disabled guards. `fc.commands` would close most of that gap.

**Exhaustive beats symbolic at this size, by a lot.** TLC enumerated all 96 000
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
`tlaplus/run.sh --m8`: TLC reports the *faithful* model violated in about a
second, for every mutant including M0. The state count varies between runs
because TLC stops at the first violation and the workers race. The tool is right and the
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
| Agda, L1 | checks under `--safe` | n/a, defects are unwriteable or unprovable | <1s |
| Agda, L2 | `Inv` proved of every reachable state | n/a, the proof is the check | 2s |
| Lean 4, L1 | all proofs check | 3 rejected, `unsolved goals` | 2s |
| Lean 4, L2 | `Inv` proved of every reachable state | n/a, the proof is the check | 2s |
| Dafny, L1 | 11 obligations verified | 3 rejected, `postcondition could not be proved` | 1s |
| Dafny, L2 | 40 obligations verified | 3 rejected, incl. the non-inductive invariant | 2s |
| Alloy 6, L1 | 4 checks UNSAT, 2 witnesses SAT | the misordered-parent counterexample constructed | 2s |
| Alloy 6, L2 | `Inv` holds to 14 steps; `Inv` is inductive | CTI to `attemptsBounded` found in 49ms | 361s |

Alloy is the only one of the four that reports a *counterexample* rather than a
refusal: `check parentsOrderedUnderMutant` returned SAT with a concrete
misordered candidate. Dafny and Lean name the unproved goal instead, which is
less informative about the input and more informative about the specification.

**L2 in Lean and Agda is the sharpest single result in the bake-off.** TLC needs
`MaxAttempts`, `MaxExternalAdvance`, and a `StateConstraint` to stay finite —
concessions to enumeration, not domain facts. `L2.lean` and `L2.agda` have none: `head`,
`attempts`, and `capacity` are unbounded `Nat` and the proof covers every
reachable state. It does *not* generalize over the task set; `TaskId := Bool`
is still two tasks.

The price is one specific thing. `attemptsBounded` is **not inductive** — in
the `planAttempt` case the hypothesis permits `attempts = 1` and the action
produces `2` — so the proof is impossible until the invariant is strengthened
with `phaseBoundsAttempts`. TLC was handed the same invariant and never asked.
**A model checker discovers the reachable set; a proof assistant makes you
characterize it.** The 500 lines and the tactic fluency are mechanical next to
that.

**Four tools, four positions on one axis.** This is the single most useful
thing the bake-off produced:

| Tool | What you supply | What it does |
|---|---|---|
| TLC | an invariant | discovers the reachable set |
| Alloy | an invariant | tells you whether it is inductive |
| Lean / Agda | an **inductive** invariant | you prove every case by hand |
| Dafny | an **inductive** invariant | SMT proves every case |

The same obstruction — `attemptsBounded` is not inductive — shows up as a stuck
`planAttempt` goal in Lean and Agda, a SAT counterexample in Alloy, and a
method that cannot re-establish its own class invariant in Dafny. TLC never
mentions it.

**Alloy sits between the two, and that is the practical takeaway.** It is the
only tool here that answers *"is my invariant inductive?"* directly.
`attemptsAloneIsInductive` returns SAT in 49 ms with a two-state counterexample:
`phase = Claimed`, `attempts = 1`, one `planAttempt`, `attempts = 2`. That state
is unreachable from `init`, which is exactly what a strengthening is for — it
excludes a state the transition relation permits but the reachable set never
contains. TLC never mentions induction; Lean and Agda give you a stuck goal.
If a proof is the destination, run the Alloy inductiveness check first.

Two invariants exist here that no state-machine encoding could state honestly.
I11 (claim exclusivity with an exact token) and I12 (two ordered candidate
parents) are booleans in the Quint, TLA+, and fast-check models — a mutant
flips the flag and the "detection" tests the flag. In Alloy they are relations
over atoms, so the defect is a shape and the solver searches for it.

## Liveness (I17-I19)

The temporal half of `INVARIANTS.md`, checked last and the only place where the
ranking from the safety results reverses.

| Tool | I17 pause | I18 no silent drop | I19 quiescence | Cost |
|---|---|---|---|---|
| TLA+ / TLC | holds | holds at 1 task; **no verdict at 2 in 30 min** | holds at 1 task | 28s / 6s / 4s |
| Alloy 6 | holds in scope | holds in scope | holds in scope | **~73s for the file** |
| Quint | statable, **no backend** | statable, no backend | statable, no backend | Apalache: `Handling fairness is not supported yet!` |
| Quint `--backend tlc` | holds, 96 000 states | TLC's problem | TLC's problem | 35s |
| fast-check | holds (bounded) | **holds vacuously** | **holds vacuously** | ~3s each |
| Dafny | **not expressible** | not expressible | not expressible | — |
| Lean / Agda | statable, not attempted | statable, not attempted | statable, not attempted | a second development |

Alloy scopes: 2 Task, 5 Int, 1..12 steps. TLC: full reachability under
`StateConstraint`, 30-minute budget per property; the 1-task column is
`tlaplus/run-liveness.sh --small`, 1 824 states. fast-check: 20 000 runs,
25-step prefix, 40-step drain.

### A run stuck forever violates no safety property

That is the entire argument for checking liveness, and one property demonstrated
it. Stated as `phase = "Executing" ~> phase = "Settled"`, I18 failed with a
ticket parked in `Integrating` at `expectedHead = 1` against `targetHead = 2`,
then `State 11: Stuttering`. `Promote`'s compare-and-set guard was permanently
unsatisfiable and the only escape in the model was a crash. Nine safety
invariants, three engines and 96 000 states had nothing to say about it.

Two things were wrong, and only one was the model. The property had dropped half
of I18 — the invariant reads "settles **or is retained together with an exact
stated reason**" — and the model had no state for the second disjunct.
Production does: `CorrectionRequired` bounded by `CORRECTION_LIMIT`, terminating
in `CorrectionLimitReached`. Hence the `Abandoned` phase, the only addition
liveness demanded, added to all five executable encodings. Every safety verdict
was unchanged; the state count moved 81 792 → 96 000.

### The hard part is the hypotheses, and only the domain can settle them

The properties are one line each. Everything difficult is in the spec around
them, and the difficulty is always the same question: **what is the environment
entitled to do, and what does the system guarantee in return?**

I17–I19 need `<>[]~crashed`, `<>[]~paused`, `<>[](capacity > 0)`. None of the
nine safety invariants needed a hypothesis at all.

The instructive case is a hypothesis that turned out *not* to be needed.
`SF_vars(Progress(t))` — fairness on the disjunction of the lifecycle actions —
yields a lasso cycling `Executing → SuspensionRequested → Suspended → Executing`
with `ReportAccepted` enabled at every pass and never chosen. Two fixes remove
it, and they are not equivalent:

| Spec | Property | TLC |
|---|---|---|
| disjunction fairness | I18 | **violated** |
| disjunction fairness | I18 + `EventuallyUninterrupted` | holds |
| per-action fairness | I18 | holds |

`docs/CONTEXT.md` decides between them. Executor-work suspension is defined as
the executor's proof that its work "is safely stopped, **has preserved what it
needs to resume the same attempt**, and has no executor-owned activity for that
attempt still running". Progress survives the cycle, so an operator suspending
forever does *not* prevent completion — the lasso is an artifact of work being
atomic in the model, where a cycle that preserves progress and one that makes
none are the same state sequence.

So row 3 is faithful: per-action SF abstracts preservation plus finite work plus
fair scheduling. Row 2 buys the same verdict by assuming the operator away, and
states an I18 weaker than the system actually provides.

**Neither the tool nor the model can tell you which fix is right.** Both make
the counterexample disappear. That is the most transferable thing in this
study: a liveness counterexample is a question addressed to the domain, and the
model is not where the answer lives.

`alloy/DeliveryLiveness.als` keeps the lasso as a checked control,
`interruptionForeverBreaksI18`, and hands it back as a structure you can step
through rather than as console text. Strong-over-weak fairness has its own
independent justification: `StartIntegration` is repeatedly enabled and disabled
under an exclusive target, and WF permits starving one task forever.

### The vacuity that nearly got away

I17 was stated as `[]paused => <>(positions = {})` in TLA+, Alloy and Quint, and
reported clean in all three. `Init` sets `paused = FALSE`, so **no behaviour
satisfies `[]paused`** and the property was vacuously true everywhere — a clean
verdict over an empty set of behaviours, including the 29-second TLC run and the
96 000-state Quint cross-check.

The fix is `<>[]paused => <>[](positions = {})`, plus a witness that the
hypothesis is satisfiable at all: TLC refutes `[]<>(~paused)`, and Alloy's
`run pauseIsSustainable` is SAT.

Worth dwelling on, because this study has a rule about exactly this — every
clean result paired with a witness that the interesting state is reachable — and
the rule was applied to the *conclusions* of these properties and not to their
*hypotheses*. An implication is vacuous from either end. Nothing in any of the
three tools said a word.

### Where bounded checking gives out: arrival

I19 reads "**with no new tracker facts** the run reaches quiescence". Every
encoding here omits that hypothesis, because none of them can express new
facts: the task set is fixed and no phase returns to `NoObligation`, so work is
exhaustible by construction. A clean I19 verdict is weaker than it looks.

`ArrivalSpec` in `tlaplus/DeliveryLiveness.tla` adds arrival by recycling
finished tickets. Neither route gives a usable answer:

| | verdict |
|---|---|
| no state constraint | no verdict in 7 minutes |
| `CONSTRAINT StateConstraint` | both properties hold, 5 472 states |

Every completed responsibility advances `targetHead`, so an endless arrival
stream is an endless state space. Adding the constraint makes it finite and
makes the verdict *wrong*: quiescence-without-the-hypothesis should be false,
and comes back clean only because the constraint truncates the recycling loop
before it closes. That is the state-constraint-plus-liveness hazard TLC warns
about, in the concrete.

The practical consequence: cap arrivals, and not for realism — an uncapped
stream is not checkable here by either route. The cap belongs in the hypothesis,
which is what I19 already said.

### The cost ordering inverts

For safety, TLC was the outright winner: 96 000 states in 3 seconds, every
mutant caught, and Alloy's L2 file took 361s. For liveness:

| | safety | liveness |
|---|---|---|
| TLC | 3s | 28s for I17; no verdict for I18 at 2 tasks in 30 min |
| Alloy | 361s | ~73s for all three |

Same model, same machine. The explanation is that they are answering different
questions. TLC checks every behaviour of the finite state graph against a
tableau whose size is exponential in the number of fairness conjuncts. Alloy
searches for a counterexample **lasso of bounded length** — 12 steps here. "No
counterexample lasso within 12 steps" is a real result and a strictly weaker
one, and it is what makes Alloy cheap.

The practical reading: Alloy is the tool to reach for first on a liveness
question, and its answer does not mean what TLC's means.

### Where the vocabulary and the engine part company

Quint states these properties better than anything else here. `always`,
`eventually`, `weakFair` and `strongFair` are builtins, `strongFair(A, v)` *is*
`SF_v(A)`, and `enabled` is a builtin so I19 is one line —
`eventually(always(not(step.enabled())))` — against ten hand-written guard
predicates in Alloy.

Then `quint run` cannot evaluate temporal operators at all, `quint verify`
prompts you to reconsider before it will try, and Apalache stops at

```
error: Handling fairness is not supported yet!
```

Every property in this catalog needs fairness, so for Apalache the answer is not
"slow", it is "cannot". `--backend tlc` works and reports 96 000 states, exactly
matching the independently hand-written `tlaplus/Delivery.tla` — a useful
cross-check that the two models agree. For liveness, Quint is a front end for
TLC.

Alloy's problem is the mirror image: the engine handles liveness well and the
*language* has no `ENABLED`, no `WF_`/`SF_`, and no way to abstract over a
formula. The trace is fixed, so "some successor satisfies A" is inexpressible
and every guard has to be restated as an `en*` predicate that duplicates its
action. That drift is not hypothetical — the first `enAcquireClaim` here carried
a selection guard copied from the TLA+ model that `DeliveryL2.als` does not
have, and a wrong `enabled` predicate weakens fairness silently while the check
still passes.

### The one hard "cannot", and the one vacuous pass

**Dafny cannot state these at all.** No temporal operators, no `~>`, no fairness
vocabulary. `decreases` proves one call terminates and says nothing about a
reactive system that never terminates by design. A ticket parked in
`Integrating` forever is a fully verified `Delivery` object. This is the only
capability gap in the bake-off rather than a cost difference — and it lands on
the tool with otherwise the most complete L2 encoding.

**fast-check passes, and the witnesses say it means nothing.** All three
bounded surrogates hold in about 3 seconds each. At the default budget of
20 000 runs and a 25-step prefix, over 40 000 task slots:

| Witness at end of prefix | count | share |
|---|---|---|
| Executing | 88 | 0.22% |
| Integrating | 4 | 0.01% |
| staleIntegrating | **0** | 0.00% |
| Settled | 1 | 0.00% |

A *stale* `Integrating` is never reached, so I18 and I19 pass without once
visiting the state they exist to constrain, and the `--no-abandon` negative
control — which removes the escape hatch that state needs — **still passes**.
A control that does not fire.

Raising the prefix to 150 steps fixes the shallow phases and not this one:
`Integrating` reaches 357 and `Settled` 1 243, while `staleIntegrating` stays
at 0. Switching to fast-check's own `fc.commands` idiom, choosing among
*enabled* actions rather than discarding disabled ones, has the same shape of
effect.

Same lesson as M6, stated more starkly: deep protocol states are not reachable
by random walk, and a passing property-based test carries no information about
them.

## Cost

| Tool | Setup | Encoding | Level covered |
|---|---|---|---|
| fast-check | none, already a dependency | 221 lines model + 100 lines harness | L1 + L2 |
| Quint + Apalache | `brew install quint`, Apalache auto-fetched | 556 lines | L1 + L2 |
| TLA+ / TLC | one 2 MB jar, no install | 313 lines | L1 + L2 |
| Alloy 6 | one 21 MB jar, no install | 197 lines L1 + 318 lines L2 | L1 structural I11/I12, and L2 temporal |
| Dafny | 100 MB release zip | 158 lines L1 + 370 lines L2 | L1 on code-shaped definitions, and L2 as a class invariant |
| Lean 4 | elan, no Mathlib needed | 125 lines L1 + 500 lines L2 | L1 incl. half of I2, and L2 |
| Agda | `brew install agda`, no stdlib needed | 144 lines L1 + 580 lines L2, both incl. a hand-rolled prelude | L1 without I2, and L2 |

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
