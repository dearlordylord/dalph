# Delivery invariants

The properties Dalph's delivery behavior must hold. This is the specification.
`research/verification-bakeoff/INVARIANTS.md` is a benchmark projected from it,
carries weakened forms chosen so seven verification tools could all encode them,
and is temporary.

Sources swept: `docs/ARCHITECTURE.md`, `docs/CONTEXT.md`,
`docs/OPERATIONAL-SCENARIOS.md`, the forbidden-result sections of
`docs/scenarios/`, the delivery invariants in `AGENTS.md`, and the stated
properties of `specs/*.qnt`.

The cassette scenario files are authoritative for how behavior is recorded and
replayed. Their rules that constrain what Dalph does to tasks are folded in
here — D25 is the clearest — while their rules about recording fidelity,
evidence lenses, and catalog maintenance govern the test corpus and belong with
it rather than in a delivery invariant list.

**Encoding** records whether the study can express the invariant:

| | |
|---|---|
| `Iₙ` | projected into the benchmark as that entry |
| `Iₙ (weakened)` | projected, in a form that loses something — the loss is stated |
| `—` | no tool in the study expresses it, and the reason is stated |

## Identity

**D1 Exact identity on every action.** Every action names the exact identity it
acts on: Run, task, attempt, claim and token, worktree, operation, integration
responsibility. No identity substitutes for another. A coordinator process
identity is not an attempt identity, an operation name is not a classification,
and an executor-internal identity may not add or release a task-work position.
→ `I9 (weakened: correlation only)`

**D2 Attempt immutability.** A planned attempt's recorded facts — task revision
fingerprint, Base SHA, branch, worktree, executor locator — never change after
it is planned. A later observation of changed instructions is recorded beside
the attempt, never absorbed into it.
→ `—` no model carries attempt-local facts; every model treats an attempt as a
counter.

**D3 One unsettled attempt per task.** At most one planned attempt per task is
unsettled, across crash and recovery. Process loss is not executor completion
and authorizes no replacement.
→ `I10`

**D4 Exclusive claim.** At most one active claim per task. A release or
replacement names the exact current owner and token. A token from an earlier
claim authorizes nothing.
→ `I11` (Alloy only)

**D5 Foreign ownership is never mutated.** A claim Dalph does not currently own
is preserved and reported as a typed conflict. Dalph never edits, removes, or
reacquires it, and never infers who created it.
→ `—` requires claim ownership, which only Alloy models.

## Graph and selection

**D6 Bound.** The selected set is the first `capacity` eligible tasks in
deterministic graph order. Live positions are not an input to selection.
→ `I1`

**D7 Order independence.** Selection is invariant under permutation of the
tracker's task order.
→ `I2`

**D8 Exhaustive classification with stated reasons.** Every task in an observed
graph is eligible, or excluded with at least one graph-owned reason. A
reason-free exclusion does not exist.
→ `—` unwriteable in every encoding, so no tool needs a property for it.

**D9 Eligibility changes only from fresh authoritative graph facts.** A
dependant is released by a fresh complete read proving its prerequisite
satisfied — never by an executor result, a claim removal, or Dalph's own
inference.
→ `—` no model separates the graph fact from the event that caused it.

**D10 Retention.** A task carrying an exact outstanding obligation stays in the
delivery relation under every placement, including absence from the current
graph. Losing positive selection never erases it.
→ `I4`

**D11 No invention.** Obligations are a function of exact evidence. Placement
alone never creates one.
→ `I6`

## Admission and capacity

**D12 Position discipline.** A task-work position is held exactly while its
attempt is in a holding phase. It is released on the correlated safe-suspension
or terminal report, and on nothing else — not a stopped inner process, not a
timeout, not process death.
→ `I7 (weakened: no correlation on the report)`

**D13 The ceiling binds admission only.** A new admission respects the current
capacity. A capacity reduction never evicts, cancels, suspends, or discards an
existing holder; the ceiling applies to the next reservation. Held positions may
exceed capacity, including across restart.
→ `I8 (weakened: history flag, not a transition property)`

**D14 One position per attempt.** An attempt occupies at most one task-work
position at a time.
→ `—` positions are a set of task ids in every model, so a second position for
the same attempt is unwriteable.

**D15 Admission is the only entry to work.** No worker starts before admission.
An applied operator direction is not capacity admission.
→ `—`

## Preservation

**D16 Work in progress survives every constraint.** No reconciliation,
constraint, pause, suspension, capacity change, or restart deletes or resets a
worktree, discards work in progress, or treats preserved work as disposable.
→ `—` no model has a worktree.

**D17 Cleanup is disposition-typed, exact, recoverable, and fail-closed.**
Cleanup names what it disposes of and why. Nothing is repaired, abandoned, or
cleaned automatically on an unproven fact.
→ `—`

## Locality

**D18 A constraint is local to its subject.** A constraint on one task never
stops another task, never becomes a Run-wide stop, and never isolates unrelated
responsibilities. Independent work remains selectable throughout.
→ `—` the benchmark's two-task model can express it and no encoding states it.

**D19 Constraints clear independently.** Clearing one constraint clears only
that one. A reopened task clears its lifecycle wait and nothing else; every
other continuation fact must independently authorize resumption.
→ `—`

**D20 Pause scope is exactly what was directed.** Pause applies to the named
subject. It does not follow prerequisite or dependant edges, does not pause
siblings, and does not manufacture descendant directions. Pause is not
cancellation, and unpause is not cancellation.
→ `I17 (weakened: run-wide pause only, no subject scoping)`

## Ambiguity and evidence

**D21 Intent before an ambiguity-crossing effect.** Before a request whose
outcome may become ambiguous, Dalph records the exact intent and waits for the
append acknowledgement, then calls the owning system, then records the exact
observed result.
→ `—` no model has an intent record.

**D22 Reconcile before retry.** After an ambiguous outcome, Dalph rereads the
owning system before acting again. A lost response never proves the effect did
not happen, and never authorizes a duplicate request, a second override, or a
second release.
→ `—`

**D23 Incomplete and unreadable never prove absence.** Missing coverage,
pagination, a timeout, or a partial response cannot prove a task, blocker, or
claim is absent. Unreadable, invalid, and absent are distinct results and are
never collapsed.
→ `—` no model represents observation quality.

**D24 No inferred completion across boundaries.** Success at one boundary never
implies success at another. An executor terminal report is not tracker
completion, claim removal is not completion, terminal-without-success is not
successful completion, and a clean working tree is not proof of required commit
parents.
→ `I5 (weakened: settlement-drop only)`

**D25 Dalph never invents an actor.** An initiated action names its actor. A
non-action occurrence — a tracker read, an executor report — carries no actor,
and Dalph does not attribute an unauthenticated outside edit to a person.
→ `—`

## Integration and promotion

**D26 Candidate shape.** An integration candidate has exactly two ordered direct
parents: the fixed expected target head first, the immutable accepted result
second. The order is never reversed and a newer head is never substituted.
→ `I12` (Alloy only)

**D27 Promotion by compare-and-set against the exact expected head.** A stale
head selects reconciliation and an ambiguous head requires a reread. Neither
authorizes a force update, a reset, or a rewrite. A candidate is rebuilt and
reverified rather than reused against a different head.
→ `I13 (weakened: guard or history flag, no reconciliation branch)`

**D28 Verification precedes promotion.** Only a verified candidate is offered.
Process success, the newest worktree commit, or a clean tree do not classify a
candidate as verified.
→ `—`

## Process and durability

**D29 Authority separation.** Derived frontiers, placements, positions, queues,
provider pages, and integration-target ownership are process-local and never
persisted. The journal holds accepted workflow history only. Process loss clears
every process-local resource and no durable one.
→ `I14`

**D30 Crash is absence, not an event.** Dalph never journals a synthetic crash
occurrence. Recovery accepts every retained journal prefix, trusts no pre-crash
volatile state, and infers nothing from abandoned process memory.
→ `—` crash is an action in every model, which is the opposite encoding.

**D31 Recovery continues the same work.** After process loss, restart
reconstructs the existing responsibility and continues that exact attempt. It
plans no replacement attempt, creates no second claim, and creates no second
worktree.
→ `I16 (weakened: no identity, so "same attempt" is unstateable)`

**D32 Journal shape.** Append-only. Reduction is a pure fold, total over
contradictory histories, and idempotent under replay. Records are scoped to
their Run: none precedes the Run's beginning fact, none follows its termination
fact, there is exactly one of each, and no record for another target is placed
under a Run.
→ `—` no model carries a journal.

## Progress

**D33 No silent drop.** Once the run stops crashing, is not paused, has
capacity, and receives no further tracker facts, every begun responsibility
eventually settles or is retained together with an exact stated reason.
→ `I18 (weakened: the no-new-facts hypothesis is inexpressible — the task set is
a fixed constant in every model)`

**D34 Quiescence is not completion.** With no new tracker facts the run reaches
quiescence. Quiescence proves no currently executable action — not completion,
not an empty target, and not permission to terminate. Quiescence is never
inferred from process loss, a timeout, or missing session data.
→ `I19`

**D35 A Run does not terminate while it owes work.** Termination requires no
outstanding obligation and no executable action. An unsettled retained
responsibility keeps the Run active.
→ `—` stated nowhere in the benchmark; it is the safety companion to D33 and
D34.

**D36 No busy loop on unchanged facts.** Unchanged observations do not produce
repeated work.
→ `—`

**D37 Every Run is convergeable.** Under the same hypotheses as D33, every
retained obligation has an Operator resolution that settles it, so no Run is
left permanently unable to terminate. This binds the cases where no outside
event clears the constraint on its own: a task closed without success, and a
task removed from the target closure. The minimum resolution is discarding the
retained execution. D16 still holds — discarding the execution preserves its
worktree and work in progress.
→ `—` no model has Operator resolutions.

### The progress hypotheses

D33 and D37 are liveness claims and hold only under an environment that stops
interfering. Writing `insert` for a task entering the target closure, `T` for
the current task set, and `Ω` for the outstanding obligations:

```
(◇□¬crash ∧ ◇□¬paused ∧ ◇□(capacity > 0) ∧ ◇□¬insert) → ◇□(Ω = ∅)
```

The fourth conjunct is the one you asked about. Without it the claim is false
and uninteresting: an Operator inserting a fresh task forever keeps `Ω`
non-empty forever, and no implementation can prevent that.

There are two ways to discharge it. The **fairness** form is the conjunct as
written — insertions eventually cease, with no bound on how many occur first.
The **bounded** form assumes a ceiling on the closure instead:

```
□(|T| ≤ N)   for some fixed N
```

which implies `◇□¬insert`, since only finitely many insertions can occur. The
bounded form is strictly stronger and is what a finite-state checker needs.

Every model in the study takes a third, degenerate position: `T` is a fixed
constant, so `N = |T|` and *zero* insertions are permitted. That is stronger
than either form, and it is why a ticket arriving mid-run is not merely
unchecked but unwriteable.

## Open questions

Items below are unresolved and must not be read as settled behavior.

1. **Delivery-level settlement.** The delivery relation carries a settlement
   value that production always leaves empty, while settlement actions are
   separately proposed and executed. Whether the empty value is future work or
   dead design is undecided.
2. **Several invariants state required behavior rather than shipped behavior.**
   Ten of the scenario files that this list was swept from belong to open
   issues, so the rules taken from them are accepted specification that
   production may not yet satisfy. `scenarios/README.md` records which. The
   clearest cases are D37, whose Operator resolution does not exist, and the
   integration and promotion family D26–D28, which comes from issues 56, 57,
   138 and 139. Nothing here should be read as a description of current
   behavior without checking.
