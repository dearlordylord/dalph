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

I11 and I12 are the reason Alloy is in the lineup. In the Quint, TLA+, and
fast-check encodings, "a candidate has exactly two ordered parents" and "at
most one claim per task, with an exact token" are **booleans a mutant flips**.
That tests the flag, not the shape.

Here they are relations over atoms. `Claim` is a signature with `task`, `owner`,
and `token` fields, so `all t : Task | lone c : Claim | c.task = t` is a real
structural constraint, and Alloy searches for two distinct claims on one task
rather than checking whether someone remembered to set a flag.

`check parentsOrderedUnderMutant` returned SAT: Alloy constructed a candidate
whose first parent is not the expected head, which is the M3 defect as an
object rather than as an assertion.

## What it gave up

There is no transition relation in `Delivery.als`. Alloy 6 has temporal
operators and `var` signatures, and the state is declared with them, but the
checks quantify over well-formed states rather than over a hand-written step
relation. That means it says nothing about I16–I19, and its I7 result is weaker
than TLC's — it constrains states, not the transitions between them.

Everything is also bounded by scope (4 Task, 4 Head, 4 Commit, 1 step). "Holds
in scope" is not "holds". The small scope hypothesis is an empirical claim, not
a theorem.

## Cost

95 lines including comments, 2 seconds for all seven commands. Per unit of
structural insight it is the cheapest tool here; per unit of temporal
confidence it is the most expensive, because it offers none.

## L2: a real transition system, and the counterexample to induction

`DeliveryL2.als` is the protocol as `var` state with temporal formulas, not the
state-only encoding of `Delivery.als`. Same actions and invariants as the
Quint, TLA+, Lean, and Agda files. 280 lines, 501 seconds for all nine
commands — by far the slowest tool here, and the reason is scope: 14 steps of a
17-action relation over two tasks is a large SAT problem.

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
*mechanically*, as a two-state counterexample, in 61 milliseconds.

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

The tax is the frame conditions. Alloy has no `UNCHANGED`, so all seventeen
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

## Liveness

`DeliveryLiveness.als` checks I17–I19. All three hold in scope, in **94
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

`disjunctionFairnessIsTooWeak` is a deliberate negative control: fairness on the
disjunction of actions rather than per action. It is SAT, and the instance is
the same `Executing → SuspensionRequested → Suspended → Executing` lasso TLC
found — except Alloy hands it back as a structure you can step through in the
visualizer rather than as 14 states of console text. For a mistake this easy to
make, that presentation is worth a lot.
