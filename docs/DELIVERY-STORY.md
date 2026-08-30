# One delivery story

One Run, told twice: as beats a person can follow, and as a state table that
makes each beat's arithmetic checkable. The story is chosen to touch as many of
`docs/DELIVERY-INVARIANTS.md` as one chronology can.

Both registers are prose. The maintained capstone
`authored:deliveryInvariantStoryCapstone` is one executable graph-and-restart
chronology: one real Run starts A, B, and C at capacity three, observes Alice's
B instruction edit, safely suspends and retains B, admits D, contracts capacity
to two, reconstructs A/C/D plus retained B, safely closes C, resumes B ahead of
unstarted E, and accepts A. It then records A's exact candidate parents
`[H,C]`, observes stale H2, durably quarantines that predecessor, applies
Alice's exact FullRerun direction, reads fresh H2, builds a distinct successor
candidate with parents `[H2,C]`, promotes it, and crosses completion finality.
The older `authored:deliveryInvariantStory` remains a separate historical
double-diamond cassette for existing Lab regressions. Neither cassette pretends
to execute beats DS18–DS22 below. The checked-in manifest maps every beat either
to exact maintained evidence or to an explicit implementation gap. Repository
tests fail when the document, manifest, catalog key, or cited evidence changes
without the others.

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

**4.** Before next asking B's executor to continue, Dalph re-reads the graph and
B's instructions. B is still open, still in the target closure, still exactly
claimed by Dalph, and its fingerprint has moved. Dalph asks B's executor to
safely suspend. B keeps its position meanwhile.

**5.** B's executor reports its work resumable with nothing still running.
Dalph releases B's position, preserves B's worktree and work in progress, and
shows Alice three choices for B: continue the existing attempt, restart the
implementation, or stop it. Both fingerprints travel with the choice.

**6.** With a position free, D is admitted — the next task in graph order — and
its executor begins.

**7.** Alice lowers capacity from three to two. Nobody is evicted: A, C and D
keep working. The new ceiling binds the next admission, not the current
holders.

**8.** Dalph dies.

**9.** Dalph restarts. It reconstructs A, C and D as held positions from
journal history, continuing those same three attempts rather than planning
replacements. B is still retained and still awaiting Alice. Capacity is two and
three positions are held, so nothing new is admitted.

**10.** Alice closes C in the tracker without success. `G₂`. Dalph records the
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
selects reconciliation rather than a force update. Dalph records the rejected
offer and one exact promotion-stale quarantine `Q` for A's Integrator session
`S`. `Q` preserves A's accepted result, claim, queue position, `S`, candidate,
isolated resource, Git qualification, and integration history. Only after `Q`
is durable does Dalph release the process-local integration-target position.
It creates no successor session automatically.

**17.** Alice chooses *Full rerun* for exact `(S, Q)`. Dalph records the first
valid `(S, Q, FullRerun)` direction and then records and performs a fresh target-
lineage read. Git reports compatible current head `H₂`. Dalph preserves `S` and
its resource as predecessor evidence, preserves A's same integration
responsibility and queue position, and fixes exactly one distinct successor
session `S₂` and isolated resource against `H₂`. Ordinary delivery gives `S₂`,
`H₂`, and A's immutable accepted result to the Integrator. The Integrator
reports candidate `M₂`; Dalph asks Git to prove exact ordered parents
`[H₂, C]`, then promotes only `M₂` by compare-and-set against `H₂`. The
physical integration-target position is released, but promotion does not
settle A. Dalph replaces A's exact active claim with a promotion-correlated
completion claim. A later focused tracker read reports A successfully
completed in `G₃` with that exact completion claim. Dalph rereads that exact
marker, releases the exact original active claim, then rereads the completion
marker and current active record to prove the release
still holds. Only then does it ask the tracker to delete the exact completion
marker. After the tracker reports that marker absent, Dalph rereads the current
active record once more and sees it still absent. Dalph records the marker
deleted, records A's delivery settlement, and removes A's retained
integration-completion responsibility.

**18.** Alice reopens C. `G₄`. Only the lifecycle wait clears; every other fact
must independently authorize resumption. C needs a position and none is free.

**19.** Alice raises capacity back to three. C is admitted and resumes its
original attempt.

**20.** Alice adds two tasks, F and G, to the tracker, both inside the target
closure. `G₅`. Dalph's next complete read finds them eligible, and they wait for
capacity behind the three tasks already running.

**21.** B, C and D report accepted results in turn. Each task releases its
task-work position, passes through the same outer Integrator, Git qualification,
promotion, completion-claim replacement, focused task-completion success,
claim-deletion, and delivery-settlement protocol as A, and then admits one of
E, F, G in graph order.

**22.** E, F and G report accepted results and each passes through that same
production integration and completion-finality protocol. A later complete
tracker read reports all seven tasks in `G₅` successfully complete with no
claim left to clean up. No action is executable and no obligation is
outstanding, so the coordinator returns `RunMayTerminate` and the Run may
record normal termination.

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
| 8 | process loss | G₁ | 2 | — | — | — | D29 D30 |
| 9 | restart | G₁ | 2 | A C D | B | B | **D31 D1 D3** |
| 10 | C closed, asked to suspend | G₂ | 2 | A C D | B | B | D18 D24 |
| 11 | C safely suspended | G₂ | 2 | A D | B C | B | D10 D12 D16 |
| 12 | Alice continues B | G₂ | 2 | A D | B C | — | D15 D20 |
| 13 | A accepted; B admitted | G₂ | 2 | B D | A C | — | D10 D24 |
| 14 | A queued for integration | G₂ | 2 | B D | A C | — | D10 |
| 15 | Integrator reports candidate; Dalph proves its parents | G₂ | 2 | B D | A C | — | **D26 D28** |
| 16 | rejected promotion quarantines exact S; no successor starts | G₂ | 2 | B D | A C | A | **D27 D44** |
| 17 | Alice authorizes FullRerun; exact S₂ promotes; focused success leads to exact active-claim release, marker/active rereads, marker deletion last, absence proof, and settlement | G₃ | 2 | B D | C | — | D24 D27 D28 D33 D44 |
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

Three beats open branches that have no terminal path under current rules.

**Beat 5, if Alice never chooses.** B stays retained with its work preserved
and its position released. The Run keeps an unsettled obligation, so it must
remain active. Nothing times out and nothing decides on her behalf.

**Beat 11, if Alice never reopens C.** A task closed without success derives a
*reversible* wait, and the only thing that clears it is a later complete read
showing the task open again. There is no operator choice for this case: the
three choices at beat 5 belong to changed instructions, not to a closed task.
So a task that Alice closes and leaves closed keeps its attempt retained
forever, and the Run cannot reach beat 22.

**Beat 17, if Alice never chooses Full rerun.** A remains retained at its
promotion-stale quarantine with `S`, `M`, the accepted result, queue position,
claim, resource, and evidence preserved. The process-local target position is
free, but later work for the same target cannot pass A. Dalph does not choose
for Alice, retry `S`, or create `S₂`, so the Run cannot reach beat 22.

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

The maintained catalog key is `authored:deliveryInvariantStoryCapstone`. Its
source manifest names this document and all 22 beat numbers; this document names
the same key. Every demonstrated manifest row names the exact registered
acceptance test that checks its evidence; a catalog key by itself is not proof.
`keeps every delivery-story beat linked to maintained evidence or an explicit
implementation gap` checks both directions, exact catalog keys, exact test
declarations, and the byte-for-byte manifest block.

The supplemental `authored:deliveryInvariantStory` chronology retains its
restart-focused checks. `consumes a staggered graph while restart-added X waits
for recovered capacity` proves the exact topology, eligible waves, recovered
capacity ordering, held-position sequence, and ten accepted-result settlements.
`preserves the double-diamond middle positions across coordinator restart`
proves B and C retain the same Run and Attempt identities while X waits.

`executes DS01 through DS13
in one maintained chronology` runs the capacity, suspension, retention, restart,
and admission prefix through `runAuthoredScenarioCassette`; `executes DS-14
through DS-17 from rejected exact-head offer through Operator-authorized
successor finality` checks the exact stale-head, FullRerun, successor, and
finality fields. For DS-17 it directly checks focused success, the exact
original active-claim release, the ordered marker and active-record rereads,
the marker deletion attempt after those rereads, marker absence followed by a
fresh active-record absence check, and settlement last.

The highest-seam cassette is supplemented by existing protocol and
conformance evidence for the required forbidden outcomes:

- swapped or extra candidate parents: `rejects changed ordered parents before a candidate can become a promotion correlation` in `packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts`;
- omitted, foreign, duplicate, or out-of-order FullRerun chronology: `accepts only one exact FullRerun successor and rejects absent, duplicate, or foreign successors` and `rejects duplicate, foreign, and out-of-order exact run facts` in `packages/orchestrator/src/workflow/protocols/integrator/reconstruction.test.ts`;
- reused predecessor session or resource: `rejects a FullRerun successor that reuses predecessor identities` in `packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts`;
- foreign completion claim: `rejects every cleanup and settlement occurrence whose success binds a different same-task claim` in `packages/orchestrator/src/workflow/protocols/integration-finality/history.test.ts`;
- restart from only the recorded direction: `restarts from only Alice's FullRerun direction, reads fresh Git once, and fixes one successor in both stores` in `packages/dalph/test/conformance/restart-prefix-acceptance-matrix.test.ts` reconstructs memory and SQLite prefixes, waits for current tracker and claim facts, records Git intent before one fresh read and its observation, fixes one exact `(S, Q, D, L)` successor, and performs no Integrator delivery;
- restart after successor fixation: `delivers the already-recorded FullRerun successor after restart` and `accepts a deterministic FullRerun successor only after its quarantine, direction, and fresh lineage` in `packages/orchestrator/src/coordination/frontier/integration-frontier-transitions.test.ts` and `packages/orchestrator/src/workflow/protocols/integrator/reconstruction.test.ts`.

The accepted-result conformance adapter also exercises `observeWrongParentCandidateOne`,
`redeliverFullRerunOne`, `rejectConflictingFullRerunOne`, and
`startFullRerunOne` against the collected `acceptedResultIntegration.qnt`
laws. Its directed exact-head scenario additionally executes
`reconcilePromotionReadOnlyOne` and `resumePromotionRetryWithAuthorityOne`,
preserving the durable deferral through restart and unrelated history while
another compare-and-set remains forbidden. These are negative and
restart-prefix evidence, not substitutes for the maintained DS-14–DS-17
cassette chronology.

<!-- DELIVERY-STORY-MANIFEST:START -->
cassette|authored:deliveryInvariantStoryCapstone
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality
cassette-test|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#rejects DS16 evidence without the rejected CAS attempt or with a pre-request stale read
DS-01|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-02|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-03|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-04|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-05|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-06|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-07|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-08|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-09|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-10|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-11|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-12|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-13|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS01 through DS13 in one maintained chronology
DS-14|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality
DS-15|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality
DS-16|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality
DS-17|DemonstratedBySpine|authored:deliveryInvariantStoryCapstone|packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts#it.effect#executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality
DS-18|NotImplemented|No maintained run reopens a tracker lifecycle wait for C; Operator task Unpause is a different phenomenon.
DS-19|NotImplemented|No maintained run combines the retained C attempt with a later capacity increase.
DS-20|NotImplemented|The maintained staggered graph adds X during process loss and delays it behind reconstructed B/C positions; it does not add F and G behind three running tasks.
DS-21|NotImplemented|No maintained authored run finalizes B, C, and D and admits E, F, and G in one chronology.
DS-22|NotImplemented|The maintained staggered ten-task cassette finalizes all ten accepted results and terminates, but it is not the prose beat's seven-task G5 chronology for E, F, and G.
<!-- DELIVERY-STORY-MANIFEST:END -->
