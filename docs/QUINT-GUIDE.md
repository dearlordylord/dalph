# Writing Quint models in Dalph

Read this before adding or changing a model under `specs/`. It covers the
conventions this repository relies on, the places Quint fails silently, and the
points where Dalph deliberately departs from the community knowledge base.

`docs/adr/0010-govern-subject-scoped-quint-models.md` governs which models exist
and what each owns. This guide covers how to write one.

## What runs a model

`pnpm check:quint` supplies four independent kinds of evidence for every
governed subject:

- `quint typecheck`
- `quint test` against the paired `*_test.qnt` file
- `quint run` sampling, with invariants and witnesses named explicitly
- `quint verify` exhaustively through Apalache or TLC

Usually all four commands run against the canonical model. ADR 0010 permits a
smaller proof projection to own the exhaustive leg when the canonical subject
state cannot finish inside the gate. The canonical model still owns its
deterministic tests, sampled invariants and witnesses, production-backed MBT,
and behavior vocabulary. The paired projection must run its own typecheck,
collected deterministic and negative tests, sampled invariant/witness check,
and complete finite-state verification with no arbitrary depth token.

The current proof projections are `taskFactReconciliation_proof.qnt`,
`plannedAttemptExecutor_proof.qnt`, `applicationExit_proof.qnt`, and
`acceptedResultIntegration_proof.qnt`. `freshTaskAdmission_proof.qnt` contains two
more projections for one canonical subject. The capacity/order projection
retains all five ordered task identities A through E; reducing it to counters
would erase the D-before-E and task-local rejection properties it exists to
prove. The continuity projection retains one exact selected task and one
outside-task sentinel, but preserves the selected task's intent, provider-call,
reconciliation, immutable-lineage, responsibility-handoff, crash, and release
states. The sentinel detects an outside authorization while that exact task
still occupies the position. Neither projection is a second behavior source.
The canonical `freshTaskAdmission.qnt` model remains the vocabulary and MBT
source, and every canonical action has an explicit projection action or stutter
mapping in the accepted #315 scenario.

The fresh-admission projections deliberately divide the state product rather
than weaken either property family:

- the capacity/order projection owns bounded entry, stable A-E rank, ready
  existing-responsibility priority, task-local foreign rejection, contraction
  without eviction, and expansion;
- the continuity projection owns one closed occupancy path from process-local
  entry through exact held attempt, including accepted-but-unobserved Journal
  appends, lost provider responses, reread-before-retry, repeated crash and
  recovery, post-ownership fail-closed retention, and atomic responsibility
  handoff.

Their collected positive tests establish the named scenario paths, and their
negative tests deliberately perform outside-bound admission, rank inversion,
fresh-over-ready admission, contraction eviction, blind retry, ambiguity
release, lineage replacement, and gap handoff. Exhaustive checking must finish
each complete finite graph without a depth token. The canonical model, not the
projections, remains in mutation analysis because only it owns the runtime
vocabulary and future conformance adapter.

The task-fact projection includes the
accepted #218/#281 active-work slice: it separately proves `Running`
establishment, tracker/timer source provenance, and healthy/unreadable
observation behavior. Their negative test modules are the mutation
controls for the collapsed proof state: each performs a forbidden transition
and proves that the corresponding projected invariant turns red. The canonical
models remain in the token-mutation census because they own runtime vocabulary
and production-backed MBT.

The active-work proof names source provenance because a tracker notification or
timer is only an offer to reread current authority. A successful Git read keeps
that source process-local; a typed Git read failure is the durable non-action
outcome. The proof projection therefore checks the source-sensitive transition
and its ordinary-unreadable negative control, while the runtime journal tests
the exact read identity and ordinal chronology.

Invariant and witness names are explicit gate inputs. The canonical
`plannedAttemptExecutor` and `taskFactReconciliation` lists live in
`scripts/quint-model-obligations.mjs`, which both
`scripts/check-quint-models.mjs` and
`research/verification-bakeoff/mutate-specs.mjs` import. Other models list the
same names in both scripts. A model may declare an invariant the gate never
checks, and nothing reports that, so adding or renaming an observation means
updating its shared manifest or every explicit checking profile.

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

The mutation census is intentionally expensive. For every compiled mutant it
runs the whole invariant set, then reruns each invariant separately to
attribute a kill; a full model can therefore require roughly one plus the
invariant count simulations per mutant and prints no progress before its final
report. Use `--max-mutants`, smaller `--samples`, and a fixed seed only for a
clearly labelled diagnostic sample. Do not report that sample as the full
census. A full census must be scheduled and monitored as long-running research;
it is not a substitute for the collected negative controls or the ordinary
implementation handoff gate.

Before any Quint result, run `pnpm exec quint --version` and compare it with the
version pinned in `package.json`. A Git worktree without its own installed
`node_modules` can make `pnpm exec quint` fall through to a globally installed
binary; in that state even `pnpm exec node mutate-specs.mjs` reports
`npm_execpath` as unset and the mutation script also falls back to `PATH`.
Install the worktree dependencies or invoke the repository's exact installed
binary. Never describe a run as pinned based on the `pnpm exec` spelling alone.
