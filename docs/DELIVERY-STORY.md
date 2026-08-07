# One delivery story

One Run, told twice: as beats a person can follow, and as a state table that
makes each beat's arithmetic checkable. The story is chosen to touch as many of
`docs/DELIVERY-INVARIANTS.md` as one chronology can.

Both registers are prose. The executable register is a cassette — one long
recorded Run covering this whole chronology — and the beats and the table are
written to become its script. A model run over the same chronology is the
cheaper intermediate, useful for proving each beat is reachable before the
cassette is recorded.

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

**15.** Dalph builds A's integration candidate with exactly two ordered parents:
the expected target head first, the immutable accepted result second.

**16.** Dalph offers the candidate by compare-and-set against that exact
expected head. The head has moved. The offer does not apply, and the stale head
selects reconciliation rather than a force update.

**17.** Dalph re-reads the target head, rebuilds the candidate against it, and
promotes. A settles, and its integration target is released.

**18.** Alice reopens C. `G₃`. Only the lifecycle wait clears; every other fact
must independently authorize resumption. C needs a position and none is free.

**19.** Alice raises capacity back to three. C is admitted and resumes its
original attempt.

**20.** Alice adds two tasks, F and G, to the tracker, both inside the target
closure. `G₄`. Dalph's next complete read finds them eligible, and they wait for
capacity behind the three tasks already running.

**21.** B, C and D settle in turn. Each released position admits one of E, F, G
in graph order.

**22.** The last executor reports, its result is integrated and promoted, and
every task in the closure is successfully complete. No action is executable and
no obligation is outstanding, so the Run may terminate.

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
| 15 | candidate built | G₂ | 2 | B D | A C | — | **D26** |
| 16 | promotion finds a stale head | G₂ | 2 | B D | A C | — | **D27** |
| 17 | reconciled and promoted; A settles | G₂ | 2 | B D | C | — | D27 D28 D33 |
| 18 | C reopened | G₃ | 2 | B D | C | — | D9 D19 |
| 19 | capacity 2 → 3; C admitted | G₃ | 3 | B C D | — | — | D6 D13 |
| 20 | F and G added | G₄ | 3 | B C D | — | — | D7 D9 |
| 21 | B C D settle; E F G admitted | G₄ | 3 | E F G | B C D | — | D6 D33 |
| 22 | all complete | G₄ | 3 | — | — | — | **D34 D35** |

Held plus retained is the whole of what Dalph owes at any row, and the rule is
load-bearing: an accepted result is an obligation before it is integrated, so a
task appears in Retained from the moment its executor reports until its
promotion settles it. That is why A is retained at rows 13 and 14, and why B, C
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
