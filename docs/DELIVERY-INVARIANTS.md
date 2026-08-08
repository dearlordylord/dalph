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
| `statable, not stated` | a tool could express it at benchmark size and none does |
| `—` | no tool in the study expresses it, and the reason is stated |

`Encoding` describes the verification study and not production coverage. Six of
the seven tools are bound to no Dalph code at all, so `→ I10` means a model
states the invariant, never that the shipped code is checked against it. What
checks production is indexed per function under "Coverage per production
surface" in `../research/verification-bakeoff/INVARIANTS.md`, and the six
subject-scoped models under `specs/` that reach production do so through
`packages/dalph/test/conformance/*.mbt.test.ts`. `integrationFinality` covers
post-promotion claim cleanup and task-local settlement without claiming Run
termination.

## Identity

**D1 Exact identity on every action.** Every action names the exact identity it
acts on: Run, task, attempt, claim and token, worktree, operation, integration
responsibility. No identity substitutes for another. A coordinator process
identity is not an attempt identity, and an operation name is not a
classification. Executor-internal structure is invisible outside the executor
boundary: generic orchestration neither allocates a second executor identity nor
exposes an executor-internal step.
→ `integrationFinality` carries exact Run/task/attempt/claim/proof bindings;
`I9` remains weakened to correlation in the benchmark's fast-check journal arm.

**D2 Attempt immutability.** A planned attempt's recorded facts — task revision
fingerprint, Base SHA, branch, worktree, executor locator — never change after
it is planned. A later observation of changed instructions is recorded beside
the attempt, never absorbed into it.
→ `—` the six L1/L2 models treat an attempt as a counter. The fast-check
journal arm carries `(runId, attemptId)` but no attempt-local facts, so
immutability of those facts is unstated everywhere.

**D3 One unsettled attempt per task.** At most one planned attempt per task is
unsettled, across crash and recovery. Process loss is not executor completion
and authorizes no replacement.
→ `I10`

**D4 Exclusive claim.** At most one active claim per task. A release or
replacement names the exact current owner and token. A token from an earlier
claim authorizes nothing.
→ `integrationFinality` exact active/completion/foreign claim identity; `I11`
(Alloy only) remains the broader benchmark projection.

**D5 Foreign ownership is never mutated.** A claim Dalph does not currently own
is preserved and reported as a typed conflict. Dalph never edits, removes, or
reacquires it, and never infers who created it.
→ `integrationFinality` foreign-claim isolation; the broader benchmark
projection remains unwriteable outside Alloy.

## Graph and selection

**D6 Bound.** The selected set is the first `capacity` eligible tasks in
deterministic graph order. Live positions are not an input to selection.
→ `I1 (weakened: Quint checks `selected.size() <= capacity`, an upper bound, not the equality I1 states, and neither states graph order)`

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
→ `I8 (weakened unevenly: Quint, TLA+ and fast-check maintain a history flag,
which the benchmark counts as evidence; Alloy, Dafny, Lean and Agda have only
an admission guard, which nothing tests)`

**D14 One position per attempt, added and released by the exact holder.** An
attempt occupies at most one task-work position at a time, and an
executor-internal identity may neither add nor release one.
→ `—` positions are a set of task ids in every model, so a second position for
the same attempt is unwriteable.

**D15 Admission is the only entry to work.** No worker starts before admission.
An applied operator direction is not capacity admission.
→ `guard` — the work-starting action carries `positions < capacity` as a
precondition in Quint, Dafny, Lean and Agda, so starting unadmitted is
unwriteable. No encoding states the second sentence, because no model has an
operator direction that could be confused with admission.

## Preservation

**D16 Work in progress survives every constraint.** No reconciliation,
constraint, pause, suspension, capacity change, or restart deletes or resets a
worktree, discards work in progress, or treats preserved work as disposable.
→ `—` the journal arm models worktree *existence* — intent, reconciliation
outcome, pending state — and no arm models worktree *contents*, so preservation
of work in progress is unstated.

**D17 Cleanup is disposition-typed, exact, recoverable, and fail-closed.**
Cleanup names what it disposes of and why. Nothing is repaired, abandoned, or
cleaned automatically on an unproven fact.
→ `—` no model has a disposable resource, so there is nothing to clean up.

D37 resolves a retained execution without stating what becomes of its worktree,
and no invariant here makes disposal obligatory. A Run may therefore terminate
under D35 leaving durable state that nothing owns.

## Locality

**D18 A constraint is local to its subject.** A constraint on one task never
stops another task, never becomes a Run-wide stop, and never isolates unrelated
responsibilities. Independent work remains selectable throughout.
→ `statable, not stated` — the benchmark's two-task model can express it and no
encoding does.

**D19 Constraints clear independently.** Clearing one constraint clears only
that one. A reopened task clears its lifecycle wait and nothing else; every
other continuation fact must independently authorize resumption.
→ `—` no model carries more than one constraint per task, so independence has
nothing to range over.

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
→ `integrationFinality` records replacement and deletion intents before their
bounded requests; the fast-check journal arm also has the intent/outcome split
for claim, worktree and promotion.

**D22 Reconcile before retry.** After an ambiguous outcome, Dalph rereads the
owning system before acting again. A lost response never proves the effect did
not happen, and never authorizes a duplicate request, a second override, or a
second release.
→ `integrationFinality` models lost replacement/deletion responses and requires
a fresh claim read before a second request; other encodings still do not model
ambiguous outcomes.

**D23 Incomplete and unreadable never prove absence.** Missing coverage,
pagination, a timeout, or a partial response cannot prove a task, blocker, or
claim is absent. Unreadable, invalid, and absent are distinct results and are
never collapsed.
→ `integrationFinality` distinguishes foreign and unreadable claim reads after
an ambiguous request; neither authorizes mutation or absence.

**D24 No inferred completion across boundaries.** Success at one boundary never
implies success at another. An executor terminal report is not tracker
completion, claim removal is not completion, and terminal-without-success is not
successful completion. D28 owns the Git-side form of this.
→ `I5 (weakened: settlement-drop only)` and `integrationFinality`'s fresh
tracker-success-before-cleanup invariant.

**D25 Dalph never invents an actor.** An initiated action names its actor. A
non-action occurrence — a tracker read, an executor report — carries no actor,
and Dalph does not attribute an unauthenticated outside edit to a person.
→ `—`

## Integration and promotion

**Candidate construction, verification, and promotion audited.** Issue 57's
explicit submission, exact ordered parents, fixed session, lineage gate, and
preservation paths, issue 59's sealed verification evidence, and issue 60's
exact compare-and-set/reconciliation paths are checked against production,
maintained cassettes, and the accepted-result integration model. The
`integrationFinality` model separately covers the post-promotion claim and
task-settlement protocol; tracker completion remains owned by issue #61.

**D26 Candidate shape.** An integration candidate has exactly two ordered direct
parents: the fixed expected target head first, the immutable accepted result
second. The order is never reversed and a newer head is never substituted.
→ `I12` (Alloy only)

**D27 Promotion by compare-and-set against the exact expected head.** A stale
head selects reconciliation and an ambiguous head requires a reread. Neither
authorizes a force update, a reset, or a rewrite. A candidate is rebuilt and
reverified rather than reused against a different head.
→ `acceptedResultIntegration` promotion safety, stale-head, bounded-attempt,
and non-convergence invariants; `integrationFinality` consumes the exact
promotion proof and never reintegrates it.

**D28 Verification precedes promotion.** Only a verified candidate is offered.
Process success, the newest worktree commit, or a clean tree do not classify a
candidate as verified.
→ `acceptedResultIntegration` sealed-evidence promotion premise and ordering;
`integrationFinality` requires that exact proof before replacement intent.

## Process and durability

**D29 Authority separation.** Derived frontiers, placements, positions, queues,
provider pages, and integration-target ownership are process-local and never
persisted. The journal holds accepted workflow history only. Process loss clears
every process-local resource and no durable one.
→ `I14`

**D30 Crash is absence, not an event.** Dalph never journals a synthetic crash
occurrence. Recovery accepts every retained journal prefix, trusts no pre-crash
volatile state, and infers nothing from abandoned process memory.
→ `integrationFinality` models the post-crash ambiguity as a lost response
followed by a fresh authority read; older models still encode crash as an
action.

**D31 Recovery continues the same work.** After process loss, restart
reconstructs the existing responsibility and continues that exact attempt. D3
and D4 already forbid the replacement attempt and the second claim; the
recovery-specific clause is that no second worktree is created for a
reconstructed attempt.
→ `I16 (weakened: the six L1/L2 models carry no identity, so "same attempt" is
unstateable there; the fast-check journal arm carries `attemptId` and correlates
on it)`

**D32 Journal reduction.** Append-only. Reduction is a pure fold, total over
contradictory histories, and idempotent under replay.
→ `I15`, checked in `fastcheck/journal.mjs` over the 23-event alphabet, with the
four propositions in `journal-run.mjs` and negative controls in
`journal-mutants.mjs`.

**D32a Journal record admission.** Records are scoped to their Run: none
precedes the Run's beginning fact, none follows its termination fact, there is
exactly one of each, and no record for another target is placed under a Run.
→ `checked` in `fastcheck/journal.mjs`, as fold guards rather than as a stated
property. This is a property of which records may be admitted, not of the
reduction function, which is why it is separate from D32.

## Progress

**D33 No silent drop.** Once the run stops crashing, is not paused, has
capacity, and receives no further tracker facts, every begun responsibility
eventually settles or is retained together with an exact stated reason.
→ `I18 (weakened: the no-new-facts hypothesis is inexpressible — the task set is
a fixed constant in every model)`; `integrationFinality` retains cleanup waits
after failed or ambiguous deletion.

**D34 Quiescence is not completion.** With no new tracker facts the run reaches
quiescence only when the executable proposal frontier is empty and no admitted
action still has a live owner. Quiescence proves no currently executable action
— not completion and not an empty target. Only one later accepted complete
tracker observation may support the activation's next decision. Quiescence is
never inferred from process loss, a timeout, a boundary result not yet published
by delivery planning, or missing session data. D35 owns termination.
→ `I19` and `integrationFinality`'s empty-frontier witness with a retained
unrelated responsibility.

**D35 A Run does not terminate while it owes work.** Termination requires a
later accepted complete tracker observation proving the target settled, no
outstanding obligation, no executable action, and no live action owner. An
unsettled retained responsibility keeps the Run active.
→ `integrationFinality` proves that an empty frontier cannot settle its
retained task responsibility; whole-Run termination remains owned by issue
#102 and is outside this subject model.

**D36 No busy loop on unchanged facts.** One activation performs at most one
post-quiescence tracker reconfirmation. It runs any actions introduced by that
observation to quiescence and then returns; unchanged observations do not
produce repeated work or continuous polling. A later activation may perform
its own one-shot reconfirmation.
→ `—` every model's actions are enabled by state rather than by observation, so
a repeated identical observation is not a distinguishable event.

**D37 Every Run is convergeable.** *Not implemented: no Operator resolution
exists for a task closed without success or removed from the target closure, so
a Run in that state cannot currently terminate.* Under the same hypotheses as
D33, every retained obligation has an Operator resolution that settles it, so no Run is
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

The L1 and L2 models take a third, degenerate position: `T` is a fixed
constant, so `N = |T|` and *zero* insertions are permitted. That is stronger
than either usable form.

`research/verification-bakeoff/tlaplus/DeliveryArrival.tla` is the exception and
models arrival directly, with a task arriving and the graph later sealing. What
it establishes is that arrival is *undecidable at this size*, not inexpressible:
TLC returns no verdict on the uncapped run, and capping the run makes the
liveness claim unsound. So a ticket arriving mid-run is writeable and unchecked,
which is a statement about tractability rather than about expressiveness.

## Run boundaries

**D38 One Run is activated, and a foreign Run is neither ignored nor resumed.**
When durable history holds more than one unterminated Run, startup fails closed
naming every Run identity it found, and mutates no tracker, Git, or executor
state for any of them. Historical responsibility entries belonging to another
Run neither block the activated Run nor cause completed work to repeat.
→ `—` every model has exactly one Run.

**D39 A fresh-start request is not recovery.** A repeated request to start a Run
fresh is never classified as recovery of an existing Run, and actions from two
fresh starts are never merged into one workflow-journal history.
→ `—` no model distinguishes an inbound start request from process restart.

**D40 The capacity ceiling is durable and reconstructed.** After process loss the
ceiling comes from journaled applied policy. It is neither a process default nor
a caller argument, and recovery requires no initial-policy input.
→ `—` capacity is a free variable in every model, with no provenance.

## Serialized integration

**Admission through exact-head promotion implemented.** The issue 56 queue,
issue 57 candidate session/resource behavior, issue 59 verification, and issue
60 promotion behavior below are checked against production. Issue 138's
blocker reconciliation and session-supersession qualification remains
separately accepted work; the implemented fixed-session rules do not imply
that later behavior.

**D41 Integration admission is a distinct resource from task-work capacity.**
Queued or started integration is not counted against task-work capacity, and
acquiring task-work capacity is not acquiring the serialized integration
resource.
→ `—` no model separates the two resources.

**D42 The integration queue is single and its order is acceptance-derived.**
Order follows accepted-result acceptance, not task identity, completion time, or
insertion order. The same-target queue is never reordered, and one responsibility
does not move ahead of another merely because that other is waiting.
→ `—` no model has a queue.

**D43 The serialized target resource is released while only waiting.** Process-local
target ownership is not retained across a wait on tracker facts.
→ `—`

**D44 At most one unsettled integration session per accepted result.** A stale
expected target may establish integration-session supersession; only then may a
successor session bind the newly observed head. Exhaustion, a lost response, or
a lost editing process never silently supersedes a session or creates a
successor session or candidate, and a submission is routed by its exact session
rather than guessed or inferred from a worktree tip.
→ `—` D3's shape applied to sessions; no model has an integration session.

**D45 Conflict work is isolated from the planned worktree.** Integration and
conflict resolution never apply edits to the planned task worktree.
→ `—` no model has a worktree.

**D46 A withdrawn capability stays withdrawn.** Once a recorded cutoff removes a
capability — pre-integration cancellation after integration starts — it is not
offered again, and restart reconstructs the cutoff rather than resurrecting the
capability.
→ `—` no model offers a capability that can be withdrawn.

## Operator requests

**Partly implemented.** Applying a direction ships; the request-identity and
race-arbitration rules are accepted specification from issue 65, which is open.

**D47 Receipt is not application.** Receiving an Operator command is ephemeral;
applying one exact direction is a durable action. Command receipt is never
recorded as an applied policy change.
→ `I17 (weakened: the models apply a direction with no receipt step)`

**D48 An applied direction authorizes exactly one matching later action.** A
reacquisition intent requires a prior matching applied direction. A direction
applied after exact or unreadable evidence cannot authorize a later loss, a
restoration ends an earlier direction, and a stale identity is rejected.
→ `—`

**D49 Operator request identity is exact.** Exact redelivery of a request returns
its recorded result rather than acting twice. Reuse of a request identity for a
different Run, task, attempt, fingerprint pair, or choice is a typed
contradiction. Where two valid requests race, the first committed to the journal
wins regardless of arrival order, and a later change of instructions requires a
fresh choice.
→ `—` D21 and D22 govern outbound ambiguity; nothing in the study models inbound
request identity.

## Open questions

Items below are unresolved and must not be read as settled behavior.

1. **Delivery-level settlement.** The delivery relation carries a settlement
   value that production always leaves empty, while settlement actions are
   separately proposed and executed. Whether the empty value is future work or
   dead design is undecided.
