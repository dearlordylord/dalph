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
surface" in `../research/verification-bakeoff/INVARIANTS.md`, and the seven
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
deterministic graph order. Live positions are not an input to selection. This
graph-policy placement is descriptive: it grants no runtime admission
capability. A task described as `EligibleOutsideBound` can become the next
fresh entrant only through D13a after a release or capacity expansion
establishes free capacity.
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
→ `plannedAttemptExecutor` states exact-correlated position discipline; its
canonical invariants and TLC temporal check cover causally requested direct or
reconciled safe evidence and autonomous terminal evidence. Benchmark `I7` remains
weaker because it has no report correlation.

**D13 The ceiling binds admission only.** A new admission respects the current
capacity. A capacity reduction never evicts, cancels, suspends, or discards an
existing holder; the ceiling applies to the next reservation. Held positions may
exceed capacity, including across restart.
→ `I8 (weakened unevenly: Quint, TLA+ and fast-check maintain a history flag,
which the benchmark counts as evidence; Alloy, Dafny, Lean and Agda have only
an admission guard, which nothing tests)`

**D13a Fresh-task admission is continuous through executor-responsibility
handoff.** Before a fresh task records its first claim intent, its exact live
entry reservation consumes one admission. Accepting
`TaskClaimAcquisitionIntended` under `TaskSelectionAuthority` replaces that
reservation with one journal-derived fresh-task admission commitment. The
commitment continues across claim, post-claim graph, specification, plan, and
worktree stages. Accepting
`PlannedAttemptExecutorWorkResponsibilityBegan` atomically replaces it with the
exact D12 attempt-held position. A matching pre-ownership
`TaskClaimAcquisitionRejected` can instead end only that commitment. Conclusive
proof that the first claim-intent append was not accepted releases its exact
live reservation because no durable commitment exists; an ambiguous append
retains the reservation until the Journal proves acceptance or absence. A
failed or ambiguous executor-responsibility append retains the pre-attempt
commitment. No action completion, provider failure, timeout, other ambiguous
outcome, capacity change, or process death creates a gap or releases either
form.

For each coherent admission decision, unique live entry reservations,
fresh-task admission commitments, and exact held attempts consume the current
ceiling. Existing ready responsibilities retain priority before fresh entry;
only the first remaining entry-capable tasks in stable derived order can
receive the free reservations. Graph placement remains descriptive and grants
no admission capability. Only an admitted candidate can be materialized as a
delivery action proposal. Contraction can leave
occupancy above capacity but admits no new task. After Dalph owns a claim, a
later task constraint retains the commitment until an accepted phase-specific
disposition proves release; issue #316 owns that later liveness protocol.
→ `freshTaskAdmission` continuous occupancy, deterministic entry, exact
handoff, crash preservation, and candidate-without-capability invariants plus
production-backed conformance; model and adapter pending under issue #315.

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
→ `—` no existing subject-scoped model can represent issue #69's three
authority families without erasing their exact locators and owner/revision
facts. `taskFactReconciliation` covers P1/P2 and tracker-claim release;
`gitReconciliation` has no locator/intention/delete protocol;
`acceptedResultIntegration` has candidate resources but no disposal;
`integrationFinality` deletes tracker claims only; and `applicationExit`
requires `durableCleanupCalls == 0`. Issue #69 is covered by focused property
tests, maintained authored/recorded cassettes, and memory/SQLite P0-P6 replay;
those are positive evidence, not Quint coverage.

D37 resolves a retained execution without making destructive disposal
obligatory. Issue #102 makes cancellation preservation the V1 default: a Run
may terminate under D35 after durable relinquishment while its recoverable
worktree remains. Deletion still requires a separate exact cleanup disposition.

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
→ `plannedAttemptExecutor` separates every exact command intent, call, and
observation; its focused evidence and Suspend-bound projections enumerate their
named finite subgraphs. `integrationFinality` records replacement
and deletion intents before their bounded requests; the fast-check journal arm
also has the intent/outcome split for claim, worktree and promotion.

**D22 Reconcile before retry.** After an ambiguous outcome, Dalph rereads the
owning system before acting again. A lost response never proves the effect did
not happen, and never authorizes a duplicate request, a second override, or a
second release.
→ `plannedAttemptExecutor` distinguishes a direct response, exact command
projection, and command-free state projection, permits one reconciliation read
per activation, and keeps post-limit recovery read-only; its finite projections
completely enumerate those rules. `integrationFinality` separately models lost
replacement/deletion responses and requires a fresh claim read before a second
request.

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

**Integrator result and promotion correction.** Issue 222 retains the useful
issue-57 facts—explicit candidate reporting, exact ordered parents, fixed
session, lineage gates, and preservation—behind the outer Integrator. Issue
59's separate verification stage is superseded: repository checks belong
inside the Integrator. Issue 60's exact compare-and-set and Git reconciliation
remain required. The accepted-result integration model now represents the
outer Integrator result, Git qualification, promotion, quarantine, and
operator-authorized successor behavior without the obsolete split.

**D26 Candidate shape.** An integration candidate has exactly two ordered direct
parents: the fixed expected target head first, the immutable accepted result
second. The Integrator must name the candidate explicitly; the order is never
reversed and a newer head is never substituted.
→ `outerIntegratorReportsOneExplicitCandidateTest` and
`exactGitParentsQualifyReportedCandidateTest`.

**D27 Promotion by compare-and-set against the exact expected head.** A stale
head selects reconciliation and an ambiguous head requires a reread. Neither
authorizes a force update, a reset, or a rewrite. A prepared candidate is never
reused against a different head; any later Integrator session receives its own
freshly qualified head.
→ `exactCandidatePromotesWithDirectCompareAndSetTest`,
`changedHeadMakesPromotionStaleAndPreservesCandidateTest`, and
`ambiguousPromotionRequiresFreshGitBeforeRetryTest`.

**D28 A prepared candidate is Git-qualified before promotion.** Dalph may offer
only the commit explicitly reported by the Integrator after Git proves its
ordered direct parents are `[H, C]`. Integrator process success, a free-form
message, the newest resource commit, or a clean tree does not identify that
commit or prove its lineage.
→ `exactGitParentsQualifyReportedCandidateTest`,
`unreportedCandidateCannotAuthorizePromotionTest`, and
`legacyVerificationCannotAuthorizePromotionTest`. `integrationFinality`
consumes only the exact promotion proof.

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
exactly one beginning in every nonempty valid history, at most one termination,
and no record for another target is placed under a Run. The lifecycle Journal
rejects a direct second beginning even though application-level establishment
is idempotent.
→ `checked` in `fastcheck/journal.mjs`, as fold guards rather than as a stated
property. `runActivation.oneBeginningPerRun` checks that same guard through the
application entry, including the ambiguous-beginning retry. This is a property
of which records may be admitted, not of the reduction function, which is why
it is separate from D32.

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
never inferred from process loss, a timeout, missing session data, or a
boundary result that delivery planning has not durably published. After Dalph
durably publishes an exact terminal executor report and ends its correlated
planned-attempt executor-work responsibility, that report may supply the
no-live-owner fact used in quiescence. A terminal report supersedes any earlier
safe-suspension report and is absorbing: it cannot authorize Stop abandonment
or Restart replacement. An `Accepted` terminal outcome follows ordinary
integration admission; `Completed` and `Failed` retain their distinct terminal
outcomes. D35 owns termination.
→ `I19` and `integrationFinality`'s empty-frontier witness with a retained
unrelated responsibility. `runActivation.finalityReadRequiresQuiescence` and
`runActivation.establishmentSourceDoesNotChangeActivationBounds` check the
single later read for both newly established and reconstructed Runs.

**D35 A Run does not terminate while it owes work.** Termination requires a
later accepted complete tracker observation supporting one accepted terminal
classification, no outstanding obligation, no executable action, and no live
action owner. `Completed` requires every task in the current Run task graph to be
tracker-confirmed successful. `Blocked` requires conclusive tracker facts that
make success of the current graph impossible and no applied cancellation.
`Cancelled` requires an applied Operator cancellation and completed
cancellation settlement. All-success takes precedence over an applied
cancellation. An unsettled retained responsibility keeps the Run active for
every disposition.
→ `integrationFinality` proves that an empty frontier cannot settle its
retained task responsibility.
`runActivation.terminationRequiresNoRetainedResponsibilityOrPosition` checks
whole-Run termination only after both durable retained attempts and their
independently reconstructed positions are gone. Issue #102 implements the
`Blocked` and `Cancelled` clauses through the same production finality path.

**D36 No busy loop on unchanged facts.** One activation performs at most one
post-quiescence tracker reconfirmation. It runs any actions introduced by that
observation to quiescence and then returns; unchanged observations do not
produce repeated work or continuous polling. A later activation may perform
its own one-shot reconfirmation. This bound and finality path are identical
whether establishment just appended the Run beginning or reconstructed an
existing unfinished history.
→ `runActivation.establishmentSourceDoesNotChangeActivationBounds`; its
deterministic parity scenario and production-backed conformance adapter enter
the same bounded path after both a new beginning and existing history.

**D37 Every Run is convergeable.** Under the same hypotheses as D33, every
retained obligation can reach an accepted settlement or durable relinquishment,
so no Run is left permanently unable to terminate. A fresh complete Run task
graph that
conclusively makes success impossible permits automatic `Blocked` after all
responsibilities settle; it does not require an Operator to authorize that
classification. A task that leaves a later graph no longer contributes to
`Completed` after its retained responsibility settles or is durably
relinquished. D16 still holds: relinquishment preserves its worktree and work
in progress unless a separate exact cleanup disposition authorizes otherwise.
→ Alice cancels an idle, executing, or integration-owned Run through the
production cancellation control; Dalph safely suspends or observes each
outside owner, records exact claim release or no-release disposition, settles
integration responsibility, rereads the complete tracker graph, and only then
records `Cancelled`. `runCancellation` and its production-backed conformance
adapter cover those paths; `runActivation` proves final precedence and exact
fresh evidence, while `run-cancellation-recovery-prefixes.test.ts` exercises
P0-P6 restart prefixes on memory and SQLite journals.

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

**D38 Exactly one discovered unfinished Run may receive one activation.** One
successful establishment feeds exactly one bounded activation for that
invocation. When durable history holds more than one unfinished Run, startup
fails closed naming every Run identity it found and mutates no tracker, Git, or
executor state for any of them. Historical responsibility entries belonging to
another Run are neither folded into the selected Run nor silently ignored.
→ `runActivation.atMostOneDiscoveredUnfinishedRunMayActivate`; its collected
negative profile chooses one of two histories and turns the invariant red.

**D39 Run establishment is idempotent and not caller-classified.** For one exact
Run identity and target, absent history evaluates the lazy initial policy and
appends one beginning. Existing history is decoded and reduced in full and
reconstructs that exact Run without evaluating a replacement initial value or
appending another beginning. A caller never selects a separate restoration
start. Invalid, mismatched, or terminated history never reaches activation.
→ `runActivation.oneBeginningPerRun`,
`runActivation.onlyExactEstablishedRunActivates`, and
`runActivation.terminatedRunIsFinal`, backed by the unified bootstrap
conformance adapter.

**D40 Initial and current capacity policy come from durable Run history.** The
initial policy source is evaluated only when exact history is absent and is
recorded in the one beginning. For existing history, the activation ceiling
comes from that beginning plus later applied changes. It is neither a process
default nor a replacement caller argument. Before new admission, held positions
are derived from exact unfinished responsibilities under that reconstructed
policy; a process-local position map is never restored as authority.
→ `runActivation.existingHistorySkipsInitialPolicy`,
`runActivation.existingHistoryUsesLatestDurablePolicy`, and
`runActivation.everyDurableRetainedAttemptHasExactPosition`. The production
adapter asserts that the ordinary delivery relation's exact admission basis is
equal to the Run-recovery projection before giving it to admission.

## Serialized integration

**Serialized integration uses one outer Integrator boundary.** The issue 56
queue and exact-head promotion rules below remain required. Dalph records the
Integrator's exact run and explicit result, asks Git to qualify the reported
candidate, and promotes only from that proof. The former candidate-agent and
target-verification stages are historical and provide no current authority.
Issues 222, 68, 138, 224, and 225 provide the accepted operational scenarios.

**D41 Integration admission is a distinct resource from task-work capacity.**
Queued or started integration is not counted against task-work capacity, and
acquiring task-work capacity is not acquiring the serialized integration
resource.
→ `—` no model separates the two resources.

**D42 The integration queue is single and its order is acceptance-derived.**
Order follows accepted-result acceptance, not task identity, completion time, or
insertion order. The same-target queue is never reordered, and one
responsibility does not move ahead of another merely because that other is
waiting. Every current accepted result follows the ordinary accepted-result
path and creates one responsibility exactly once. Historical cassette decoders
may preserve records written under the former late-Resume design, but those
records do not define current integration admission.
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
→ `taskFactReconciliation` states `postCutoffChoiceNeverApplies` and reaches the
integration-started rejection. The scenario's forbidden Continue, Restart, or
Stop result is exercised by `rejects every attempt choice after the exact
integration cutoff`.

## Operator requests

**Accepted operator-request rules.** Applying a control direction and the issue
65 exact changed-attempt Continue/Stop choice, exact redelivery,
request-identity contradictions, first-journaled race arbitration, and the
pre-integration cutoff ship. Issue 66 extends the accepted choice algebra with
Restart but is not implemented yet. The issue 65 and issue 66 cassette scenarios
trace the forbidden results named by D46-D49:
receipt alone is not policy, a stale direction crosses no later boundary, one
request identity cannot name different contents, a losing raced choice cannot
act, and a later fingerprint requires a fresh choice.

**D47 Receipt is not application.** Receiving an Operator command is ephemeral;
applying one exact direction is a durable action. Command receipt is never
recorded as an applied policy change.
→ `controlDirectionApplication` separates `receive` from durable application;
`applicationClaimsNoLaterEffects` also prevents application from claiming the
later executor or tracker work. Benchmark `I17` remains weaker because its
cross-tool projection omits receipt.

**D48 An applied direction authorizes exactly one matching later action.** A
reacquisition intent requires a prior matching applied direction. A direction
applied after exact or unreadable evidence cannot authorize a later loss, a
restoration ends an earlier direction, and a stale identity is rejected.
→ `taskFactReconciliation` states the weaker
`replacementClaimRequiresDirectionAndIntent`; production history additionally
checks the exact prior direction and its observation episode. The scenario seam
`does not cross cleanup or integration boundaries for a stale direction` traces
the forbidden later action.

**D48a Terminal lifecycle evidence is absorbing.**
When an exact terminal report is accepted after an applied Restart or Stop,
the report becomes the sole current lifecycle fact. The earlier terminal choice
cannot use that report to authorize replacement or abandonment. An Accepted
result follows ordinary integration admission; Failed and Completed remain
their exact terminal outcomes. Historical late-Resume cassette records remain
decoder evidence only.
→ `taskFactReconciliation` states
`terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains`; the accepted-result integration
model has no Restart-specific suppression branch; production admission queues
the durable Accepted result after Restart once its evidence qualifies.

**D49 Operator request identity is exact.** Exact redelivery of a request returns
its recorded result rather than acting twice. Reuse of a request identity for a
different Run, task, attempt, fingerprint pair, or choice is a typed
contradiction. Where two valid requests race, the first committed to the journal
wins regardless of arrival order across Continue, Restart, and Stop, and a
later change of instructions requires a fresh choice. A later fingerprint may
not turn an earlier terminal choice into Continue authorization for the same
immutable attempt.
→ `taskFactReconciliation` states `requestIdentityErrorsRemainDistinct`,
`firstJournaledChoiceWins`, and `changedAgainRequiresNewChoice`. Its collected
tests reach exact redelivery, conflicting reuse, both race winners, the new
fingerprint choice, and Restart redelivery; matching production cassette tests
use those same cases.

## Application Exit

Issue 169 specifies the application-level cutoff and drain. Issue 203 supplies
the focused model, finite proof projections, typed lifecycle-decision kernel,
and production-backed conformance adapter. The shared cutoff/drain runtime and
application-shell integration remain owned by issues 204-210, so these
invariants do not yet describe an end-to-end shipped Exit path.

**D50 Exit closes forward-progress admission exactly once.** Accepting the
first graceful application Exit request and closing the process-wide admission
gate are one indivisible decision. Admission permission and live-owner
registration cannot straddle that cutoff. Later requests join the same drain
without resetting its clock; only enumerated fast Exit-drain actions may begin
afterward.
→ `applicationExit` states cutoff uniqueness, no later forward owner,
joined-request result agreement, and monotonic non-resetting ticks.

**D51 Successful Exit proves recoverability, not work completion.** Success
requires every running executor attempt to have an exact correlated safe-or-
terminal report, every produced journal write to be acknowledged, and every
process-local owner, reservation, fiber, task-work position, and coordinator
lock to be released. An ambiguous outside effect may remain only behind its
acknowledged exact intent and with no local owner able to send a successor.
Exit never starts an executor `begin` or `resume` request, fresh reconciliation,
stabilization, durable-resource cleanup, attempt replacement, or Run
termination.
→ `applicationExit` states the typed owner-disposition and success guards;
`plannedAttemptExecutor` retains exact suspension and position-release proof.

**D52 Exit lifecycle is not Run workflow history.** Exit request, result,
failure, timeout, signal, and process death are never appended to a Run journal
or restored as an application mode. A conclusive failure force-terminates
nonzero after useful quick drain work settles. The fifth monotonic drain tick
force-terminates unresolved work nonzero. Neither path proves safe suspension,
an outside result, cleanup disposition, Pause, cancellation, or Run
termination; later startup uses ordinary Run establishment and reconciliation.
→ `applicationExit` states lifecycle non-persistence and forced-termination
non-inference; `runActivation` retains ordinary process-loss reopening.

## Open questions

Items below are unresolved and must not be read as settled behavior.

1. **Delivery-level settlement.** The delivery relation carries a settlement
   value that production always leaves empty, while settlement actions are
   separately proposed and executed. Whether the empty value is future work or
   dead design is undecided.
