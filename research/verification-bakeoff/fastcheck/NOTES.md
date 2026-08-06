# fast-check

## Setup

None. It is already a dependency, and `run.mjs` imports it from the workspace.
Of every tool here this is the only one with zero marginal setup, which is most
of its real-world advantage.

## Friction met while encoding

The default size bias is the trap. `fc.array(stepArb, { minLength: 1,
maxLength: 40 })` spends nearly the whole budget on short sequences, so no L2
mutant is caught at all — 50 000 runs, 40 allowed steps, everything reported
clean. Adding `size: "max"` catches M4 and M5 in under a second.

Nothing in the output distinguishes "checked and clean" from "never generated
an input long enough to reach the code". A green run at the wrong size setting
looks exactly like a green run at the right one.

`fc.commands` is the intended API for stateful models and would make guard
handling explicit rather than the `if (attempted === null) continue` used here.
The hand-rolled loop was kept so the search matches Quint's simulator step for
step and the comparison stays about the engine.

## Character

Falsification, not proof, and it is very good at falsification of shallow
defects: M1 and M2 die in milliseconds, with a shrunk counterexample naming the
invariant and the action.

The failure mode is depth. M6 needs eight ordered actions and was caught in
0 of 10 repetitions at 50 000 runs. Quint's simulator managed 4 of 10 on the
same model, because it chooses among *enabled* actions each step while this
harness generates a blind action list up front and burns most steps on failed
guards. `fc.commands` would close most of that gap.

The shared lesson survives the difference: **the property-based test and the
model checker's random mode have the same blind spot**, and reaching for a model
checker buys nothing unless you use its exhaustive or symbolic engine.

Where it stays the right tool: L1. The projection is a total function, the
properties are one line each, and the existing
`ticket-delivery-projection.property.test.ts` already covers I1, I2, and I4
against the real implementation rather than against a model. No tool here
replaces that — the others check a model, this one checks the code.

## Liveness: the sharpest limit in the bake-off

`liveness.mjs` is a **bounded surrogate**, not a liveness check. Liveness
quantifies over infinite behaviours and a test runs finitely, so `eventually P`
is not a testable proposition. What is testable:

```
random prefix -> stop the environment -> run a fair scheduler
              -> assert the system drains within `drain` steps
```

Three separate weakenings, each worth naming. `<>[]~crashed` becomes a hard
cutoff. "Eventually" becomes "within 40 steps". And the round-robin scheduler is
*one* fairness-satisfying strategy, where `SF_vars` quantifies over all of them.

The third has an interesting consequence. The scheduler never picks
`requestSuspension`, so this file structurally cannot exhibit the
`Executing → SuspensionRequested → Suspended` cycle at all. It happens not to
matter — that cycle is a modelling artifact rather than a real behaviour — but
the harness could not have told you either way. Baking a scheduling assumption
into a test is exactly how it stops being visible.

All three properties pass in about **3 seconds each**, against 28s for one TLC
property and ~131s for the whole Alloy file.

### And they pass vacuously

At the default budget — 20 000 runs, 25-step prefix, so 40 000 task slots:

| Witness at end of prefix | count | share |
|---|---|---|
| Executing | 88 | 0.22% |
| Integrating | 4 | 0.01% |
| staleIntegrating | **0** | 0.00% |
| Settled | 1 | 0.00% |

A *stale* `Integrating` is never reached, so I18 and I19 pass without once
visiting the state they exist to constrain. `--no-abandon` removes the escape
hatch that stale state needs, and the properties still pass: **a negative
control that does not fire.**

Raising the prefix to 150 steps fixes the shallow phases and not this one —
`Integrating` 357, `Settled` 1 243, `staleIntegrating` still 0. Choosing among
*enabled* actions rather than discarding disabled ones (fast-check's own
`fc.commands` idiom, and a real improvement over `run.mjs`) has the same shape
of effect.

The exact counts move with the seed; the zero does not.

This is the same lesson as M6 (caught 4 times in 10 at 50 000 samples), stated
more starkly: the deep states of a protocol are not reachable by random walk,
and a passing property-based test carries no information about them. The
witness table is not decoration here. It is the only thing that distinguishes
this result from a real one.

The honest verdict: property testing is the cheapest way to check drain
behaviour on shallow states and gives **no** liveness coverage on deep ones.

## The journal fold (I15) — `journal.mjs` + `journal-run.mjs`

The L1 journal work of `../JOURNAL-EVENTS.md`, built: the 23-event alphabet
as tagged plain values with the action/occurrence split explicit, a pure
`fold(events)` from the origin, `foldFrom(state, events)` for the
resume-from-prefix shape, and `foldRegion(task, events)` for Proposition 3.
Run with `node journal-run.mjs [--runs 2000] [--steps 50]`.

### Design decisions the design text did not pin down

- **Invalid means fail closed, not throw.** Proposition 3's "fails the Run
  closed" plus I15's "total over contradictory histories" read as: a
  contradiction is a sticky value in the state, freezing what it owns. A
  task-local contradiction fails that task's region; a shared-history
  contradiction fails the whole Run. Throwing would make prefix-totality a
  property of the harness rather than of the fold. This is the reading
  implemented; the design does not say "marker" explicitly.
- **Intents apply optimistically, outcomes reconcile.** A claim intent moves
  the ticket to `Claimed` — a crash between intent and outcome must not lose
  the obligation, which is what the intent is journaled for. A
  `ClaimRecordRead` carrying the intent's exact token confirms; any other
  token refutes while still `Claimed` and the region reverts to
  `NoObligation`; a refutation after downstream progress is itself a
  contradiction and fails the region. A `PromotionOutcomeObserved` at a
  non-captured head is a failed compare-and-set (task stays `Integrating`,
  keeps the resource); one at the captured head while the target has moved
  is structurally invalid shared history and fails the Run.
- **Proposition 3 is an interpretation, and the design leaves it open.**
  "Region A" and "structurally invalid shared history" are not defined in
  `JOURNAL-EVENTS.md`. The encoding splits every event guard into a
  task-local part (reads only the ticket's own phase/attempt/pending fields)
  and a shared part (reads capacity, positions, pause, target head, target
  resource, run lifecycle). `foldRegion` replays a task's subsequence with
  only the local guards — that is "xs restricted to region A is consistent"
  made operational. The checked property is then stronger than the prose:
  while the Run is live, each region's failure status AND content equal the
  fold of its own subsequence, whatever the other regions contain; plus
  failure attribution (the Run fails only on shared guards, with an `origin`
  tag), and closed-stays-closed stickiness for both Run and regions. Making
  the promotion phase transition region-local (success decided by
  `head = expectedHead`, with target-head agreement as a shared guard) is
  what makes region content independent of interleaved shared events;
  without that split the equivalence has counterexamples.
- **Pending-intent flags are fold-internal.** `claimPending`,
  `worktreePending`, `promotionPending` are not in `MODEL.md`'s state
  alphabet; without them an outcome without a preceding intent is not
  recognisable as a contradiction.
- **Wider-than-the-model events are guarded but state-neutral.** The
  worktree pair, eligibility pair, and claim release have no `MODEL.md`
  field to update; they participate in structural consistency only.
  `DirectionApplied` carries a subject but pause is run-level in `MODEL.md`.
  Events after `WorkflowRunTerminated` fail the Run ("final fact").
- **The two history flags are definitional here.** Over-ceiling admission
  and non-current-head promotion both fail the Run, so
  `admissionRespectedCeiling` and `promotedFromExactHead` can only read
  true. Recorded as definitional, not as results.
- **`Reason` is nonempty by construction**: `CandidateConstructionNonConvergent`
  with a reason outside the three-value type fails the region.

### Results (default budget: 2000 runs, 50 events, `size: "max"`)

P1 prefix-totality over 8000 fully arbitrary sequences, P2 homomorphism over
2000 plausible ones plus three directed sequences (a full lifecycle, a crash
between claim intent and outcome, a regional contradiction, a sequence
ending with a held position), P3 regional equivalence/attribution/stickiness,
P4 determinism dynamically and as a static grep of `journal.mjs` for
wall-clock/entropy reads. All hold, ~32s per plausible property, ~2 minutes
for the file.

Witnesses at that budget (counts move with the seed; one measured run):
splits landing between an intent and its outcome 658/2000; P3 runs ending
Run-failed 914/2000, with a failed region 1226/2000, live-Run region
comparisons 1086/2000; runs ending Settled 36, Promoted 10,
Abandoned(StaleTargetHead) 3, Abandoned(limit reasons) 1 — the last only via
injected arbitrary events, the plausible environment never records the two
limit reasons, exactly as `../JOURNAL-EVENTS.md` states. The runner exits
non-zero if any required witness is zero.

Negative controls, all caught: M1 a fold that throws on an invalid event
(P1, caught instantly); M2 a `foldFrom` that drops held positions on entry
(P2, caught by the directed split after `WorkAdmitted` — note the random
property alone would miss it whenever the position is released before the
sequence ends, because only the final states are compared); M3 a fold that
poisons the whole Run from a regional contradiction (P3's origin-attribution
check); M4 a fold that stamps reconstructions with the wall clock (P4
dynamic and static, the latter by keeping the defect in
`journal-mutants.mjs` so `journal.mjs` itself stays grep-clean).

### What feeding this back into the design should note

Proposition 3 needs its terms defined: what a region is, whether a task
event whose *shared* precondition fails (admission over capacity, work under
a pause) fails the region or the Run, and what "consistent" means for a
restriction that omits the shared events a guard reads. Each is defensible
more than one way, and the choice changes what the proposition claims.
`JOURNAL-EVENTS.md` also does not say whether a journal may continue after
`WorkflowRunTerminated`, or whether a failed compare-and-set retains the
integration-target resource; both are decided above.
