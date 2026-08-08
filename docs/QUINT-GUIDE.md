# Writing Quint models in Dalph

Read this before adding or changing a model under `specs/`. It covers the
conventions this repository relies on, the places Quint fails silently, and the
points where Dalph deliberately departs from the community knowledge base.

`docs/adr/0010-govern-subject-scoped-quint-models.md` governs which models exist
and what each owns. This guide covers how to write one.

## What runs a model

`pnpm check:quint` runs four things per model, and each must be satisfied
independently:

- `quint typecheck`
- `quint test` against the paired `*_test.qnt` file
- `quint run` sampling, with invariants and witnesses named explicitly
- `quint verify` exhaustively through Apalache

Invariant and witness names are listed by hand in `scripts/check-quint-models.mjs`,
in both the sampled and exhaustive blocks. A model may declare an invariant the
gate never checks, and nothing reports that. Adding an invariant means adding its
name in two places, and `research/verification-bakeoff/mutate-specs.mjs` in a
third.

Apalache supports sum types with record payloads, so an algebraic state encoding
costs nothing at the exhaustive step.

## Guards disable actions; they do not stutter

An action is a predicate over the current and next state. A guard that fails
means no transition exists, and `enabled(a)` is false. Write the guard as a
conjunct:

```quint
action reportSafelySuspended: bool = {
  nondet reported = REPORTED_CORRELATIONS.oneOf()
  all {
    awaitsSuspensionResult(state.status),
    isPlannedAttempt(reported),
    state' = { status: SafelySuspended(reported), positionHeld: false },
  }
}
```

A pure def returning `bool` is the ordinary way to express a guard over a sum
type. When the action needs the payload rather than only the tag, draw the value
with `nondet` and compare the whole variant, which binds it through the guard:

```quint
nondet claimed = REPORTED_CORRELATIONS.oneOf()
all {
  state.status == Running(claimed),
  state' = { status: SuspensionRequested(claimed), positionHeld: true },
}
```

`match` also works as an action, but every branch must update the same
variables, so an unreachable branch has to be written `all { false, state' =
state }` to satisfy the effect checker. That form costs one surviving mutant per
occurrence: flipping `false` to `true` turns the branch into a stutter step, and
no state invariant can detect a transition that changes nothing. Prefer the flat
guard.

## Invariants restate their requirement

An invariant must not call the same definition the action guards with. Sharing
one moves the guard and the requirement together under mutation, so weakening
the guard leaves the invariant satisfied — it verifies the model against itself.

Write the comparison out inside the invariant, even where that duplicates a
predicate the actions use. The duplication is the measurement.

For the same reason, a helper read only by an invariant belongs inside the
invariant. `mutate-specs.mjs` protects invariant and witness declarations from
mutation; a predicate outside one is mutated, and the resulting kill measures
nothing.

## Tests need the `Test` suffix

`quint test` collects `run` definitions whose **name** ends in `Test`. Nothing
else is collected, the file name does not matter, and a file of uncollected runs
exits zero with no output. A run with a false `.expect` that is never collected
looks exactly like a passing suite.

```quint
run runningThenTerminalTest = { ... }   // collected
run testRunningThenTerminal = { ... }   // silently ignored
```

Scenarios live in `specs/<name>_test.qnt` and import the model.

## Witnesses prove reachability

An invariant that holds over unreachable states is worthless, so every phase a
model can enter gets a witness — a `val` that is true only in that phase — passed
via `--witnesses`. The reported percentage is the share of sampled traces
reaching it. A witness at zero means the phase is dead and every invariant
covering it is vacuous.

## Quint fails silently

Several operations have undefined behaviour rather than an error, and the result
propagates into a green run:

- `map.get(key)` when the key is absent; pre-populate with `mapBy`
- `set.getOnlyElement()` when the size is not one; use `oneOf()` or `chooseSome()`
- `list.head()`, `list.tail()` on an empty list; `list.nth(i)` out of bounds
- `range(i, j)` and `i.to(j)` when `i > j`

Combined with uncollected tests and unreachable actions, the recurring failure
mode is a passing gate that measures nothing. Treat every green result as a claim
that needs a negative control.

## Syntax worth knowing

- Parameterless pure defs take no parentheses: `pure def name = ...`
- Map types use arrow syntax: `str -> int`
- A variant constructor takes exactly one argument; use a record or tuple for
  several. Records are preferred, since a match arm cannot destructure a tuple —
  it binds the tuple and reaches fields through `._1` and `._2`
- `collection.oneOf()`, not `oneOf(collection)`
- Both `{...state, field: value}` and `state.with("field", value)` are valid.
  `.with` takes the field name as a quoted string; unquoted is a name lookup
  and fails with `QNT404`

## The community knowledge base

`https://github.com/quint-co/quint-llm-kit` packages the language reference,
builtin index, an examples corpus, and twelve patterns. It is available in agent
sessions as the `quint-kb` MCP server. Its undefined-behaviour list, syntax
rules, and witness concept apply here directly.

Its core architecture — `state-type-pattern`, `pure-functions`, `thin-actions` —
teaches that business logic belongs in pure functions returning
`{success: bool, newState: State}`, with the action stuttering via
`unchanged_all` when `success` is false.

**Dalph does not follow that shape.** A failed precondition here means the
transition does not exist, not that it occurs and changes nothing. The knowledge
base's shape suits contract calls, where a rejected `transfer` genuinely is a
step that happened and failed. It does not suit a protocol boundary, where
requesting suspension of an executor that is not running is not an event at all.

The consequence is measurable rather than stylistic. Every stuttering branch is a
transition that changes no state, which no state invariant can rule out, so each
one is a mutant that survives by construction. Adopting the pattern uniformly
adds one such survivor per action.

Two further corrections to that source: its `separate-test-files` example names a
run `testScenario`, which `quint test` does not collect, and its syntax rules
tell you to replace `.with` by spread, where the actual constraint is that the
field name must be quoted.

## Mutation analysis

`research/verification-bakeoff/mutate-specs.mjs` perturbs a model one token at a
time and reports which gated invariant kills each mutant, per invariant rather
than in aggregate. An invariant killing nothing is contributing nothing to the
gate, which is worth knowing even when the invariant is correct.

Run it after changing a model. A per-invariant count that drops is a weakened
model, whether or not the gate still passes.
