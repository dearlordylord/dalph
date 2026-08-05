# Agda

## Setup

`brew install agda`, then `agda L1.agda`. The file defines its own `Nat`,
`List`, `_==_`, `_<=_`, and `_∈_`, so no standard library and no `.agda-lib`
are needed. Checked under `--safe`.

## Friction met while encoding

`in` is a keyword, so the membership relation cannot be named `_in_`. Unicode
`_∈_` is not decoration here, it is the workaround.

`with select-exact n ts` then matching `refl` fails with `SplitError.Unification
Stuck`: Agda cannot unify `length (select n ts)` with `min n (length ts)`
because neither side reduces. The fix is a congruence lemma —
`cong suc (select-exact n ts)` — which is the standard move and the standard
first stumble.

Everything else typechecks in well under a second.

## Character

The reason Agda is in the lineup is that it holds one invariant a different way
than every other tool.

I3 says an excluded task always carries at least one graph-owned reason. There
is no theorem for it in `L1.agda`. `Excluded` takes a `Reasons` record whose
`first` field is a `Reason`, so an exclusion without a reason is not a false
proposition — it is a term that cannot be written. The invariant costs zero
proof and zero runtime check, and no mutant can express the defect.

That is the same move the production code already makes: `TicketDelivery`
carries `readonly [TicketDeliveryStanding, ...ReadonlyArray<...>]`, a nonempty
tuple. TypeScript is doing dependent-types-lite in exactly this spot.

I1 and I4 cost real proofs, and they are short: three cases each, structural
recursion, no automation. Once written they hold for all inputs, not for 50 000
samples.

## The honest gap

I2, order independence, is absent. Stating it needs a permutation relation and
a proof that selection commutes with graph-order normalization — larger than
the whole rest of the file. The same property is one `fc.property` line with a
shuffle, and it already exists in
`packages/orchestrator/src/coordination/delivery/ticket-delivery-projection.property.test.ts`.

Structural invariants are free in the type system. Quantitative and
permutation-shaped ones are disproportionately expensive. That trade, not the
proof/test dichotomy, is what decides where this tool pays.

## L2: the protocol, without tactics

`L2.agda` is the same development as `../lean/L2.lean` — same model, same
invariant, same five fields, same theorem names — so reading them side by side
isolates the language rather than the modelling. 506 lines against Lean's 500.

That near-identical line count is the surprise, and it hides a real difference
in where the lines go.

### What Agda made easier

`upd` is defined by pattern matching on both task ids rather than with a
conditional:

```agda
upd f false v false = v
upd f false v true  = f true
upd f true  v false = f false
upd f true  v true  = v
```

Every application reduces definitionally once both ids are concrete, so the
proofs never reason about a decidable-equality test. The Lean encoding uses
`fun u => if u = t then v else f u`, and its single largest source of friction
was that `rw` cannot see through the resulting `ite` inside a `{ s with ... }`
structure literal — the workaround there was a family of helper lemmas taking
field equations discharged by `rfl`.

Agda also unfolds plain definitions during conversion checking, so the trace
states `t1`–`t7` work as ordinary definitions. Lean needed `abbrev`, because a
`def` is only semireducible and the unifier would not see that the state a
`Step` constructor produces is the next named state.

### What Agda made harder

**`with`-abstraction opacity.** `crashTicket` is defined with `with phase t`,
and a lemma that also does `with phase t` does not see it reduce. The fix was
to split the ticket record open so the scrutinee is a constructor, which turns
two lemmas into ten clauses each — one per `Phase`.

**No discrimination for free.** Lean closes a contradiction between
`phase = promoted` and `phase = integrating` with `simp` or `exact
absurd ...`. Agda cannot use an absurd pattern here, because after `trans`/`sym`
the subject is a neutral projection rather than a constructor. It needs an
explicit discriminator:

```agda
IntOnly : Phase -> Set          -- integrating -> Bot, everything else -> Top
clash : p == integrating -> IntOnly p -> A
```

That is a genuinely instructive moment: the thing a tactic language hides is
that propositional equality on an open term gives you nothing until you supply
a family that distinguishes the constructors.

### The same lesson, in both languages

The `planAttempt` case is where `phaseBoundsAttempts` earns its keep, and the
two proofs say the same thing in different registers.

Agda, explicit:

```agda
attA s t _ (subst (\ n -> suc n <= 1) (sym (phaseAttempts i t (inr e))) (s<=s z<=n))
     (attemptsOk i)
```

Lean, tactic:

```lean
(by simp [h.phaseAttempts t (Or.inr h2)])
```

Both consume `phaseBoundsAttempts` to learn `attempts = 0` before the increment.
Neither could be written without it, because `attemptsBounded` is not inductive.
The tactic is shorter; it is not doing anything the `subst` is not.

### The LLM workflow, second data point

Same protocol as the Lean file: the model, the invariant, and the strengthening
were written by hand, and a subagent was given the file with the three
obligations stubbed by a `postulate admit`, plus the requirement to delete that
postulate and restore `{-# OPTIONS --safe #-}` — which rejects postulates, so
the flag is a real check rather than a promise.

It succeeded in **one typecheck iteration**, against two for Lean.

That ordering is worth not over-reading. It is one trial each, the Agda task
was second so the design was already settled, and the agent reported working
the structure out before writing rather than iterating against the compiler.
The honest claim is narrow: a general-purpose model discharged a 17-constructor
inductive-invariant proof in a tactic-free dependently typed language with no
standard library, and the result was verified by the checker rather than
believed.

Verified independently: `agda L2.agda` clean after `rm -rf _build *.agdai`, no
`postulate`, no `TERMINATING`/`trustMe` pragmas, no imports, and the
definitions and type signatures unchanged.
