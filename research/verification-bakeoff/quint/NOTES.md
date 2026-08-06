# Quint + Apalache

## Friction met while encoding

`x' = a and b` parses as `(x' = a) and b`. Assigning a conjunction needs
explicit parentheses, and the error surfaces as an effect-unification failure
naming `Read` and `Update` entities rather than as a parse problem.

`mapBy` builds a map from a **set**, not from another map. Rebuilding a map
means `TASKS.mapBy(id => ...)`, not `tickets.mapBy(...)`.

`next` is a built-in name and cannot be a parameter.

Every action must assign every variable. There is no `UNCHANGED` shorthand, so
an eighteen-action model repeats nine assignments per action. This is the single
largest source of bulk in the encoding and the easiest place to introduce a
silent bug — an omitted assignment is a type error, but a wrong one is not.

## Character

`quint run` is a random simulator and `quint verify` hands the same spec to
Apalache for bounded symbolic checking. Both read the same file, which is the
main practical draw: the cheap engine and the thorough one never diverge.

Witness counts are the part worth using and the part most often skipped. A run
that reports `[ok]` while `settledReached` fired in 0.02% of traces has not
checked the invariant anywhere interesting. Witnesses turn "passed" into a
number you can argue with.

Parameterized modules (`const MUTANT` plus `import deliveryCore(MUTANT = 1).*`)
make the mutant harness free — one file, six instantiations, no preprocessor.

## Performance

Simulation clears the faithful model in about 3 seconds and catches four of
five mutants in about 1 second each. The fifth, M6, it catches **4 times in
10** at 50 000 samples — flaky rather than absent, which is the worse of the
two failure modes: a green run proves nothing and a red run looks retryable.

Apalache found M6 reliably in 38 seconds. On the faithful model it reached step
12 and was terminated at 45 minutes without a verdict. Refutation is cheap for
it, a clean bill of health is not.

On a model this small, TLC's explicit enumeration beats both: 10/10 on M6 in
under a second, and the whole faithful state space in 3.

## Induction

`quint verify --inductive-invariant I` asks a different question from everything
else in this directory. No state space, no step bound: three obligations,
`init => I`, `I and step => I'`, and `I => Inv`. `./run.sh --inductive` runs it.

| Invariant | Model | Result | s |
|---|---|---|---|
| `inductiveCandidate` | M0 | CTI found | 15 |
| `inductiveWithoutHeadBound` | M0 | CTI found | 21 |
| `inductiveInvariant` | M0 | **inductive** | 27 |
| `inductiveInvariant` | M1 | CTI found | 13 |
| `inductiveInvariant` | M2 | CTI found | 13 |
| `inductiveInvariant` | M4 | CTI found | 16 |
| `inductiveInvariant` | M5 | CTI found | 25 |
| `inductiveInvariant` | M6 | CTI found | 21 |

Row 1 is the result. `allInvariants` — the conjunction Apalache and TLC both
discharge without comment — is **not inductive**, and the counterexample is the
one `../alloy/DeliveryL2.als` returns:

```
[State 0]  tickets[0] = { phase: Claimed, attempts: 1, ... }
[State 1]  tickets[0] = { phase: Planned, attempts: 2, ... }
```

`oneAttemptPerTask` holds in state 0 and `planAttempt` breaks it. The state is
unreachable from `init`, which is precisely why the strengthening
`phaseBoundsAttempts` is needed — and it is the same clause `../lean/L2.lean`
and `../agda/L2.agda` carry, arrived at by a third route.

### The obligation Alloy does not make you discharge

Apalache starts the induction check *from the invariant*, so the invariant has
to assign every variable a domain. Without `stateBounds` the run dies at

```
error: tickets is used before it is assigned.
```

That is not a formality. The finite domains become conjuncts, so `step` has to
be proved to respect them, and row 2 is what that costs: drop
`headAdvancesWithPromotions` and the counterexample is `targetHead = 4`
followed by a `promote` — a fact about the declared range of `HEADS`, not about
the protocol. Closing it needs a real argument (the head advances at most twice
externally plus once per task, and promotions are exhaustible).

Alloy declares the same bound as `for 2 Task, 5 Int` and never asks. The
scope sits outside the formula, so an instance that would leave it is simply not
searched. Apalache's version is the more honest of the two and the more work.

### Where it sits between the tools

Same three-way split as `../alloy/NOTES.md` describes, with Quint now on both
sides of it: `quint verify` (bounded, reachable, no induction) and `quint verify
--inductive-invariant` (unbounded in time, no reachability) are the same file
and the same invariant, one flag apart. That is the cheapest demonstration in
the bake-off that the two questions are different — and Quint is the only tool
here that answers both from one source.

Cost: 27 seconds against Alloy's 49 milliseconds for the same CTI. Alloy is
answering over 2 tasks and 5-bit integers; Apalache is answering for every state
in `stateBounds`, which is why it needs the bound argument Alloy skips.

The mutant rows are a bonus rather than the point. All five are caught, and M6
— the one random simulation finds only 4 times in 10 — is caught in 21 seconds
with no sampling involved.

## Liveness

Quint states I17–I19 more directly than any other tool here. `always`,
`eventually`, `weakFair` and `strongFair` are builtins, and `strongFair(A, v)`
is defined to be exactly `SF_v(A)`:

```quint
temporal fairness = and {
  TASKS.forall(id => and {
    promote(id).strongFair(vars),
    abandonIntegration(id).strongFair(vars),
    ...
  }),
  recover.strongFair(vars),
}
```

`enabled` is a builtin too, so `reachesQuiescence` is one line. It is not
`eventually(always(not(step.enabled())))` though, and the reason is worth
knowing: `observeGraph` has no guard, so `step.enabled()` is true in every
state and that form is unsatisfiable rather than merely weak. The test has to
be over the lifecycle actions only, which means a hand-written `anyProgress`
disjunction — the same list Alloy spells out, minus Alloy's separate `en*`
duplicates of every guard.

Then nothing in the default toolchain can check any of it.

`quint run` cannot evaluate temporal operators at all, so the cheap simulator
is out. `quint verify` prompts before it will even try:

```
WARNING: Apalache has experimental support for temporal properties and might
give incorrect results. Consider using --backend tlc, which fully supports
temporal properties.

Do you want to proceed with Apalache anyway? (y/N)
```

Answering yes gets as far as the rewriting pass and stops:

```
PASS #5: TemporalPass
  > Rewriting temporal operators...
  > Found 1 temporal properties
  > Adding logic for loop finding
error: Handling fairness is not supported yet!
```

So the fairness vocabulary type-checks, reads well, and has no symbolic
back end. Every liveness property in this benchmark needs fairness, so the
answer for Apalache is not "slow" — it is "cannot".

`--backend tlc` does work, and confirms the model:

```
quint verify deliveryCore.qnt --temporal pauseDrainsPositions --backend tlc
  96,000 distinct states found
  [ok] No violation found (35756ms).
```

96 000 states is exactly what the hand-written `../tlaplus/Delivery.tla`
reports, which is the useful cross-check: two independently written models of
the same protocol agree on the size of the reachable set.

The 35s against TLC's own 28s is the transpilation overhead, and the same cost
profile applies — `everyBegunSettles` through this backend is TLC's problem,
not Quint's.

The honest summary: for liveness Quint is a **front end for TLC**. That is not
nothing, since one file still feeds simulation, Apalache safety checking and
TLC. But the tool's own advice is to leave its default engine.
