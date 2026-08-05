# Quint + Apalache

## Friction met while encoding

`x' = a and b` parses as `(x' = a) and b`. Assigning a conjunction needs
explicit parentheses, and the error surfaces as an effect-unification failure
naming `Read` and `Update` entities rather than as a parse problem.

`mapBy` builds a map from a **set**, not from another map. Rebuilding a map
means `TASKS.mapBy(id => ...)`, not `tickets.mapBy(...)`.

`next` is a built-in name and cannot be a parameter.

Every action must assign every variable. There is no `UNCHANGED` shorthand, so
a sixteen-action model repeats nine assignments per action. This is the single
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
