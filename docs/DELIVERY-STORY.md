# One delivery story

One Run, told twice: as beats a person can follow, and as a state table that
makes each beat's arithmetic checkable. The story is chosen to touch as many of
`docs/DELIVERY-INVARIANTS.md` as one chronology can.

Both registers are prose. The maintained cassette
`authored:deliveryInvariantStory` remains an independent ten-task
graph-and-restart chronology: one real Run consumes the staggered
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
chronology for those tasks. The maintained
`authored:deliveryInvariantStoryCapstone` is the separate seven-task
chronology that executes all 22 beats in one exact Run. The checked-in manifest
keeps the ten-task and narrower independent evidence while linking every beat
to the capstone. Repository tests fail when the document, manifest, catalog key,
or cited evidence changes without the others. The Lab consumes the registered
stories and never fabricates a chronology.

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

**21.** B, C and D report accepted results in turn. Each durable terminal
report releases its task-work position and establishes one distinct integration
responsibility, so E, F and G are admitted in graph order as positions release.
Their task work may execute while earlier results wait for the single
serialized integration target; integration and task-work admission are
independent. Each result still crosses the same outer Integrator, Git
qualification, promotion, completion-claim replacement, focused
task-completion success, claim-deletion, and delivery-settlement protocol as A.

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
| 8 | coordinator loss; executor substrate remains observable | G₁ | 2 | — | — | — | D29 D30 |
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
| 21 | B C D settled; E F G executing after released-position admission while integration remains serialized | G₅ | 3 | E F G | — | — | D6 D24 D33 |
| 22 | all complete and all exact completion claims removed | G₅ | 3 | — | — | — | **D34 D35** |

Held plus retained is the whole of what Dalph owes at any row, and the rule is
load-bearing: an accepted result is an obligation before it is integrated, so a
task appears in Retained from the moment its executor reports until exact
completion finality settles it. That is why A is retained at rows 13 and 14.
During the intermediate DS-21 progression B, C, and D remain retained while
their results pass through integration; row 21 is the later cut after those
settlements, with E, F, and G executing from the released task-work positions.

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

The maintained catalog keys are `authored:deliveryInvariantStory` for the
independent ten-task chronology and `authored:deliveryInvariantStoryCapstone`
for the complete seven-task chronology. Their source manifest names this
document and all 22 beat numbers; this document names the primary key and the
capstone key in its maintained rows. Every demonstrated manifest row also names
the exact registered acceptance test that checks its evidence; a catalog key by
itself is not proof.
`keeps every delivery-story beat linked to maintained evidence or an explicit
implementation gap` checks both directions, exact catalog keys, exact test
declarations, and the byte-for-byte manifest block. `consumes a staggered graph
while restart-added X waits for recovered capacity` runs the executable graph slice
through `runAuthoredScenarioCassette` and checks that it reaches its declared
end.

- `consumes a staggered graph while restart-added X waits for recovered
  capacity` checks the exact twelve prerequisite edges,
  ordered eligible waves A, B+C, B+C+X after restart, D+X, E+F+X, H+I, G,
  and empty, plus the held sequence B+C, C, X, D+X, E+X, F+X, H+I, I, and
  G and settlement order A, B, C, D, E, F, X, H, I, G; it also checks X's exact
  specification precedes its first plan, recovered capacity precedes its
  worktree, all ten accepted results settle in order, and no coarse
  executor-completion result appears.
- `preserves the double-diamond middle positions across coordinator restart` checks
  that B and C both hold task-work positions before death and that recovered
  publications retain the same Run and Attempt identities. The recovered graph
  observes X while B and C are still held; X first holds a position only after
  B's accepted-result completion is confirmed and both middle positions have
  cleared. The maintainer accepted this controlled chronology on 2026-09-11 in
  [the #350 acceptance record](https://github.com/dearlordylord/dalph/issues/350#issuecomment-5640171481);
  it is one legal execution, not a universal production ordering.
- `settles a promoted authored task through the real completion-claim boundary`
  checks promotion alone settles nothing; the exact A claim is replaced and
  deleted only after the declared fresh successful tracker read, producing one
  real settlement/reflection frame without claiming whole-Run termination.
- `maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact
  Run` checks the complete 402-item chronology, 15 activations, seven ordered
  settlements, two distinct Gfinal reads, and one Completed termination.
- `completes the uninterrupted seven-task run after reconciling A FullRerun
  predecessor cleanup` checks exact predecessor-only cleanup and ordinary
  finality for the seven settled tasks.
- `replays the maintained capstone with the same exact chronology` checks the
  fresh Run replay against the declared story, including sealed evidence.
- `shows the staggered double-diamond frontier being consumed on one graph` checks the
  same topology, waves, and recovered B/C correlations through the Lab's
  presentation model.
- The real-browser checkpoint drives that catalog option while it is Running,
  traverses the rendered frames, and checks the exact graph, frontier waves,
  and recovered middle-wave responsibilities. The manifest links all 22 beats
  to the maintained capstone while preserving the independent ten-task and
  narrower slice evidence; no unsupported beat remains.

<!-- DELIVERY-STORY-MANIFEST:START -->
cassette|authored:deliveryInvariantStory
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes a staggered graph while restart-added X waits for recovered capacity
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#preserves the double-diamond middle positions across coordinator restart
DS-01|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-02|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-03|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-04|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-05|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-06|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-07|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-08|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-09|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-10|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-11|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-12|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-13|DemonstratedByMaintainedSlice|controlled:issue268Ds01ThroughDs13,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#emits the exact DS01 through DS13 delivery checkpoint table,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#consumes exactly the accepted issue 268 occurrence inventory,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-14|DemonstratedByMaintainedSlice|authored:deliveryStoryDs14ThroughDs17,authored:acceptedResultRestartsIntoIntegration,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes the composed DS-14 through DS-17 path after every CAS-to-successor durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#accepts every DS-14 through DS-17 checkpoint prefix as valid history with at most one recorded successor, promotion, and completion attempt,packages/dalph/test/cassettes/scenario.test.ts#it.effect#continues an accepted result after process death and crosses its integration cutoff once,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-15|DemonstratedByMaintainedSlice|authored:deliveryStoryDs14ThroughDs17,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#rejects DS-15 evidence when M or M2 lacks exact ordered head-then-C parents,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes the composed DS-14 through DS-17 path after every CAS-to-successor durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#accepts every DS-14 through DS-17 checkpoint prefix as valid history with at most one recorded successor, promotion, and completion attempt,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-16|DemonstratedByMaintainedSlice|authored:deliveryStoryDs14ThroughDs17,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#rejects DS16 evidence without the rejected CAS attempt,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#fails immediately when an authored CAS response is replaced by another selection without fabricating provider ambiguity,packages/orchestrator/src/workflow/protocols/integration-quarantine/promotion-stale.test.ts#it.effect#rejects quarantine after a stale pre-request read or a missing compare-and-set intent,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes the composed DS-14 through DS-17 path after every CAS-to-successor durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#accepts every DS-14 through DS-17 checkpoint prefix as valid history with at most one recorded successor, promotion, and completion attempt,packages/orchestrator/src/workflow/protocols/integration-quarantine/promotion-stale.test.ts#it.effect#checks Git after losing the compare-and-set response and records at most one quarantine,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-17|DemonstratedByMaintainedSlice|authored:deliveryStoryDs14ThroughDs17,authored:ambiguousCompletionResponse,authored:deliveryInvariantStoryCapstone,integration-finality:restartAfterPromotionResumesCompletionSettlementWithoutAnotherIntegrationAgent,integration-finality:reconcilesALostCompletionClaimReplacementWithoutAllocatingAnotherClaim,integration-finality:doesNotMutateAForeignClaimWhileSettlingAPromotedTask,integration-finality:deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,integration-finality:reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes the composed DS-14 through DS-17 path after every CAS-to-successor durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes exact DS-17 finality after TargetPromotionObservedSuccess durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes exact DS-17 finality after CompletionClaimReplaced durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes exact DS-17 finality after CompletionTaskAcknowledged durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes exact DS-17 finality after CompletionClaimDeleted durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#resumes exact DS-17 finality after IntegrationFinalitySettled durable checkpoint,packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#accepts every DS-14 through DS-17 checkpoint prefix as valid history with at most one recorded successor, promotion, and completion attempt,packages/orchestrator/src/workflow/protocols/integration-quarantine/protocol.test.ts#it.effect#reconciles every ambiguous direction append outcome against the Journal winner,packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts#it.effect#rejects every missing or contradictory FullRerun predecessor fact before appending S2,packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts#it#rejects a FullRerun successor that reuses predecessor identities,packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts#it.effect#does not delete when the completion marker disappears or changes before the first delete,packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts#it.effect#recovers a recorded full rerun without creating a second successor,packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts#it#delivers the already-recorded FullRerun successor after restart,packages/dalph/test/cassettes/scenario.test.ts#it.effect#restart after promotion resumes completion settlement without another integration agent,packages/dalph/test/cassettes/scenario.test.ts#it.effect#reconciles a lost completion-claim replacement without allocating another claim,packages/dalph/test/cassettes/scenario.test.ts#it.effect#Dalph checks A after losing the tracker completion response,packages/dalph/test/cassettes/scenario.test.ts#it.effect#does not mutate a foreign claim while settling a promoted task,packages/dalph/test/cassettes/scenario.test.ts#it.effect#deletes only the exact completion claim after focused task success,packages/dalph/test/cassettes/scenario.test.ts#it.effect#reconciles a lost completion-claim deletion without reopening success,packages/dalph/test/cassettes/scenario.test.ts#it.effect#reconstructs and round-trips interrupted and settled completion-cleanup Run prefixes,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#replays the maintained capstone with the same exact chronology
DS-18|DemonstratedByMaintainedSlice|controlled:issue274LifecycleReopen,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts#it.effect#reopens C and resumes its original attempt only after accepted capacity three,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-19|DemonstratedByMaintainedSlice|controlled:issue274LifecycleReopen,controlled:issue274LostResumeResponse,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts#it.effect#reopens C and resumes its original attempt only after accepted capacity three,packages/dalph/test/cassettes/issue-274-lifecycle-resume.test.ts#it.effect#reconciles C's lost Resume response after restart without another Begin or Resume,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-20|DemonstratedByMaintainedSlice|controlled:issue275ActiveGraphRefresh,authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/issue-275-active-graph-refresh.test.ts#it.effect#observes F and G without admitting either while B C and D retain every exact position,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run
DS-21|DemonstratedByMaintainedSlice|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#replays the maintained capstone with the same exact chronology
DS-22|DemonstratedByMaintainedSlice|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup,packages/dalph/test/cassettes/issue-337-capstone.execution.test.ts#it.effect#replays the maintained capstone with the same exact chronology
<!-- DELIVERY-STORY-MANIFEST:END -->
