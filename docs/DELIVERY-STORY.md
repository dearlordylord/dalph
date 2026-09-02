# One delivery story

One Run, told twice: as beats a person can follow, and as a state table that
makes each beat's arithmetic checkable. The story is chosen to touch as many of
`docs/DELIVERY-INVARIANTS.md` as one chronology can.

Both registers are prose. The maintained cassette
`authored:deliveryInvariantStory` is an executable graph-and-restart chronology:
one real Run consumes the staggered
graph A → B+C → D → E+F → H+I → G with X added
during process loss between A and G, and reconstructs the exact B and C
task-work positions before newly observed X can use capacity. Every executor
returns an immutable accepted commit; each result then crosses one outer
Integrator session, Dalph's Git validation of the explicitly reported
candidate, exact-head promotion, tracker completion, exact completion-claim
deletion, and delivery settlement. Merge construction, repository checks,
review, and private retries are inside the Integrator and are not Dalph stages.
Later complete tracker graphs—not executor completion reports—release each
dependent wave and finally authorize `RunMayTerminate`. The separate
`authored:deliveryFinalitySpine` retains the real A promotion and
completion-finality chronology while B remains open. Later graph answers report
C through G successful, but that cassette contains no executor or integration
chronology for those tasks. Neither cassette pretends to execute all 22
beats below. The checked-in manifest maps every beat either to exact maintained
evidence or to an explicit implementation gap. Repository tests fail when the
document, manifest, catalog key, or cited evidence changes without the others.
The Lab never fabricates the missing combined chronology.

Alice is the Operator. `Gₙ` is a tracker graph revision. Capacity is the
configured bound on concurrent task work. A task is **held** while it occupies a
task-work position, and **retained** while Dalph still owes work on it without
holding a position.

## The beats

**1.** Dalph reads the tracker. `G₀` has five open tasks, A through E, none
blocked. All five are eligible; graph order selects the first three.

**2.** Dalph claims A, B and C, plans one attempt each, and three executors
begin work. Three positions are held.

**3.** Alice edits B's instructions in the tracker. The tracker derives a new
instruction fingerprint for B; the graph is now `G₁`.

**4.** While B continues autonomously, the tracker's notification—or the
existing bounded timer if that notification is lost—selects one ordinary
refresh through the single Run freshness owner. Dalph re-reads the graph and
B's instructions. B is still open, still in the target closure, still exactly
claimed by Dalph, and its fingerprint has moved. Dalph asks B's executor to
safely suspend. B keeps its position meanwhile. Executor reports do not trigger
or define coverage for this read.

**5.** B's executor reports its work resumable with nothing still running.
Dalph releases B's position, preserves B's worktree and work in progress, and
shows Alice three choices for B: continue the existing attempt, restart the
implementation, or stop it. Both fingerprints travel with the choice.

**6.** With a position free, D is admitted — the next task in graph order — and
its executor begins.

**7.** Alice lowers capacity from three to two. Nobody is evicted: A, C and D
keep working. The new ceiling binds the next admission, not the current
holders.

**8.** The Dalph coordinator dies while the controlled executor substrate
retains exact observable A, C and D work.

**9.** Dalph restarts. It reconstructs A, C and D as held positions from
journal history, read-only projects those same three executing attempts, and
reattaches observers without another begin or resume command. B is still
retained and still awaiting Alice. Capacity is two and three positions are
held, so nothing new is admitted. Whole-host loss that destroys the executor
projection is a separate fail-closed case, not this coordinator-loss beat.

**10.** Alice closes C in the tracker without success. `G₂`. A notification or
bounded timer selects the ordinary complete refresh; Dalph records the
observation and asks C's executor to safely suspend.

**11.** C safely suspends. Dalph releases its position and preserves the claim,
attempt, worktree and work in progress, holding C in a reversible lifecycle
wait. Two positions are held and capacity is two, so still nothing is admitted.

**12.** Alice chooses *continue the existing attempt* for B. B needs a position
and none is free, so B waits — resumption is bounded by admission like any
other work.

**13.** A's executor reports an accepted result. A's position is released. B,
already owned, is admitted ahead of any unstarted task and resumes its original
attempt.

**14.** A's accepted result is queued for integration, and Dalph acquires the
integration target.

**15.** Dalph gives A's exact integration session, expected target head, and
immutable accepted result to the Integrator. The Integrator performs its whole
private workflow and reports one prepared candidate. Dalph asks Git to prove
that reported commit has exactly two ordered parents: the expected target head
first, the immutable accepted result second.

**16.** Dalph offers the candidate by compare-and-set against that exact
expected head. The head has moved. The offer does not apply, and the stale head
selects reconciliation rather than a force update.

**17.** Dalph re-reads the target head and follows the accepted stale-head
session reconciliation before a fresh Integrator session reports a candidate
for that head. Dalph Git-qualifies and promotes that candidate. The physical
integration-target position is released, but promotion does not settle A.
Dalph replaces A's exact active claim with a
promotion-correlated completion claim. A later complete tracker read reports A
successfully completed in `G₃` with that exact completion claim. Dalph deletes
only that claim, records A's delivery settlement, and removes A's retained
integration-completion responsibility.

**18.** Alice reopens C. `G₄`. Only the lifecycle wait clears; every other fact
must independently authorize resumption. C needs a position and none is free.

**19.** Alice raises capacity back to three. C is admitted and resumes its
original attempt.

**20.** Alice adds two tasks, F and G, to the tracker, both inside the target
closure. `G₅`. The next notification/timer-selected ordinary complete refresh
finds them eligible, and they wait for capacity behind the three tasks already
running. B, C, and D's executor reports prove only that their positions remain
held.

**21.** B, C and D report accepted results in turn. Each task releases its
task-work position, passes through the same outer Integrator, Git qualification,
promotion, completion-claim replacement, focused task-completion success,
claim-deletion, and delivery-settlement protocol as A, and then admits one of
E, F, G in graph order.

**22.** E, F and G report accepted results and each passes through that same
production integration and completion-finality protocol. A later complete
tracker read reports all seven tasks successfully complete. Separate focused
claim evidence proves that no exact claim remains to clean up. No action is
executable and no obligation is outstanding, so the coordinator returns
`RunMayTerminate` and the Run may record normal termination.

## The state table

| # | Beat | Graph | Cap | Held | Retained | Awaiting Alice | Invariants |
|---|---|---|---|---|---|---|---|
| 1 | tracker read | G₀ | 3 | — | — | — | D6 D7 D29 |
| 2 | A B C begin | G₀ | 3 | A B C | — | — | D3 D4 D12 |
| 3 | B's instructions edited | G₁ | 3 | A B C | — | — | D2 |
| 4 | B asked to suspend | G₁ | 3 | A B C | — | — | D12 D18 |
| 5 | B safely suspended | G₁ | 3 | A C | B | B | D10 D12 D16 |
| 6 | D admitted | G₁ | 3 | A C D | B | B | D6 D13 D15 |
| 7 | capacity 3 → 2 | G₁ | 2 | A C D | B | B | **D13** |
| 8 | coordinator loss; executor substrate remains observable | G₁ | 2 | A C D | B | B | D29 D30 |
| 9 | restart | G₁ | 2 | A C D | B | B | **D31 D1 D3** |
| 10 | C closed, asked to suspend | G₂ | 2 | A C D | B | B | D18 D24 |
| 11 | C safely suspended | G₂ | 2 | A D | B C | B | D10 D12 D16 |
| 12 | Alice continues B | G₂ | 2 | A D | B C | — | D15 D20 |
| 13 | A accepted; B admitted | G₂ | 2 | B D | A C | — | D10 D24 |
| 14 | A queued for integration | G₂ | 2 | B D | A C | — | D10 |
| 15 | Integrator reports candidate; Dalph proves its parents | G₂ | 2 | B D | A C | — | **D26 D28** |
| 16 | promotion finds a stale head | G₂ | 2 | B D | A C | — | **D27** |
| 17 | A promoted; exact completion claim deleted after a focused task read proves success; A settles | G₃ | 2 | B D | C | — | D24 D27 D28 D33 |
| 18 | C reopened | G₄ | 2 | B D | C | — | D9 D19 |
| 19 | capacity 2 → 3; C admitted | G₄ | 3 | B C D | — | — | D6 D13 |
| 20 | F and G added | G₅ | 3 | B C D | — | — | D7 D9 |
| 21 | B C D settle through completion finality; E F G admitted | G₅ | 3 | E F G | — | — | D6 D24 D33 |
| 22 | all complete and all exact completion claims removed | G₅ | 3 | — | — | — | **D34 D35** |

Held plus retained is the whole of what Dalph owes at any row, and the rule is
load-bearing: an accepted result is an obligation before it is integrated, so a
task appears in Retained from the moment its executor reports until exact
completion finality settles it. That is why A is retained at rows 13 and 14, and why B, C
and D are retained at row 21 while their results pass through integration.

A row whose held count exceeds capacity is legal and appears twice, at 7 and 9:
the ceiling governs admission, never eviction.

## Where the story does not converge

Two beats open branches that have no terminal path under current rules.

**Beat 5, if Alice never chooses.** B stays retained with its work preserved
and its position released. The Run keeps an unsettled obligation, so it must
remain active. Nothing times out and nothing decides on her behalf.

**Beat 11, if Alice never reopens C.** A task closed without success derives a
*reversible* wait, and the only thing that clears it is a later complete read
showing the task open again. There is no operator choice for this case: the
three choices at beat 5 belong to changed instructions, not to a closed task.
So a task that Alice closes and leaves closed keeps its attempt retained
forever, and the Run cannot reach beat 22.

The same holds for a task that leaves the target closure entirely, which
derives a membership constraint with the same shape and the same absent exit.

This asymmetry is the story's sharpest finding: **completing a task converges,
closing one does not.** External success releases the exact claim, frees
dependants on fresh graph facts, and settles. Terminal-without-success waits.
Both are "Alice ends this task" from where she sits, and only one of them lets
the Run finish. The missing capability is an operator resolution that settles a
retained attempt for a task that is not coming back.

## What the story assumes rather than shows

Every executor report here is matched to the attempt that asked for it, and
every claim named in a release is the one Dalph currently holds. Those are I9
and I11. The story depends on both and demonstrates neither, which is
consistent with `INVARIANTS.md`: I9 is modelled by no tool in the study.

## Executable linkage and acceptance tests

The maintained catalog key is `authored:deliveryInvariantStory`. Its source
manifest names this document and all 22 beat numbers; this document names the
same key. The separately maintained
`authored:autonomousExecutorDeliveryCapstone` composes DS-01 through DS-13
through the production workflow algebra and stops before A enters integration;
it does not replace or rename the 22-beat historical spine. Its public output
proves B's Safe boundary and retained resources at DS-05, but the production
choice control has no read/view that lists Continue, Restart, and Stop as three
simultaneously available choices or confirms that the exact B attempt remains
awaiting Alice. `AttemptChoiceControl` can apply a caller-selected choice and
read an already-applied request; the missing product boundary is a read-only
available-choice view keyed by the exact Run and Attempt. DS-05 through DS-11
therefore remain explicit manifest gaps instead of treating a later applied
Continue as proof of the earlier availability or waiting state. Adding that
product read seam is outside this assertion slice and requires the active
production-change review rule.
Every demonstrated
manifest row also names the exact registered acceptance test that checks its
evidence; a catalog key by itself is not proof.
`keeps every delivery-story beat linked to maintained evidence or an explicit
implementation gap` checks both directions, exact catalog keys, exact test
declarations, and the byte-for-byte manifest block. `consumes a staggered graph
while restart-added X waits for recovered capacity` runs the executable graph slice
through `runAuthoredScenarioCassette` and checks that it reaches its declared
end.

- `emits the exact DS01 through DS13 delivery checkpoint table` derives each
  row after an independently identified public graph, report, capacity, death,
  choice, or activation-return boundary, then checks the exact Run, attempt,
  Base SHA, active claim, branch, worktree, executor, fingerprint, report
  identity/ordinal, G0/G1/G2, capacity, held, retained, and accepted-result
  values. Before B Safe and after Continue, public facts demonstrate that no
  attempt is awaiting Alice; DS-05 through DS-11 carry an explicit
  non-demonstrated available-choice boundary instead of a placeholder. The
  DS-08 row keeps the
  last durable A/C/D/B delivery view while the same public death moment carries
  an empty process-local owner view; DS-07/08 take capacity two from the exact
  revision-two Journal event/reduced policy rather than from a future frame. It
  neither reads a private cursor nor derives an `awaiting Alice` interval from
  Journal positions.
- `retains exact Run attempt claim and resource identities across DS01 through
  DS13` checks one Run identity and the exact A0/B1/C2/D3/E4 Base SHA, active
  claims, branches, worktrees, and executor locators; it also proves no claim
  release or plan replacement through DS-05/09/11/13. At the exact DS-11
  boundary, C still has its original plan, claim, branch, ready worktree, and
  Safe report, with no worktree/branch cleanup or replacement record; this is
  the direct reversible-wait resource state, not an inference from earlier
  readiness alone.
- `publishes B F2 through one active refresh and rereads G1 after Safe before D
  begins` checks the actual four-hint burst leads to one activation, the
  executing-work G1 read precedes F2 and B Suspend/Safe, unchanged A/C append no
  command, report, or executor-state read, and exactly one post-quiescence G1
  read occurs after Safe and before D begins.
- `uses duplicate timer fallback hints for the same active refresh without a
  second activation` runs the same authored task-edit and executor cadence with
  only two ordinary Timer hints at the initial reactivation input. Because no
  notification is offered, the resulting G1/F2/Suspend/Safe path is
  deterministic timer-only evidence; both timer hints coalesce into one
  activation and one return without production winner telemetry.
- `records B's F1-to-F2 transition and one same-attempt Continue and Resume`,
  `records exactly one C2 Safe ordinal before Continue B`, and `admits retained
  B ahead of unstarted E after A releases its position` check the applied
  Operator and executor chronology at beats 11–13 without claiming a DS-05
  choice-list view. The command assertion counts exactly one durable Begin for
  A, B, and C (and later D), exactly one B Resume, and no duplicate Begin or
  Resume intent.
- `observes reduced capacity revision two before the authored restart cut` and
  `runs reconstructed ordinary activation through strict exact projections
  before returning unsettled responsibility` check revision 1→2 with no
  revision 3, then the graph/A/C/D-projection/graph restart sequence with no
  durable Begin/Resume command, active-refresh authority chain, or hint at that
  cut. The exact activation return precedes both later hints.
- `preserves the post-hint A D authority group without weakening the
  thirteen-beat story` checks both accepted authority groups join before their
  strict B and C Suspend successors. The exhaustive 84,084- and 924-order
  group tests remain the independent concurrency proof.
- `consumes a staggered graph while restart-added X waits for recovered
  capacity` checks the exact twelve prerequisite edges,
  ordered eligible waves A, B+C, B+C+X after restart, D+X, E+F, H+I, G, and empty, plus the held
  sequence B+C, C, X, D, E+F, F, H+I, I, G; it also checks X's exact
  specification precedes its first plan, recovered capacity precedes its
  worktree, all ten accepted results settle in order, and no coarse
  executor-completion result appears.
- `preserves the double-diamond middle positions across coordinator restart` checks
  that B and C both hold task-work positions before death and that recovered
  publications retain the same Run and Attempt identities.
- `settles a promoted authored task through the real completion-claim boundary`
  checks promotion alone settles nothing; the exact A claim is replaced and
  deleted only after the declared fresh successful tracker read, producing one
  real settlement/reflection frame without claiming whole-Run termination.
- `shows the staggered double-diamond frontier being consumed on one graph` checks the
  same topology, waves, and recovered B/C correlations through the Lab's
  presentation model.
- The real-browser checkpoint drives that catalog option while it is Running,
  traverses the rendered frames, and checks the exact graph, frontier waves,
  and recovered middle-wave responsibilities. The manifest explicitly
  identifies every beat whose full actor, authority facts, and chronology are
  still missing; no acceptance mapping claims those gaps.

<!-- DELIVERY-STORY-MANIFEST:START -->
cassette|authored:deliveryInvariantStory
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes a staggered graph while restart-added X waits for recovered capacity
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#preserves the double-diamond middle positions across coordinator restart
DS-01|DemonstratedByMaintainedSlice|authored:autonomousExecutorDeliveryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#retains exact Run attempt claim and resource identities across DS01 through DS13
DS-02|DemonstratedByMaintainedSlice|authored:autonomousExecutorDeliveryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#retains exact Run attempt claim and resource identities across DS01 through DS13
DS-03|DemonstratedByMaintainedSlice|authored:autonomousExecutorDeliveryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#publishes B F2 through one active refresh and rereads G1 after Safe before D begins,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#preserves the post-hint A D authority group without weakening the thirteen-beat story
DS-04|DemonstratedByMaintainedSlice|authored:autonomousExecutorDeliveryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#publishes B F2 through one active refresh and rereads G1 after Safe before D begins,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#uses duplicate timer fallback hints for the same active refresh without a second activation,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#preserves the post-hint A D authority group without weakening the thirteen-beat story
DS-05|NotImplemented|The capstone proves B Safe, position release, retained claim/attempt/worktree/work, and ordered F1/F2, but no public production view lists Continue, Restart, and Stop as three simultaneously available choices for Alice.
DS-06|NotImplemented|The capstone proves D admission and every retained B resource, but no public available-choice view confirms that exact B attempt remains awaiting Alice.
DS-07|NotImplemented|The capstone proves capacity revision 1 to 2 without eviction and every retained B resource, but no public available-choice view confirms that exact B attempt remains awaiting Alice.
DS-08|NotImplemented|The capstone proves coordinator loss with an empty local owner view and the last durable A/C/D held plus B retained view, but no public available-choice view confirms that exact B attempt remains awaiting Alice.
DS-09|NotImplemented|The capstone proves exact restart reconstruction without Begin or Resume and every retained B resource, but no public available-choice view confirms that exact B attempt remains awaiting Alice.
DS-10|NotImplemented|The capstone proves G2 and C suspension while B remains retained, but no public available-choice view confirms that exact B attempt remains awaiting Alice.
DS-11|NotImplemented|The capstone proves C Safe and retained claim/attempt/worktree/work for both B and C, but no public available-choice view confirms that exact B attempt remains awaiting Alice.
DS-12|DemonstratedByMaintainedSlice|authored:autonomousExecutorDeliveryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#records exactly one C2 Safe ordinal before Continue B,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#records B's F1-to-F2 transition and one same-attempt Continue and Resume
DS-13|DemonstratedByMaintainedSlice|authored:autonomousExecutorDeliveryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#retains exact Run attempt claim and resource identities across DS01 through DS13,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#admits retained B ahead of unstarted E after A releases its position,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#records B's F1-to-F2 transition and one same-attempt Continue and Resume
DS-14|DemonstratedByMaintainedSlice|authored:acceptedResultRestartsIntoIntegration|packages/dalph/test/cassettes/scenario.test.ts#it.effect#continues an accepted result after process death and crosses its integration cutoff once
DS-15|NotImplemented|No named acceptance test proves the candidate's exact ordered expected-head and accepted-result parents for this beat.
DS-16|NotImplemented|The maintained stale-head cassette detects H2 before compare-and-set; it does not send the beat's rejected exact-head offer.
DS-17|NotImplemented|The separate A-finality spine settles A, but does not first reconcile a stale head and rebuild its successor candidate.
DS-18|NotImplemented|No maintained run reopens a tracker lifecycle wait for C; Operator task Unpause is a different phenomenon.
DS-19|NotImplemented|No maintained run combines the retained C attempt with a later capacity increase.
DS-20|NotImplemented|The maintained staggered graph adds X during process loss and delays it behind reconstructed B/C positions; it does not add F and G behind three running tasks.
DS-21|NotImplemented|No maintained authored run finalizes B, C, and D and admits E, F, and G in one chronology.
DS-22|NotImplemented|The maintained staggered ten-task cassette finalizes all ten accepted results and terminates, but it is not the prose beat's seven-task G5 chronology for E, F, and G.
<!-- DELIVERY-STORY-MANIFEST:END -->
