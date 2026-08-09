# Lean 4

## Setup

`elan` via the official install script, then `lean L1.lean`. The toolchain is
pinned by `lean-toolchain` (`leanprover/lean4:v4.32.2`), the version the Linux
re-run checked against. No Mathlib, no
`lakefile`, no project scaffolding — the file is self-contained and checks in
2 seconds. That is a much lower barrier than Lean's reputation suggests, and it
only holds because L1 needs nothing beyond `List` and `Nat` from core.

Adding Mathlib would change this picture entirely: a Mathlib-dependent project
is a multi-gigabyte build, and that cost is the real Lean setup story for
anything with genuine mathematical content.

## Character, against Agda

The pair `agda/L1.agda` and `lean/L1.lean` is the same specification twice, and
the difference that shows up is automation, not expressiveness.

Both hold I3 the same way: `Standing.excluded` takes a head reason and a tail,
so a reason-free exclusion is unwriteable. That is a language feature they
share, and it is the single best argument for either of them on this codebase.

Where they part:

- Agda's `select-exact` needed a hand-written `cong` lemma after `with ... refl`
  failed on `SplitError.UnificationStuck`. Lean's `select_exact` is
  `simp [select, ih ts, Nat.succ_min_succ]` — one line, no auxiliary lemma.
- Agda's prelude is 45 lines of hand-rolled `Nat`, `List`, `_∈_`, `_<=_`. Lean's
  core library supplies all of it, so the file starts at the domain.
- Lean's error messages named the wrong lemma (`Nat.min_succ_succ` does not
  exist, `Nat.succ_min_succ` does) without suggesting the right one, which is
  the standard cost of a large searchable library.

I2, order independence, is the property Agda could not afford. Lean gets the
*length* half in three lines by rewriting through `select_exact`. The contents
half still needs a normalization function and is still absent. So Lean lowers
the cost of this property substantially without making it free — the ratio
moved, the conclusion did not.

## `decide` versus `native_decide`

The witnesses were first written with `native_decide`, which evaluates via the
compiler and therefore adds the Lean compiler to the trusted base. Plain
`decide` runs in the kernel and worked here at no noticeable cost, so that is
what the file uses.

This is worth knowing precisely because it is the one place where a Lean proof
can quietly stop being a kernel-checked proof. The whole trust argument for
these tools — the LLM proposes, a small kernel disposes — depends on not
reaching for `native_decide` out of habit.

## Mutants

`L1Mutants.lean` restates each faithful theorem over a defective definition.
All three are rejected with `unsolved goals`. Like Dafny, and unlike the model
checkers, the failure names the goal rather than the input that breaks it.

## L2: the protocol, and what a proof assistant charges for it

`L2.lean` is the delivery protocol of `../MODEL.md` as an inductive `Step`
relation, with `Inv` proved to hold of every reachable state. Same actions and
same invariants as `../quint/deliveryCore.qnt` and `../tlaplus/Delivery.tla`.

500 lines, checks in about 2 seconds, no imports.

### What Lean buys

TLC needed artificial bounds to stay finite: `MaxExternalAdvance`,
`MaxAttempts`, and a `StateConstraint` on `targetHead`. Without them it does not
terminate. Those bounds are not domain facts, they are concessions to the
enumeration.

The Lean proof has none. `head`, `attempts`, and `capacity` are unbounded
`Nat`, and `inv_reachable` covers every reachable state of that unbounded
system. That is a real gain and it is the honest core of the "bounded checking
is not verification" argument.

What it does **not** buy here: generality over the task set. `TaskId := Bool`,
so this is still the two-task model. Proving it for `n` tasks is a different and
larger development, and nothing about using a proof assistant made it free.

### What it costs: the invariant is not what you wrote

The whole cost is in one place. `attemptsBounded` — at most one planned attempt
per task — is **not inductive**. In the `planAttempt` case the hypothesis
`attempts ≤ 1` permits `attempts = 1`, and the action produces `2`. The proof
is impossible until the invariant is strengthened with:

```lean
def phaseBoundsAttempts (s : St) : Prop :=
  ∀ t, ((s.ticket t).phase = noObligation ∨ (s.ticket t).phase = claimed)
        → (s.ticket t).attempts = 0
```

No model checker ever asked for this. TLC was handed `OneAttemptPerTask` and
found the reachable states itself; the strengthening is implicit in its
enumeration and never has to be stated, named, or maintained.

That is the trade in one sentence: **a model checker discovers the reachable
set, a proof assistant makes you characterize it.** Everything else — the 500
lines, the case analysis, the tactic fluency — is mechanical next to that.

### The vacuity discipline transfers, and is easy to skip

`inv_reachable` quantifies over reachable states, so it would hold vacuously if
nothing interesting were reachable, and `Inv` could in principle hold of every
state. Both would type-check and prove nothing. `L2.lean` therefore carries:

- `executing_is_reachable` and `stale_head_is_reachable`, explicit traces
  written out state by state
- `inv_is_refutable`, a concrete state that violates `Inv`

`stale_head_is_reachable` is the same check that exposed mutant M6: without
`externalTargetAdvance` in the model, a captured head can never go stale and
`promote`'s compare-and-set guard is unreachable.

Writing those traces by hand is work a model checker does for free.

### Lean friction worth knowing

`cases hs with | acquireClaim s t h1 h2 => ...` is wrong. `Step s s'` has `s` as
an index, so unification consumes it and every alternative binds one fewer name
than the constructor declares. Getting this wrong produces a cascade of
confusing downstream errors.

Goals are stated about `{ s with ... }` structure literals, so `rw` cannot see
through `upd s.ticket t v u`. The fix that made the rest routine was to have
helper lemmas take the field equations as hypotheses discharged by `rfl` at the
call site — `rfl` checks up to iota, `rw` does not.

Trace states must be `abbrev`, not `def`. As `def` they are only semireducible
and the unifier will not see that the state a `Step` constructor produces is
the next named state.

### The LLM workflow, tested

The skeleton, the invariant, and the strengthening were written by hand. A
subagent was then given the file with three `sorry`s and the constraint that no
definition or theorem statement could change.

It discharged all three in **two compile-check iterations**, factoring six
helper lemmas out of the 17-constructor case analysis. Verified independently
rather than taken on report: `lean L2.lean` exits silently, no banned
constructs, and `#print axioms` shows only `propext` and `Quot.sound` — no
`sorryAx`, no `Classical.choice`.

So the loop works exactly as advertised: the model is a proof generator, the
kernel is the oracle, and a wrong proof is rejected rather than believed.

The part worth noticing is what it was not asked to do. It did not invent the
invariant, and it did not discover that `attemptsBounded` needs
`phaseBoundsAttempts` to go through. Those were supplied. That is precisely the
division every essay in this area predicts: the mechanical proof labour is
collapsing, and deciding what to prove is not.

## Journal fold: concrete interpreter, factored proof

`Journal.lean` checks as part of `run.sh`. It keeps the complete 23-event
classification and proves P2 (`fold_homomorphism`) and P3
(`regional_contradiction`) for the concrete guards and effects over arbitrary
natural task identifiers. P1 and P4 are structural consequences of ordinary
total, pure definitions.

The useful Lean affordance is `List.foldl_append`: P2 is one theorem
application. P3 is where the authored proof lives—one exhaustive live-step
projection followed by induction over `SharedValid`. `prover-mutants.mjs lean`
removes an event case, swaps prefix/suffix, and corrupts unrelated-region
handling; all three must be rejected.

The transition is a separately authored port of `fastcheck/journal.mjs`, not a
machine-checked translation. `../LEARNING.md` keeps that correspondence
boundary explicit.

`JournalRefinement.lean` adds a different boundary: `StateRefines` explicitly
compares the historical L2 fields with the state reconstructed by the Lean
journal fold. `EmissionProgress` represents an in-flight output batch, so the
claim-intent crash prefix is proved to be part of an actual L2 emission rather
than merely an arbitrary list that happens to fold. The completed suffix
refines the actual claim successor, and the regional theorem relates B's
emitted successor while A carries additional journal-only failure evidence.
`JournalRefinementMutants.lean` must reject resetting the prefix, leaking A's
failure to B, and leaving the completed emission at its source state.

## Liveness: statable, and a different development

I17–I19 are expressible here, unlike in Dafny, but nothing in `L2.lean` is
reusable for them. The safety proofs are induction over `Reachable`, a finite
tree; liveness is a statement about infinite behaviours, so it needs a
coinductive `Trace` (or `Nat → St` plus a step law), a fairness predicate as a
hypothesis, and well-founded arguments to get the "eventually" out.

The concrete shape of I18:

```lean
def Fair (r : Nat → St) : Prop :=
  ∀ t, (∀ n, ∃ m ≥ n, enabled (reportAccepted t) (r m)) →
       (∀ n, ∃ m ≥ n, takes (reportAccepted t) (r m) (r (m+1)))

theorem every_begun_settles (r : Nat → St) (h : IsRun r) (hf : Fair r) :
    ∀ n t, (r n).ticket t |>.phase = executing →
      ∃ m ≥ n, ((r m).ticket t).phase = settled ∨ ((r m).ticket t).phase = abandoned
```

`abandoned` does not exist in `L2.lean`. Per `../MODEL.md`, the phase was added
to the five executable encodings and not to the two proof developments, so the
sketch above assumes it would be added first — 17 more proof cases, changing no
safety result.

The proof is a ranking function on phases — `Executing` 4, `Accepted` 3,
`Integrating` 2, `Promoted` 1, terminal 0 — plus the argument that fairness
forces the rank down and no action raises it. That is a well-founded recursion
over `Nat`, and roughly the size of the existing L2 development again.

The payoff is that it would be a proof about **unbounded** runs with an
arbitrary number of steps, which no model checker in this bake-off delivers.
The cost is that TLC states the same thing in one line and answers in seconds
at one task. Not attempted here, and the ratio is the reason.
