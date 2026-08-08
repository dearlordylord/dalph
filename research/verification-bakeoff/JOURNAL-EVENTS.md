# The journal event alphabet

The alphabet I15 folds over, at the abstraction of `MODEL.md`. Propositions
1–4 below are built in fast-check: `fastcheck/journal.mjs` (alphabet and
fold), `fastcheck/journal-run.mjs` (properties, witnesses, negative
controls), with the interpretation decisions recorded in
`fastcheck/NOTES.md`. `lean/Journal.lean`, `agda/Journal.agda`, and
`dafny/Journal.dfy` now port the concrete guards/effects and prove the fold
laws, with checker-rejected negative controls in `prover-mutants.mjs`.
`journal-events.json` is the canonical tag/kind/payload manifest.
`generate-journal-events.mjs` generates JavaScript constructors and compiling
constructor witnesses for every prover. `lean/JournalRefinement.lean` proves
semantic refinement from an emitting transition to this fold; `LEARNING.md`
states the exact strength of that generated/proved boundary.

## Three constraints from the domain

**Actions name an actor; non-action occurrences do not.** `ARCHITECTURE.md`:
"An initiated action names its actor. A non-action occurrence, such as receiving
tracker facts or an executor report, does not copy the actor from an earlier
action." The split is structural, not cosmetic — every event exposed to a
generic consumer has exactly one action/non-action classification, and adding a
variant must break exhaustive consumers.

**Intent precedes an ambiguous effect.** `journal-and-reconstruction.md`:
"Before a request whose outcome may become ambiguous, Dalph records the exact
intent and waits for the append acknowledgement. It then calls the owning
system. After the call it records the exact returned or observed result." The
same doc names the specializations: "A claim intent is reconciled against the
tracker claim record; **a worktree intent against Git**; an executor
responsibility through the Dalph executor."

So three protocols carry the pattern, not two. Each becomes an intent action
plus an outcome occurrence. The promotion ref mutation is a fourth by the same
argument (`specs/gitReconciliation.qnt` has `ambiguousTargetNeverPromotes`),
though the docs do not list it among the specializations.

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
| `WorktreeIntentRecorded(task, attemptId)` | before the ambiguous Git worktree effect |
| `IntegrationSessionOpened(task, expectedHead)` | captures the head |
| `PromotionIntentRecorded(task, expectedHead)` | before the ref mutation |
| `CandidateConstructionNonConvergent(task, reason)` | terminal, retained rather than settled |
| `DeliverySettled(task)` | the terminal delivery fact — I18's first disjunct |
| `WorkflowRunBegun(runId, target)` | first durable fact for a Run |
| `WorkflowRunTerminated(runId)` | final fact for a normally completed Run |
| `CapacityRevised(capacity)` | |
| `DirectionApplied(subject, Pause \| Unpause)` | |

## Non-action occurrences

| Event | Note |
|---|---|
| `TrackerFactsObserved(subjects, facts, complete, contentIdentity)` | the graph read |
| `ClaimRecordRead(task, owner, token)` | the reread after an unknown result |
| `ClaimedTaskEligibilityObserved(task, revision)` | ADR 0002's precondition for planning an attempt |
| `ClaimedTaskIneligible(task, MissingFromTargetClosure \| NotOpen \| PrerequisitesUnsatisfied)` | its negative outcomes |
| `WorktreeReconciliationObserved(task, attemptId, outcome)` | resolves the worktree intent |
| `ExecutorReported(task, attemptId, Running \| SafelySuspended \| Terminal(r))` | |
| `PromotionOutcomeObserved(task, head)` | resolves the promotion intent |
| `TargetHeadObserved(head)` | external advance |

Twenty-three events. The mapping to the eighteen model actions is *not* close to
1:1, and the gaps are the interesting part:

- three ambiguous effects **split** into intent plus outcome (claim, worktree,
  promotion);
- `applyPause` and `applyUnpause` **merge** into one `DirectionApplied`, and
  `safelySuspend` and `reportAccepted` into one `ExecutorReported`;
- `crash` and `recover` have **no events at all** — crash is truncation, and
  recovery is the fold itself rather than something the fold consumes;
- `ClaimReleaseIntentRecorded`, the Run lifecycle pair, and ADR 0002's
  eligibility outcomes have **no model action**, because the shared benchmark
  has no claim release, no Run boundary, and no eligibility precondition.

That last group is the useful signal: the alphabet is wider than the model
because the model is a deliberately coarse benchmark, not because the alphabet
is speculative.

## Shape decisions

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
conflict resolution — which also means Proposition 3 below is *not* about the
ADR 0006 conflicts, only about a region whose events are structurally
inconsistent.

### The terminal-but-not-settled event uses the domain's own name

`IntegrationAbandoned` would have been invented vocabulary, and worse,
"attempt abandonment" is in the _Avoid_ set for executor-work suspension
(`CONTEXT.md`). The domain term is **Non-convergent candidate construction**:
"the durable disposition after either the separately selected positive
correction limit or automatic agent-continuation limit is exhausted in one
integration session. Dalph preserves the accepted result and isolated Git work,
leaves the task incomplete, and releases the process-local integration-target
resource."

That is exactly I18's second disjunct, named by the domain rather than by me.

### It carries a named reason, not a string

Modelled the way L1 models exclusion: a nonempty reason type, so a reason-free
abandonment cannot be written down. `Abandoned` is retained rather than settled
precisely *because* it carries a stated reason, and a free-text field would make
the second disjunct of I18 unfalsifiable.

```
Reason = CorrectionLimitExhausted | ContinuationLimitExhausted | StaleTargetHead
```

**Assumed, explicitly:** the first two limits are real —
`specs/acceptedResultIntegration.qnt:16-17` declares `CorrectionLimitReached`
and `ContinuationLimitReached` as terminal phases, and
`packages/dalph/src/cassettes/recorded-domain.ts` carries the production
counterparts. `StaleTargetHead` is *this study's* addition, reachable in the
bake-off model and with no production counterpart, because the benchmark has no
correction loop. The other two are unreachable in this abstraction, which the
witnesses must state rather than leave to be discovered.

## An event does not carry its own position, but may reference one

`ARCHITECTURE.md`: "A workflow event is the immutable domain value for one
past-tense occurrence; a **journal record is its durable envelope**." An event's
*own* position belongs to the envelope. Two identical occurrences at different
positions are the same value, and putting the position inside would make them
different ones. `CONTEXT.md` keeps "journal position" out of the **Task revision
fingerprint** for the same reason.

That is not a blanket rule against positions appearing in events, and the
distinction matters here. `journal-and-reconstruction.md`: "A tracker graph
observation **retains the logical read identity and journal position that
recorded it**", and `CONTEXT.md` has an integration responsibility's
"workflow-journal position supplies its order". A position *referenced as
evidence* is ordinary data; a position *identifying the event itself* is
envelope.

```
Event  = ...                       -- no position of its own
Record = { position, event }       -- the envelope supplies that
fold   : List Event -> State
```

So `TrackerFactsObserved` legitimately carries the journal position of the read
that recorded it, while no event carries the position at which it is appended.

The consequence is what "idempotent under replay" can mean. With no
self-identifying position there is no dedup-by-id, and there should not be: two
genuine identical occurrences must both count. So replay is **recomputation from the origin**, not
re-application to current state, and idempotence reduces to determinism of the
fold.

That is nearly free in Lean, Agda and Dafny and a live risk in TypeScript, where
`Date.now()`, `Math.random()` or map iteration order break it silently and no
sampling test reliably catches it.

## The four propositions, ranked

1. **Prefix-totality.** `fold` is defined on every prefix, because a crash
   truncates anywhere. Free in Agda and Lean — the totality checker enforces it
   — a real obligation in Dafny, a live risk in TypeScript. Same
   invariant-disappears-into-a-type phenomenon as the L1 exclusion reasons.
2. **Homomorphism.** `fold (p ++ q) = foldFrom (fold p) q`. This *is*
   crash-recovery correctness: reconstructing from a truncated prefix and
   replaying the rest equals reconstructing from the whole journal.
3. **Regional contradiction.** If `xs` restricted to region A is consistent then
   `fold(xs).A` is a normal state whatever region B contains, while structurally
   invalid shared history fails the Run closed. The subtlest of the four and the
   likeliest to be wrong under maintenance.
4. **Determinism.** Above.

## The production surface these propositions govern

Two functions carry the whole of crash recovery for delivery, and both rest on
the fold being correct:

- `activeAttemptPositions`
  (`packages/orchestrator/src/coordination/delivery/reactive-delivery-relations.ts`)
  rebuilds held task-work positions from reduced journal history. It reads the
  correlation off the stored planned attempt, so restart continues the exact
  `(RunId, AttemptId)`, and it surrenders a position only on a SafelySuspended
  or Terminal report. That is I9, I10 and I16 in one place.
- `makeDeliveryRuntimeAdmissionController` and `synchronize`
  (`packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.ts`)
  adopt those positions and hold the admission ceiling, which is I8.

Proposition 2, the homomorphism, is the statement that the first of those is
correct: reconstructing from a truncated prefix and replaying the rest equals
reconstructing from the whole journal. Propositions 1 and 4 are what make it
meaningful in TypeScript, where a partial fold or a nondeterministic one fails
silently. No model in this study reaches either function.

## Why this is more than a fifth L1 property

L1 and L2 are currently two unconnected exercises. The homomorphism is the
bridge: it makes L2's `recover` action *equal to* folding the journal rather
than a hand-written reconstruction that happens to look right. That would be the
first refinement claim in the study.

`lean/JournalRefinement.lean` now supplies that refinement without adding a
journal variable to TLC: its emitting L2 wrapper appends one canonical event
and applies the concrete L1 transition, then proves by induction that replay
reconstructs the wrapper's modeled state.
