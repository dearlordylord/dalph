# The journal event alphabet

The alphabet I15 folds over, at the abstraction of `MODEL.md`. Nothing here is
built yet; this is the design the L1 journal work starts from.

## Three constraints from the domain

**Actions name an actor; non-action occurrences do not.** `ARCHITECTURE.md`:
"An initiated action names its actor. A non-action occurrence, such as receiving
tracker facts or an executor report, does not copy the actor from an earlier
action." The split is structural, not cosmetic — every event exposed to a
generic consumer has exactly one action/non-action classification, and adding a
variant must break exhaustive consumers.

**Intent precedes an ambiguous effect.** "Intent is recorded before an effect
whose outcome could become ambiguous. After a lost response or crash, the
ordinary protocol reconciles the recorded intent with the system that owns the
result." Two effects here qualify: the tracker claim write and the promotion ref
mutation. Each becomes an intent action plus an outcome occurrence.

**There is no crash event.** "A dying coordinator cannot record its own death;
recovery accepts every retained journal prefix without a fabricated crash
event." Crash is *absence*: the list is truncated at an arbitrary point.

That third constraint is the load-bearing one. It makes prefix-totality the
recovery theorem rather than a separate obligation, and it means the canonical
hard case is a journal that ends between an intent and its outcome.

## Actions

| Event | Note |
|---|---|
| `ClaimIntentRecorded(task, token)` | before the ambiguous tracker write |
| `ClaimReleaseIntentRecorded(task, token)` | names the exact current owner |
| `AttemptPlanned(task, runId, attemptId)` | the durable one-attempt fact |
| `WorkAdmitted(task, attemptId)` | position allocated |
| `SuspensionRequested(task, attemptId)` | |
| `ResumeRequested(task, attemptId)` | |
| `IntegrationSessionOpened(task, expectedHead)` | captures the head |
| `PromotionIntentRecorded(task, expectedHead)` | before the ref mutation |
| `IntegrationAbandoned(task, reason)` | terminal, retained rather than settled |
| `CapacityRevised(capacity)` | |
| `DirectionApplied(subject, Pause \| Unpause)` | |

## Non-action occurrences

| Event | Note |
|---|---|
| `TrackerFactsObserved(subjects, facts, complete, contentIdentity)` | the graph read |
| `ClaimRecordRead(task, owner, token)` | the reread after an unknown result |
| `ExecutorReported(task, attemptId, Running \| SafelySuspended \| Terminal(r))` | |
| `PromotionOutcomeObserved(task, head)` | resolves the promotion intent |
| `TargetHeadObserved(head)` | external advance |

Sixteen events against eighteen model actions, close to 1:1 except where the two
ambiguous effects split.

## Two shape decisions

### `TrackerFactsObserved` carries completeness, not the full quality vector

`ARCHITECTURE.md` has an observation state its subjects, covered fact families,
completeness, consistency, freshness and content identity. Carrying all six is
more fidelity than this abstraction wants.

`complete` is not optional though, because **"missing coverage never proves that
a blocker or task is absent"** is unstateable without it. An observation that
omits a subject and an observation that proves a subject absent must be
different values, or the fold will infer absence from silence — which is the
exact defect the rule exists to prevent.

`contentIdentity` is carried so two observations with equal contents at
different logical read times remain distinguishable, which #194's "equal G2
retains later observation identity" depends on.

**Assumed away, explicitly:** consistency and freshness. Incomparable facts and
staleness are not represented, so no property here can say anything about
conflict resolution.

### `IntegrationAbandoned` carries a named reason, not a string

Modelled the way I3 models exclusion: a nonempty reason type, so a reason-free
abandonment cannot be written down. `Abandoned` is retained rather than settled
precisely *because* it carries a stated reason, and a free-text field would make
the second disjunct of I18 unfalsifiable.

```
Reason = StaleTargetHead | CorrectionLimitReached | ContinuationLimitReached
```

**Assumed, explicitly:** `specs/acceptedResultIntegration.qnt` has
`CorrectionLimitReached` and `ContinuationLimitReached` as real terminal states.
The bake-off model reaches only `StaleTargetHead`, because it has no correction
loop. The other two are in the type so the alphabet matches production, and they
are unreachable in this abstraction — which the witnesses must state rather than
leave to be discovered.

## Journal positions are not in events

`ARCHITECTURE.md`: "A workflow event is the immutable domain value for one
past-tense occurrence; a **journal record is its durable envelope**." Position
belongs to the envelope. Two identical occurrences at different positions are
the same value, and putting the position inside would make them different ones.
`CONTEXT.md` also keeps "journal position" as a distinct concept in the _Avoid_
set for **Task**.

```
Event  = ...              -- no position
Record = { position, event }
fold   : List Event -> State
```

The consequence is what "idempotent under replay" can mean. With no positions
there is no dedup-by-id, and there should not be: two genuine identical
occurrences must both count. So replay is **recomputation from the origin**, not
re-application to current state, and idempotence reduces to determinism of the
fold.

That is nearly free in Lean, Agda and Dafny and a live risk in TypeScript, where
`Date.now()`, `Math.random()` or map iteration order break it silently and no
sampling test reliably catches it.

## The four propositions, ranked

1. **Prefix-totality.** `fold` is defined on every prefix, because a crash
   truncates anywhere. Free in Agda and Lean — the totality checker enforces it
   — a real obligation in Dafny, a live risk in TypeScript. Same
   invariant-disappears-into-a-type phenomenon as I3.
2. **Homomorphism.** `fold (p ++ q) = foldFrom (fold p) q`. This *is*
   crash-recovery correctness: reconstructing from a truncated prefix and
   replaying the rest equals reconstructing from the whole journal.
3. **Regional contradiction.** If `xs` restricted to region A is consistent then
   `fold(xs).A` is a normal state whatever region B contains, while structurally
   invalid shared history fails the Run closed. The subtlest of the four and the
   likeliest to be wrong under maintenance.
4. **Determinism.** Above.

## Why this is more than a fifth L1 property

L1 and L2 are currently two unconnected exercises. The homomorphism is the
bridge: it makes L2's `recover` action *equal to* folding the journal rather
than a hand-written reconstruction that happens to look right. That would be the
first refinement claim in the study.

A full refinement needs L2 actions to emit events and carry a journal variable —
expensive in TLC, tractable in Lean and Agda. Propositions 1–3 at L1 do not, and
come first.
