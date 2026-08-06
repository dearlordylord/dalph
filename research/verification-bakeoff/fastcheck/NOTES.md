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
*one* fairness-satisfying strategy, where `SF_vars` quantifies over all of them
— which means this file structurally cannot find the
`Executing → SuspensionRequested → Suspended` cycle that broke the first TLA+
fairness attempt, because the scheduler never picks `requestSuspension`.

All three properties pass in **0.9 seconds**, against 28s for one TLC property
and 94s for the whole Alloy file.

### And they pass vacuously

```
| Witness at end of prefix | share of runs |
| Executing                | 0.58% |
| Integrating              | 0.02% |
| staleIntegrating         | 0.00% |
| Settled                  | 0.00% |
```

Zero. Over 40 000 prefixes the model reached `Integrating` once and a *stale*
`Integrating` never — so I18 and I19 pass without once visiting the state they
exist to constrain. `--no-abandon` removes the escape hatch that stale state
needs, and the properties still pass: **a negative control that does not fire.**

Raising the prefix to 150 steps moves `Integrating` to 2.23% and
`staleIntegrating` to 0.00% still. Choosing among *enabled* actions rather than
discarding disabled ones — fast-check's own `fc.commands` idiom, and a real
improvement over the encoding in `run.mjs` — helps the shallow phases and does
not help this one.

This is the same lesson as M6 (caught 4 times in 10 at 50 000 samples), stated
more starkly: the deep states of a protocol are not reachable by random walk,
and a passing property-based test carries no information about them. The
witness table is not decoration here. It is the only thing that distinguishes
this result from a real one.

The honest verdict: property testing is the cheapest way to check drain
behaviour on shallow states and gives **no** liveness coverage on deep ones.
