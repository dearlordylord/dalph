# Learning the journal fold through four proof styles

This completes the I15 journal-fold comparison promised by issue #196. It is
research and tooling only: no Dalph command, workflow decision, boundary call,
journal record, retry, cleanup action, or runtime-visible result changes.

Start with the concrete event chronology in `JOURNAL-EVENTS.md`, then keep
these files side by side:

- `fastcheck/journal.mjs` and `fastcheck/journal-run.mjs` — the executable
  23-event reference model, generated properties, directed witnesses, and
  four existing JavaScript mutants;
- `lean/Journal.lean` — the concrete fold and proof for arbitrary finite lists
  of natural task identifiers;
- `agda/Journal.agda` — the concrete two-task semantics factored through a
  generic local/shared kernel, proved without a standard library;
- `dafny/Journal.dfy` — the same concrete two-task factorization as verified
  pure functions and inductive lemmas;
- `prover-mutants.mjs` — nine fail-closed negative controls, one P1/P2/P3
  defect per prover;
- `PROVER-SOURCES.md` — official sources for what each checker supplies.

## The result in one table

| Claim | fast-check | Lean 4 | Agda | Dafny |
|---|---|---|---|---|
| P1: every retained prefix folds | sampled arbitrary sequences; M1 throws | ordinary total definitions, exhaustive classifiers | coverage + termination under `--safe` | no-precondition functions, exhaustive matches, explicit `decreases` |
| P2: prefix then suffix equals whole fold | generated equality + directed crash split; M2 breaks resume | `fold_homomorphism`, delegated to `List.foldl_append` | `homomorphism`, a hand-written fold-left induction | `FoldFromAppend`, an explicit recursive lemma and slice identities |
| P3: local contradiction stays local; shared contradiction closes the Run | concrete local/shared guards, failure attribution, witnesses; M3 checks containment | concrete `regional_contradiction`, derived from `step_region_of_live` for arbitrary task ids | `concrete-regional`, proving both named task regions at once | `ConcreteRegional`, proving both named task regions at once |
| P4: replay is deterministic | repeated folds plus a ban on clock/entropy reads | pure definitions expose no such inputs | pure definitions expose no such inputs | pure total arrow values expose no such inputs |
| Negative controls | four existing model mutants | P1/P2/P3 rejected | P1/P2/P3 rejected | P1/P2/P3 rejected |

The first important conclusion is that “proved” needs an object. Lean ports the
concrete transition directly. Agda and Dafny define the same concrete guards
and effects as an instance of a typed theorem kernel. fast-check executes the
JavaScript reference. These are still separately authored artifacts, so source
parity and theorem checking are complementary evidence rather than a formal
cross-language refinement theorem.

## The proof seam that made P3 tractable

The first drafts put every guard, state update, and proof case into one large
definition. Agda accumulated unsolved constraints, and Dafny's monolithic
regional step lemma still had no verdict after 220 seconds. Lean could finish
that direct proof after the state-update lemmas were factored. Agda and Dafny
needed the concrete event meaning split behind two total functions:

```text
local step  : Region × Event → LocalOutcome
shared step : Regions × Shared × Event → SharedOutcome
```

Only the full fold combines those outcomes. A local function cannot inspect
capacity, pause, positions, the target head, or target ownership. A shared
function may inspect regions for captured-head checks, exactly as
`journal.mjs` does, but its result type cannot rewrite them. That type boundary
is the premise P3 actually needs.

The proof then has two parts:

1. If one full step leaves the Run live, its task-region projection equals one
   local-only step.
2. Induction over the event list lifts that equality to the whole fold.

The generic theorem establishes P3 for every total semantics with that
separation; `concrete`/`Concrete()` then instantiate it with all 23 guards and
effects. Ticket #200 closes the earlier syntactic correspondence seam:
`journal-events.json` generates the executable JavaScript constructors, the
cross-language mapping table, and compiling 23-constructor witnesses for Lean,
Agda, and Dafny. The prover guards/effects remain authored proof code—the
generator does not pretend their semantics are definitionally equal. Lean adds
state-parameterized event batches to every constructor of the pre-existing L2
relation, proves the extension conservative in both directions, and proves the accepted
claim-prefix and failure-attribution projections through the concrete L1 fold.

## What each checker gives away

### Lean

P1 costs definitions, not a theorem. A missing event-classification case is a
compile error, and ordinary recursion must terminate. P2 is one library theorem
because both sides are literally the same `List.foldl`; the induction still
exists, but Lean's core library already proved it. P3 is the authored work:
case analysis for one live step, followed by induction over `SharedValid`.

Lean's journal theorem quantifies over `List Nat` task universes and arbitrary
task identifiers. Of the three prover arms it gives the broadest task-domain
statement at the lowest proof cost here.

### Agda

Agda makes P1 structural under `--safe`, as Lean does. P2 is not a lookup: the
two clauses of `foldl-append` expose the induction. P3 proves equality of the
entire two-region value, so both tasks are covered simultaneously.

The price is visible. Factoring `step-active`, `step-task`, and
`local-only-task` was necessary because nested `with` abstractions hid
definitionally equal branches from later clauses. That is not merely syntax:
it pushed the code toward the same compositional seams the proof needed.

The task type is deliberately `a | b`. Journal length and numeric payloads are
unbounded, but n > 2 is not proved. The file says so at its top and the P1
mutant ensures adding an event still breaks exhaustive classification.

### Dafny

Dafny permits function preconditions, so “total” must be scoped. `Fold` and
`FoldFrom` have no `requires`; `PrefixTotality` supplies a call over every
sequence, and recursive folds carry explicit `decreases |events|`.

P2 costs an inductive lemma plus facts about sequence heads and slices. A
direct, monolithic concrete P3 lemma did not return a result after 220 seconds;
factoring the same guards and effects through `Semantics` makes the regional
proof compositional and the full file verifies 24 obligations in about eight
seconds. That contrast is the Dafny result, not merely a code-cleanup story.

The runner uncovered an environment lesson unrelated to logic but essential
to verdict integrity. On Linux arm64, an executable macOS Dafny binary may
occupy the default cache path. Checking only `-x` selected it and every parser
reported an empty verdict. `dafny/run.sh` now prefers the known arm64 wrapper
on that host and treats absent verifier counts as failure.

### fast-check

The JavaScript arm is the executable reference for the concrete guards from
the design decisions in `fastcheck/NOTES.md`. It remains the right oracle for
generated cases such as a failed promotion compare-and-set retaining the
target resource; the prover ports establish universal properties of their
separately authored copies.

It is also the only arm that samples. Seeds and replay paths make a found
counterexample reproducible; `numRuns` does not turn the sample into a proof.
Witness counts and negative controls remain mandatory because a generated
property can pass without reaching its premise.

## Negative controls

Run `node prover-mutants.mjs`. Each mutation is applied to an isolated
temporary copy, the exact text site must occur once, and the real checker must
exit nonzero:

| Mutation | Why the faithful checker must reject it |
|---|---|
| P1 removes `DirectionApplied` classification | the event consumer is no longer exhaustive |
| P2 swaps or duplicates prefix/suffix inputs | the authored homomorphism proof no longer has the stated type |
| P3 resets/fails regions on unrelated or shared events | the single-step projection and regional induction no longer close |

The script fails if a mutation site drifts, a checker cannot start, a checker
times out, or a mutant unexpectedly verifies. Rejection is evidence that the
theorem/harness is sensitive to the intended defect; it is not evidence that
the theorem statement is the right domain statement.

## Reproduce and learn by breaking it

From `research/verification-bakeoff/`:

```sh
node fastcheck/journal-run.mjs
lean/run.sh
agda/run.sh
dafny/run.sh
node prover-mutants.mjs
```

Then try one change at a time:

1. Add a 24th event constructor without classifying it. Lean, Agda, and Dafny
   should refuse the faithful source before any theorem runs.
2. Change Lean's `foldFrom` to reset its input state. P2 should stop proving;
   the directed intent/outcome witness explains the recovery consequence.
3. Let Agda's `local-only-step` reset both task regions for a shared event. P3
   should stop typechecking.
4. Give Dafny's `FoldFrom` a `requires |events| > 0`. Calls over the empty
   crash prefix should become proof obligations, making P1's cost concrete.
5. Reduce fast-check runs to zero. `journal-run.mjs` should reject the vacuous
   configuration rather than report a green suite.

## Follow-up ownership

Issue #196 can now close without hiding unfinished modeling work:

- [#88](https://github.com/dearlordylord/dalph/issues/88) and
  [#142](https://github.com/dearlordylord/dalph/issues/142) already own the
  crash/recovery and complete recovery-matrix work;
- [#197](https://github.com/dearlordylord/dalph/issues/197) owns blockers and
  bounded task arrival;
- [#198](https://github.com/dearlordylord/dalph/issues/198) owns the preserved
  finite-work counter;
- [#199](https://github.com/dearlordylord/dalph/issues/199) owns the n=3
  experiment;
- [#200](https://github.com/dearlordylord/dalph/issues/200) owns L1↔L2 and
  JavaScript-to-prover correspondence;
- [#201](https://github.com/dearlordylord/dalph/issues/201) owns adding one
  fail-closed temporal property to the default gate. The decision changed from
  “rule out on cost” to “proceed in a dedicated ticket” after the current gate
  measured 72.01 seconds against its now-150-second budget.

## Claim-to-check mapping

This is the scenario-to-test mapping for the research-only change:

| Concrete proof observation | Passing evidence |
|---|---|
| A crash leaves the journal after an intent; replaying the later outcome reaches the same state as one uninterrupted fold | directed intent-prefix witness in all three prover files; P2 theorem; `journal-run.mjs` homomorphism property |
| Task A records a locally impossible admission; Task B continues to a progressed phase and the Run stays live | local-contradiction witnesses in all three prover files; P3 theorem; concrete fast-check regional property |
| A shared-history contradiction is not silently attributed to one task | typed shared outcome in each theorem kernel; concrete failure-attribution checks in `journal-run.mjs`; P3 mutants rejected |
| Adding an event without teaching every consumer cannot silently pass | P1 mutants rejected by Lean, Agda, and Dafny |
| A passing property did not result from zero generated witnesses | existing fast-check zero-witness rejection and directed prover witnesses |

No competing Dalph runtime outcome is decided here. Ticket #200 generated the
event-alphabet correspondence and proved conservative L2 emission plus the
accepted replay projections in Lean; the
deliberate remaining boundary is separately authored guard/effect code in each
proof language, checked by the existing concrete witnesses and mutants.
