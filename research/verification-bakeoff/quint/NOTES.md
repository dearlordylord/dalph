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
