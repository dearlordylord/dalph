# Scoreboard

Measured on darwin/arm64, Quint 0.32.0, Apalache 0.56.1, TLC from tla2tools
(2026-08 release), Agda 2.8.0, fast-check 4.9.0, Node 22.

Reproduce with the `run.sh` / `run.mjs` in each tool directory. One caveat:
`node fastcheck/run.mjs` defaults to 20 000 runs and 25 steps and reports M4,
M5 and M6 *missed*. The table below is at `--runs 50000 --steps 40`, and the
gap between the two is itself the fast-check result.

## Mutant detection

`caught` names the invariant that failed. `—` means the level is out of scope
for that encoding, not that the tool is incapable.

| Mutant | Defect | fast-check L1 | fast-check L2 | Quint simulate | Quint verify (Apalache) | TLC |
|---|---|---|---|---|---|---|
| M0 | none | clean 0.1s | clean 1.8s | clean 3s | no verdict, terminated at 45 min | clean 2-3s, 96 000 states |
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
prints them: `settledReached` fires in low single digits of traces out of 50 000
— 2 and 6 on two runs, 0.00–0.01% — while `crashReached` fires in over 99.9% of
them. The counts are themselves sampled and move run to run, which is the point:
sampling coverage is the number to look at, not the pass.

fast-check's 0/10 against Quint's 4/10 is an encoding difference, not a tool
difference: fast-check generates a blind action list up front, while Quint's
simulator picks among *enabled* actions at each step and therefore wastes far
fewer steps on disabled guards. `fc.commands` would close most of that gap.

**Exhaustive beats symbolic at this size, by a lot.** TLC enumerated all 96 000
distinct states in 2-3 seconds and caught every mutant including M6. Apalache
found M6 in 38 seconds, but on the faithful model it reached step 12, began
discharging the state invariants, and was terminated at 45 minutes without a
verdict — a refutation is cheap for it, a clean bill of health is not. Bounded
symbolic checking pays off when the state space is wide, not when it is small
and finite, which is the opposite of the intuition that "SMT is the serious
engine."

**Asked the right question, the same engine answers in 27 seconds.** Apalache
cannot clear the faithful model by bounded reachability in 45 minutes;
`quint/run.sh --inductive` proves `inductiveInvariant` is preserved by every
step in 27, with no step bound and no state space. The difference is the
question, not the solver: reachability makes it unroll 12 transitions,
induction makes it discharge one. The price is that the invariant has to be
strong enough to be inductive and has to bound its own variables — `allInvariants`
as handed to TLC is neither, and the counterexample to induction says so in 15
seconds. See `quint/NOTES.md`.

**The tool that catches a mutant fastest is not the tool that taught the most.**
M6 was originally undetectable by every engine, because the first model had no
`externalTargetAdvance` action: with an exclusive integration-target resource, a
captured head can never go stale, so the compare-and-set guard was unreachable
and I13 held vacuously. No engine reports this. It surfaced only from asking
"can a stale head actually occur?" — which is why the witness refutation is part
of the protocol, not decoration.

**Two invariants could not be stated as state predicates at all.** I8 (admission
ceiling) and I13 (promotion) are properties of transitions. Quint, TLA+ and
fast-check carry a history variable for them; Dafny uses a loop invariant and a
precondition; Alloy, Agda and Lean rely on the action guards. **Lean also
declares history variables and then never touches them** — `admissionOk` and
`promotedExact` are set once in `init`, updated by no `Step`, and read by no
clause of `Inv`. That is decoration rather than absence, which is why nothing
reports it: an unused structure field is not an error, and the proof is no
harder for carrying two constants. In the I8 case the naive state predicate
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

`quint/run.sh --m8` reports M0 violated in one second, and every mutant with
it. Same random-simulation family as fast-check, opposite outcome, and the
reason is the one already given for M6: Quint picks among *enabled* actions
while fast-check generates a blind list. Nine ordered actions is out of reach
for one and routine for the other.

## The proof-and-structure tools

These do not fit the mutant table, because they do not search a state space.
Each states the invariant and either discharges it or refuses.

| Tool | Faithful | Mutants | Time |
|---|---|---|---|
| Agda, L1 | checks under `--safe` | n/a, defects are unwriteable or unprovable | <1s |
| Agda, L2 | `Inv` proved of every reachable state | n/a, the proof is the check | 2s |
| Lean 4, L1 | all proofs check | 3 rejected, `unsolved goals` | 2s |
| Lean 4, L2 | `Inv` proved of every reachable state | n/a, the proof is the check | 2s |
| Dafny, L1 | 10 obligations verified | 3 rejected, `postcondition could not be proved` | 1s |
| Dafny, L2 | 40 obligations verified | 3 rejected, incl. the non-inductive invariant | 2s |
| Alloy 6, L1 | 5 checks UNSAT, 3 witnesses SAT | 4 counterexamples constructed, one per check | 12s |
| Alloy 6, L2 | `Inv` holds to 14 steps; `Inv` is inductive | CTI to `attemptsBounded` found in 49ms | 324s |

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

**One axis, and every tool has a position on it.** This is the single most
useful thing the bake-off produced:

| Tool | What you supply | What it does |
|---|---|---|
| TLC | an invariant | discovers the reachable set |
| Alloy | an invariant | tells you whether it is inductive |
| Apalache, `--inductive-invariant` | an invariant **and its state bounds** | tells you whether it is inductive |
| Lean / Agda | an **inductive** invariant | you prove every case by hand |
| Dafny | an **inductive** invariant | SMT proves every case |

The same obstruction — `attemptsBounded` is not inductive — shows up as a stuck
`planAttempt` goal in Lean and Agda, a SAT counterexample in Alloy, a
counterexample to induction in Apalache, and a method that cannot re-establish
its own class invariant in Dafny. TLC never mentions it.

**The middle rows are the practical takeaway.** Alloy's
`attemptsAloneIsInductive` returns SAT in 49 ms with a two-state
counterexample: `phase = Claimed`, `attempts = 1`, one `planAttempt`,
`attempts = 2`. That state is unreachable from `init`, which is exactly what a
strengthening is for — it excludes a state the transition relation permits but
the reachable set never contains. `./quint/run.sh --inductive` returns the same
two states in 15 seconds, from the same `allInvariants` that `quint verify` and
TLC both discharge without comment — one CLI flag apart, same source file.

The 600× is not the interesting difference. Apalache runs the check *from* the
invariant, so the invariant must bound every variable, and those bounds then
have to be proved closed under `step`: dropping
`headAdvancesWithPromotions` yields a counterexample about the declared range of
`targetHead` rather than about the protocol. Alloy's `for 2 Task, 5 Int` states
the same bound outside the formula and never asks anyone to discharge it. Alloy
is the cheapest way to ask the question; Apalache asks a stricter version of it.

If a proof is the destination, run an inductiveness check first.

Two invariants appear in exactly one column. I11 (claim exclusivity with an
exact token) and I12 (two ordered candidate parents) are **absent from every
other encoding** — the Quint, TLA+, fast-check, Dafny, Lean and Agda models
have no claim entity and no candidate entity at all. In Alloy they are
relations over atoms, so a defect is a shape and the solver searches for it:
`parentsOrderedUnderMutant` constructs the misordered candidate,
`claimsExclusiveUnderMutant` constructs the double claim.

I11 nearly failed to be a result. Written as `wellFormed implies
claimExclusivity` with `claimExclusivity` a conjunct of `wellFormed`, the check
is `P implies P` — UNSAT, "holds in scope", and evidence of nothing. It now
derives exclusivity and token freshness from the guard on acquisition, over a
six-step relation of its own, with `run claimsAreAcquired` as the witness that
claims are acquired at all. That witness was UNSAT on the first attempt: a
static field inside a `var sig` silently forces the signature to be constant,
so no claim could ever be acquired and both checks passed over frozen traces.
Alloy reports that as a warning, not an error.

The same file assumes I1, I7 and I14 rather than checking them: they are
conjuncts of `wellFormed` that nothing is checked against. And I13 is not there
at all — it constrains the promotion *transition*, and as a state predicate it
is simply false, which `run staleHeadIsPossible` demonstrates.

## Liveness (I17-I19)

The temporal half of `INVARIANTS.md`, checked last and the only place where the
ranking from the safety results reverses.

| Tool | I17 pause | I18 no silent drop | I19 quiescence | Cost |
|---|---|---|---|---|
| TLA+ / TLC | holds | holds at 1 task; **no verdict at 2 in 30 min** | holds at 1 task | 28s / 6s / 4s |
| Alloy 6 | holds in scope | holds in scope | holds in scope | **~131s for the file** |
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

`alloy/DeliveryLiveness.als` reproduces all three rows —
`interruptionForeverBreaksI18` SAT, `interruptionRestoresI18UnderDisjunction`
UNSAT, `everyBegunSettles` UNSAT — and hands the lasso back as a structure you
can step through rather than as console text.

Getting the *control* right took two attempts, and the failure mode is worth
recording. Alloy's `sfDisjunction` was first written over three actions where
TLA+'s `SF_vars(Progress(t))` is the disjunction of ten. Row 1 was SAT either
way, so nothing looked wrong; row 2 came back SAT and disagreed with TLC.
Nothing forced `startIntegration`, so the ticket parked in `Accepted` and the
lasso never had to appear. **A negative control that fires for the wrong reason
still fires**, and only the cross-tool disagreement exposed it.

Strong-over-weak fairness has its own
independent justification: `StartIntegration` is repeatedly enabled and disabled
under an exclusive target, and WF permits starving one task forever.

### The vacuity that nearly got away

I17 was stated as `[]paused => <>(positions = {})` in TLA+, Alloy and Quint, and
reported clean in all three. `Init` sets `paused = FALSE`, so **no behaviour
satisfies `[]paused`** and the property was vacuously true everywhere — a clean
verdict over an empty set of behaviours, including the 28-second TLC run and the
96 000-state Quint cross-check.

The fix is `<>[]paused => <>[](positions = {})`, plus a witness that the
hypothesis is satisfiable at all: TLC refutes `[]<>(~paused)` and Alloy's
`run pauseIsSustainable` is SAT. Both are now driven by their runners —
`PauseIsSustainable` was written, committed, and then run by nothing, which is
the same defect one level up.

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
mutant caught, and Alloy's L2 file took 324s. For liveness:

| | safety | liveness |
|---|---|---|
| TLC | 3s | 28s for I17; no verdict for I18 at 2 tasks in 30 min |
| Alloy | 324s | ~131s for all three |

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
`SF_v(A)`, and `enabled` is a builtin so I19 is one line against ten
hand-written guard predicates in Alloy.

The tempting one-liner `eventually(always(not(step.enabled())))` is wrong, and
instructively so: `observeGraph` has no guard, so `step.enabled()` is true in
every state and the property is unsatisfiable rather than weak. Only the
lifecycle actions count, which costs a hand-written `anyProgress` disjunction —
still cheaper than Alloy, which needs that list *and* an `en*` duplicate of
every guard in it.

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

## What the catalog covers, and what it does not

Auditing `INVARIANTS.md` row by row against what each encoding actually
contains moved four rows, and the direction was always the same — the coverage
was overstated.

**I5 is discharged by five tools and provable by none of them.** Every
state-machine encoding states it as `phase = Settled ⇒ ¬hasObligation(t)` and
defines `hasObligation` as `phase ∉ {NoObligation, Settled}`. Substitute and it
is `⊤`. TLC, Quint, Apalache, fast-check and Dafny all report it discharged; no
mutant in `MUTANTS.md` can break it; and it reads like a real invariant. Dafny's
version now at least computes the obligation from an evidence value, so a
mutated `ObligatedFrom` would fail — the others cannot be repaired without
separating evidence from phase, which is a different model.

**Two invariants are in no tool at all.** I9 (every executor interaction
carries the exact `RunId` and `AttemptId`) and I15 (the journal is append-only
and its reduction a pure, total, idempotent fold) are absent from all seven
encodings. No model here has an identifier or a journal; `oneAttemptPerTask`
counts attempts and never names one. Those are two of the invariants production
leans on hardest, and the bake-off says nothing about either.

**Two more are in exactly one.** I11 and I12 exist only in `alloy/Delivery.als`
— and I11 only became a result during this audit, having been a `P implies P`
tautology before it.

**Three cells were assumptions dressed as results.** I1, I7 and I14 in the
Alloy L1 column are conjuncts of `wellFormed`, checked against nothing.

The pattern is that a grouped coverage table ("I7–I15: yes") hides exactly this.
The per-invariant table now distinguishes *checked*, *assumed*, *typed away* and
*not modelled*, because the last two are honest scope decisions and the first
two are not interchangeable.

## Cost

| Tool | Setup | Encoding | Level covered |
|---|---|---|---|
| fast-check | none, already a dependency | 221 lines model + 100 lines harness | L1 + L2 |
| Quint + Apalache | `brew install quint`, Apalache auto-fetched | 573 lines | L1 + L2 |
| TLA+ / TLC | one 2 MB jar, no install | 313 lines | L1 + L2 |
| Alloy 6 | one 21 MB jar, no install | 341 lines L1 + 319 lines L2 + 229 lines liveness | L1 structural I11/I12, and L2 temporal |
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

## Addendum: Linux aarch64 re-run

Everything above was measured on macOS/arm64. The whole study was later re-run
on Debian 12 aarch64 (a machine with qemu-user binfmt for x86_64), and every
slice reproduced its verdicts: TLC caught M1–M6 and M8 with the same invariant
names, fast-check caught M1/M2 and missed M4/M5/M6, Quint simulate caught all
six, Alloy's temporal checks and inductiveness results matched, Dafny verified
the faithful files and rejected all six mutants, and Lean and Agda checked
every proof and rejected every mutant.

What the re-run added:

- **Quint simulate's M6 flakiness is real and reproduced live.** At the same
  nominal budget (50 000 samples, 25 steps) one run caught M6 and the
  `--witnesses` rerun missed it. The harness now pins a seed, and the pin was
  chosen to be a seed that *does* reach the stale head — an arbitrary pin can
  bake in a false negative.
- **Lean is now pinned**: `lean/lean-toolchain` fixes `leanprover/lean4:v4.32.2`
  (the 2026 elan stable). The proofs check on it with no warnings, so the
  unrecorded toolchain version is no longer a compatibility question.
- **Agda runs from the prebuilt static x86-64 binary** (`Agda-v2.8.0-linux.tar.xz`)
  under qemu binfmt. Static linking is what makes this work; there is no
  linux-aarch64 build.
- **Alloy 6.2.0 ships no linux-aarch64 native SAT solver** (`findPlatform
  unknown Linux aarch64`) and falls back to pure-Java SAT4J — and still ran
  faster than the macOS figures above (DeliveryL2.als 239s vs ~324s). The
  predicted `open deliveryL2` module-resolution failure on case-sensitive
  filesystems did not occur; Alloy resolves `DeliveryL2.als` fine.
- **Dafny needed an arm64 recipe**: no prebuilt linux-aarch64 exists and the
  x64 build segfaults under qemu-user in Boogie's thread pool. The working
  combination — arm64 .NET 8 runtime, framework-dependent `DafnyDriver.dll`
  with six PE headers patched from x64 to AnyCPU, and an arm64 Z3 4.13.4 from
  the PyPI `z3-solver` wheel — is documented in `dafny/NOTES.md`,
  "Linux aarch64 workaround".

The fetchers are also pinned since the re-run: TLC's jar to release tag
`v1.7.4` (resolved from the releases API), all downloads atomic and
fail-closed, and Quint's simulate/witness runs to a seed.
