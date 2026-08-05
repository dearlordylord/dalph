# Lean 4

## Setup

`elan` via the official install script, then `lean L1.lean`. No Mathlib, no
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
