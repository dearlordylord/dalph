# Prover evidence: what the checker supplies and what we prove

This note pins the learning claims in the journal prover arms to language-owned
documentation and source. It is evidence for interpreting the local artifacts,
not a claim that accepting a program proves its domain specification is the
right one.

## Lean 4

- In Lean's logic, ordinary functions are total: every type-correct input has a
  result, and the function cannot diverge or fail because a pattern case is
  missing. `partial` and `unsafe` definitions are outside that logical claim.
  [Lean reference: Functions](https://lean-lang.org/doc/reference/latest/The-Type-System/Functions/)
- Recursive definitions are accepted only after Lean constructs a safety
  justification. Structural recursion is translated through recursors;
  well-founded recursion requires recursive calls to decrease, with inferred
  or authored `termination_by` evidence.
  [Lean reference: Recursive Definitions](https://lean-lang.org/doc/reference/latest/Definitions/Recursive-Definitions/)
- Pattern matching is elaborated into recursors and must cover the possible
  constructors. Consequently the explicit, wildcard-free matches over `Event`
  in `lean/Journal.lean` are rechecked if that datatype gains a constructor.
  [Lean reference: Pattern Matching](https://lean-lang.org/doc/reference/latest/Terms/Pattern-Matching/),
  [Elaboration and Compilation](https://lean-lang.org/doc/reference/latest/Elaboration-and-Compilation/)
- The exact library theorem used by local `fold_homomorphism` is
  `List.foldl_append`: folding `l ++ l'` equals folding `l'` from the accumulator
  obtained by folding `l`. The theorem is itself proved by induction in Lean's
  core library.
  [Lean 4 v4.32.2 source](https://github.com/leanprover/lean4/blob/v4.32.2/src/Init/Data/List/Lemmas.lean#L2722-L2724)

For the local journal, termination and exhaustive handling make `step` and
`fold` total **by construction**, so P1 needs no authored theorem. The
single-step result is deterministic because these are pure definitions; that
supports P4, but it does not prove that the chosen event semantics are correct.
P2 is the authored `fold_homomorphism`, whose proof delegates to
`List.foldl_append`. P3 is the authored `regional_contradiction`, built from
the one-step projection theorem and induction over `SharedValid`. Those
theorems quantify over the typed local/shared kernel; they do not prove that
the JavaScript oracle implements one particular kernel value.

## Agda

- Agda coverage-checks every pattern-matching definition to ensure its clauses
  are complete.
  [Agda manual: Coverage Checking](https://agda.readthedocs.io/en/latest/language/coverage-checking.html)
- Agda accepts only recursion it can mechanically establish as terminating;
  primitive and structural recursion descend through constructor subterms.
  [Agda manual: Termination Checking](https://agda.readthedocs.io/en/latest/language/termination-checking.html)
- `Journal.agda` is checked with `--safe`. Safe mode rejects options such as
  disabling termination or positivity checking that can admit looping terms or
  inconsistency.
  [Agda manual: Safe Agda](https://agda.readthedocs.io/en/latest/language/safe-agda.html)
- Agda's propositional equality is an indexed datatype whose constructor
  `refl` witnesses `x ≡ x`; equality proofs can drive rewriting. Inductive
  proofs are still programs the author supplies, usually by pattern matching on
  the relevant datatype. The official rewriting example demonstrates the
  characteristic `refl` base case and recursive `cong` step.
  [Agda manual: built-in equality](https://agda.readthedocs.io/en/latest/language/built-ins.html#equality),
  [Agda manual: inductive equality proofs](https://agda.readthedocs.io/en/latest/language/rewriting.html#rewrite-rules-by-example)

For the local journal, coverage plus termination makes `step`, `fold`, and
`fold-from` total **by construction**, which is P1's language-level part. P4's
same-input/same-result claim follows from the pure definitions, while semantic
correctness does not. P2 is not free: `foldl-append` is an authored induction,
then `homomorphism` instantiates it. P3 is the authored `regional` induction,
using `step-regions` to connect every live full step with the local-only fold.
The finite constructors for reasons, directions, tasks, and events make values
outside those alphabets unrepresentable; that does not prove that the
alphabets are complete domain models. In particular, this Agda arm proves the
two-task benchmark rather than arbitrary task cardinality.

## Dafny

- Dafny verifies functions against their specifications and checks recursive
  calls for termination. A `decreases` metric must descend in a well-founded
  order; Dafny may infer it, but functions cannot opt out with `decreases *`.
  [Dafny reference: decreases clauses](https://dafny.org/dafny/DafnyRef/DafnyRef#sec-decreases-clause),
  [Dafny FAQ: function termination cannot be disabled](https://dafny.org/latest/HowToFAQ/FAQNoTermCheck)
- A Dafny function may have `requires`, so "total" must be scoped to inputs
  satisfying its precondition. The local `Fold` and `FoldFrom` have none;
  the two-task state uses total datatype projections rather than partial map
  lookup.
  [Dafny reference: function specifications](https://dafny.org/dafny/DafnyRef/DafnyRef#sec-function-specification)
- Match statements and expressions must be exhaustive. The explicit matches on
  local `Event` and nested result datatypes therefore enforce consumer coverage
  when constructors change.
  [Dafny reference: Match Statement](https://dafny.org/dafny/DafnyRef/DafnyRef#sec-match-statement),
  [Match Expression](https://dafny.org/dafny/DafnyRef/DafnyRef#sec-match-expression)
- A lemma is an implicitly ghost method. Dafny verifies its body for every
  argument satisfying `requires`, then callers may use its `ensures`; a
  body-less, `{:axiom}`, or verification-disabled lemma is not proof evidence
  of the same kind.
  [Dafny reference: Lemmas](https://dafny.org/dafny/DafnyRef/DafnyRef#sec-lemmas),
  [Dafny reference](https://dafny.org/dafny/DafnyRef/DafnyRef)

For the local journal, datatype matching and `decreases |events|` supply the
mechanism for a terminating fold. `Fold` and `FoldFrom` carry no precondition;
`PrefixTotality` supplies an explicit every-sequence call site. P2 is the
authored inductive lemma `FoldFromAppend`, exposed as `Homomorphism`. P3 is the
authored `StepRegions` plus `RegionalFrom` induction. P4 follows from pure
`function`s and total arrow values with no external clock or entropy input;
the language does not prove that the selected inputs contain every fact the
domain should depend on.

## fast-check comparison

fast-check runs a property for a configured number of generated cases; it does
not turn a sampled property into a universal proof. Its runner records the seed
and shrink path, and supplying both replays the reduced failing case directly.
`numRuns` controls the successful-run budget (100 by default).
[fast-check `Parameters` API](https://fast-check.dev/docs/api/interfaces/Parameters/),
[official replay guide](https://fast-check.dev/docs/tutorials/quick-start/read-test-reports/#how-to-re-run)

That supports repeatable counterexamples and the local negative-control
workflow. It does not close the bake-off's coverage gap: a fixed seed and a
large run count reproduce and enlarge a sample, but do not prove that deep
protocol states were reached. The local witness counters are therefore evidence
about generation coverage, not optional diagnostics.

## Boundary of the evidence

Across all three provers, coverage and termination checks establish that an
accepted ordinary definition handles its typed inputs and finishes. Algebraic
datatypes can also make some malformed values unconstructable. None of those
checks invents P2 or P3, validates the event alphabet against production, or
shows that the modeled fold is the intended recovery policy. Those claims come
from authored definitions, theorem statements, induction/simulation lemmas,
and the review that connects them back to `JOURNAL-EVENTS.md`.

## Source and artifact gaps

- Lean's exact theorem signature is supported by the official repository at
  the bake-off's pinned `v4.32.2` tag. There is no separate first-party API
  page for `List.foldl_append`; community-rendered API pages were deliberately
  not used as evidence.
- The Agda manual documents equality and gives concrete recursive equality
  proofs, but it does not support the sweeping claim that every Agda proof is
  induction. This note makes only the narrower claim visible in the local
  proofs.
- The completed P3 names differ by language (`regional_contradiction`,
  `regional`, and `Regional`) but prove the same local/shared separation shape.
  Agda and Dafny deliberately specialize the task universe to two values;
  Lean's task identifiers are natural numbers.
