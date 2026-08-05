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
