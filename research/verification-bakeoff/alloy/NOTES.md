# Alloy 6

## Setup

One 21 MB jar, no installation. `run.sh` fetches it. Note that Alloy writes its
command summary to **stderr**, not stdout, which is easy to lose in a pipeline.

## Character

Alloy is the odd one out here and that is why it is worth running. Every other
tool asks "does this machine ever reach a bad state". Alloy asks "does a
structure satisfying these constraints exist", and the answer comes back as a
concrete instance.

That inverts how results read:

| | meaning |
|---|---|
| `check` UNSAT | no counterexample in scope, the property holds |
| `check` SAT | counterexample found |
| `run` SAT | the witness state exists, so the check was not vacuous |
| `run` UNSAT | the witness is impossible |

Getting this backwards is the classic first mistake, and the table is in
`run.sh` for that reason.

## What it did that the others could not

I11 and I12 are the reason Alloy is in the lineup, and the reason is stronger
than it first looks: **no other encoding in the bake-off states them at all.**
There is no `Claim` and no `Candidate` in the Quint, TLA+, fast-check, Dafny,
Lean or Agda models. A claim carrying an exact token and a commit with two
ordered parents are relational shapes, and a state-machine language prices them
high enough that the shared model dropped them.

Here they are relations over atoms. `check parentsOrderedUnderMutant` returned
SAT: Alloy constructed a candidate whose first parent is not the expected head,
which is the M3 defect as an object rather than as an assertion.

### I11 was a tautology, and the witness is what said so

`check claimsAreExclusive { wellFormed implies claimExclusivity }` looks like a
structural search and is not one, because `wellFormed` *contains*
`claimExclusivity`. `P implies P` is UNSAT, `run.sh` prints "holds in scope",
and nothing about claims has been tested.

The repair is to derive exclusivity instead of assuming it. `acquireClaim`
carries the guards I11 rests on — no existing claim for the task, and a token
never yet minted — and `claimsAreExclusive` asks whether a second claim is
*reachable* over six steps. `claimsExclusiveUnderMutant` drops the guard and
comes back SAT with the double claim.

The second sentence of I11, "a token from an earlier claim authorizes nothing",
needs history rather than state. A rule that avoids the tokens of *live* claims
lets a released token come back, and no state predicate can see the difference:
at every instant the tokens are still unique. Hence `var sig Issued in Token`,
and `releasedTokensNeverReturn` over `Issued - Claim.token`. The mutant that
mints from `Token - Claim.token` instead of `Token - Issued` is caught by that
check and by nothing else.

What is *not* checkable here is the release side. `releaseClaim[c, o, k]`
requires `c.owner = o and c.token = k`, and every call site supplies
`releaseClaim[c, c.owner, c.token]` — so the guard constrains nothing. "A
release names the exact current owner and token" is a precondition on a
*caller*, and a model whose caller can always read the claim it is releasing
cannot exhibit the defect. Stating it looks like coverage and is not.

Two hazards showed up in doing it, both silent:

- A **static field inside a `var sig`** forces the signature itself to be
  constant. With `task : one Task` rather than `var task : one Task`, `no Claim
  and some Claim'` is UNSAT, no claim can ever be acquired, and both checks pass
  over frozen traces. Alloy emits a warning, not an error.
- The `run claimsAreAcquired` witness is what caught it. Without a witness that
  the machine moves, a temporal check over `always claimStep` is satisfied by
  stuttering forever.

### What this file assumes rather than checks

`positionDiscipline` (I7), `targetResourceExclusive` (I14) and `boundRespected`
(I1) are conjuncts of `wellFormed` and appear in no check. They are inputs, not
results; TLC, Quint and fast-check are what verify them.

I13 is absent by nature rather than by omission. It constrains the promotion
transition, and this file has no transition relation apart from the claim
machine. As a state predicate — "an integrating task's captured head is the
current target head" — it is false of well-formed states, and `run
staleHeadIsPossible` is exactly that falsehood, deliberately, because a
captured head going stale is the phenomenon the compare-and-set guard defends
against.

## What it gave up

`Delivery.als` has one transition relation, `claimStep`, and it is there under
protest: I11 cannot be a result without it. Everything else quantifies over
well-formed states. Alloy 6 has temporal operators and `var` signatures, and
the state is declared with them, but a state-only encoding says nothing about
I16–I19, and it is why I13 has no home here at all.

Everything is also bounded by scope: 4 Task, 4 Head, 4 Commit, and 1 step for
the state-only checks, 6 for the claim machine. "Holds in scope" is not
"holds". The small scope hypothesis is an empirical claim, not a theorem.

## Cost

341 lines including comments, 12 seconds for all thirteen commands. Per unit of
structural insight it is the cheapest tool here; per unit of temporal
confidence it is the most expensive, because it offers none.

## L2: a real transition system, and the counterexample to induction

`DeliveryL2.als` is the protocol as `var` state with temporal formulas, not the
state-only encoding of `Delivery.als`. The same protocol as the Quint, TLA+,
Lean, and Agda files, though not the same action list: Lean and Agda have no
`Abandoned` phase at all, which `../MODEL.md` records as a deliberate
divergence. 319 lines, 324 seconds for all eight commands — by far the
slowest tool here, and the reason is scope: 14 steps of a
19-action relation over two tasks is a large SAT problem.

### The result that justifies the file

Alloy is the only tool in the bake-off that can be asked **"is my invariant
inductive?"** directly.

| Command | Result | Meaning |
|---|---|---|
| `invAlwaysHolds` | UNSAT | `Inv` holds along every trace from `init`, to 14 steps |
| `attemptsAloneIsInductive` | **SAT** | `attemptsBounded` alone is *not* inductive |
| `invIsInductive` | UNSAT | with `phaseBoundsAttempts`, induction goes through |

That middle row is the whole point. `attemptsBounded` is exactly the invariant
TLC discharged without comment, and exactly the one that cannot be proved by
induction in Lean or Agda until it is strengthened. Alloy finds the obstruction
*mechanically*, as a two-state counterexample, in 49 milliseconds.

`attemptsCounterexampleToInduction` exhibits it concretely: a task with
`phase = Claimed` and `attempts = 1`, one `planAttempt` step, and a successor
with `attempts = 2`.

That state is **not reachable from `init`** — `invAlwaysHolds` passes. An
unreachable counterexample to induction is precisely what a strengthening is
for: it rules out a state the transition relation alone permits but the
reachable set never contains.

So the three tool families line up on one axis:

- **TLC** enumerates the reachable set and never mentions induction.
- **Lean and Agda** demand an inductive invariant and give you nothing but a
  stuck goal when yours is not.
- **Alloy** sits between: it answers the induction question as a search, and
  hands back the missing case as a structure.

If the plan is to write a proof, running the Alloy inductiveness check first is
strictly cheaper than discovering the same thing from a failed `planAttempt`
case.

### Encoding notes

Relational override is the distinctive move:

```alloy
phase' = phase ++ (t -> Claimed)
```

One equation updates the touched task and frames every other. The Lean and Agda
encodings needed a hand-written `upd` function plus a family of lemmas about
it, and that machinery is most of their line count.

The tax is the frame conditions. Alloy has no `UNCHANGED`, so all nineteen
actions spell out everything they leave alone; the file carries five
`...Unchanged` predicates purely for that. TLA+'s `UNCHANGED << ... >>` is the
clear winner on this axis.

`init` is a **predicate, not a fact**, and that is load-bearing. As a `fact` it
would constrain every instance to begin at `init`, which silently turns the
inductiveness checks into statements about reachable states — the exact
question they exist to avoid. Writing `trace => always Inv` for reachability
and a bare `(Inv and step) => after Inv` for induction keeps the two apart.

Priming a predicate (`Inv'`) is a type error; the temporal operator is `after`.

### What it still does not give

Bounded twice over: 2 tasks, and 14 steps. "Holds in scope" is not "holds", and
unlike the Lean and Agda proofs there is no claim about unbounded `head`,
`attempts`, or `capacity`.

`Present` and `Opened` are **dead state**. `observeGraph` writes them, every
other action frames them, `init` empties them, and no guard and no invariant
reads them — `acquireClaim` here is deliberately not selection-gated. They
widen the step relation that the 324-second run pays for and constrain nothing.
Nothing reports this; a solver has no opinion about state you never constrain,
and the frame conditions make them look load-bearing.

## Liveness

`DeliveryLiveness.als` checks I17–I19. All three hold in scope, in about **131
seconds for the whole file** — cheaper than this directory's own safety run and
far cheaper than TLC, which does not return a verdict on I18 at two tasks in
half an hour. That ordering is the opposite of the safety result and is the
single most surprising measurement in the bake-off.

The reason is that Alloy is answering a smaller question. It searches for a
counterexample **lasso of bounded length**; TLC checks every behaviour of the
finite state graph. "No counterexample lasso within 12 steps" is a real result
and a weaker one.

### The properties read like TLA+; everything around them does not

`always` and `eventually` are first-class, so the property text is nearly
identical to `../tlaplus/DeliveryLiveness.tla`. Three things are not:

**There is no `ENABLED`.** Alloy fixes the trace, so "some successor state
satisfies A" cannot be stated — you cannot existentially quantify over the next
state. Every guard is therefore restated as an `en*` predicate that duplicates
the first line of its action, with nothing keeping the copies in agreement. The
hazard is not hypothetical: the first version of `enAcquireClaim` carried a
selection guard copied from the TLA+ model, which `DeliveryL2.als` does not
have. A wrong `enabled` predicate weakens fairness silently and the check still
passes.

**There is no `WF_`/`SF_`, and no way to abstract over one.** Predicates are not
values, so the strong-fairness schema

```alloy
(always eventually enPromote[t]) implies (always eventually promote[t])
```

is written out by hand, once per action, ten times. Quint's `strongFair` and
TLA+'s `SF_vars` are single tokens.

**Quiescence has to be spelled out.** `~ENABLED AnyProgress` becomes a
ten-disjunct `no t : Task | ...` over the same hand-written guards.

### Where it wins outright

Two negative controls reproduce, in Alloy, the three-row comparison
`../tlaplus/run-liveness.sh --lasso` runs in TLC:

| Command | Alloy | TLC's row |
|---|---|---|
| `interruptionForeverBreaksI18` | **SAT** | disjunction fairness, I18: violated |
| `interruptionRestoresI18UnderDisjunction` | UNSAT | + `EventuallyUninterrupted`: holds |
| `everyBegunSettles` | UNSAT | per-action fairness, I18: holds |

Alloy hands the lasso back as a structure you can step through in the
visualizer rather than as 14 states of console text.

The lasso is a modelling artifact. `docs/CONTEXT.md` defines safe suspension as
preserving what is needed to resume, so progress survives the cycle — atomic
work in the model is what makes a preserving cycle look like a stalling one.
Being able to *look* at the cycle rather than read fourteen states of console
text is what makes that diagnosis reachable, and it is the clearest thing Alloy
does better than TLC here.

**The control has to be the faithful port, and the first version was not.**
`sfDisjunction` was written over three actions — `reportAccepted`,
`safelySuspend`, `resumeWork` — where TLA+'s `SF_vars(Progress(t))` is the
disjunction of all ten. Row 1 was SAT either way, so the control looked
healthy; row 2 came back SAT too, disagreeing with TLC. The cause was that
nothing forced `startIntegration` at all, so the ticket parked in `Accepted`
and the suspend/resume lasso never had to appear. A negative control that fires
for the wrong reason still fires.
