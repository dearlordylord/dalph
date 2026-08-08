# Promote one verified candidate or reconcile Git

Issue: [#60 Compare-and-set promote or reconcile a stale accepted head](https://github.com/dearlordylord/dalph/issues/60)

Status: accepted on 2026-08-08 after the operator selected at most three total
automatic compare-and-set attempts for one exact verified candidate.

No person directly starts these actions. The running Dalph coordinator acts
after the target repository's public verification wrapper has returned passing
evidence and Dalph has reread and sealed it. A maintainer can observe the
recorded Git result, a stale-head wait, or exhausted ambiguity. Git owns commits,
refs, ancestry, and the atomic ref update. Dalph owns the order of its journal
records and its process-local integration-target position.

Issue #60 changes only the target ref and records its exact result. Issue #61
later asks the tracker to complete the task, and issue #141 owns the remaining
claim and responsibility settlement.

## Git accepts the exact `H` to `M` compare-and-set

### Starting situation

Run R contains an unsettled integration responsibility for task A. Git proved
candidate M has exactly two ordered direct parents `[H, C]`, where H was the
target head used to construct M and C is A's immutable accepted result. The
journal contains M's exact constructed-candidate occurrence and passing target
verification manifest E. A current complete tracker read reports no unfinished
prerequisite for A, and a current Git read still reports target head H. No
promotion intent or result exists.

### Trigger and chronological behavior

1. Dalph acquires the process-local position for the exact repository/ref
   target. Work for the same target waits; another target remains independently
   eligible.
2. Dalph derives one promotion request P from R, M's complete candidate
   correlation and constructed position, expected head H, target, and sealed
   verification manifest E. It records P's intent and waits for the journal
   append before asking Git to change the ref.
3. After the intent append completes, Dalph reads the exact target ref and M's
   ancestry once more. Only a complete result that still reports exact H can
   authorize the first compare-and-set.
4. Dalph asks Git to atomically replace H with M only if the ref still equals H.
   Git applies that exact compare-and-set and reports M as the new head.
5. Dalph records that exact M was promoted from H, including M's ordered parent
   binding and E. It releases the process-local target position when the action
   settles.
6. Dalph does not mark A complete in the tracker. The durable started
   integration responsibility and promotion proof remain for #61 and #141.

The maintainer sees M on the target ref and one durable promotion proof. Dalph
must not force-update, reset, offer a different commit, accept equivalent file
content, omit E, complete A, or let a later same-target responsibility pass the
unsettled lifecycle.

If Dalph crashes before step 2, restart derives P only from current tracker and
Git facts. If it crashes after step 2 but before step 3, restart rereads Git
before sending P. If it crashes after Git applies M but before step 5, restart
discovers exact M ancestry as described below and records the same promotion;
it does not require a second ref update.

### Acceptance tests and model checks

- `promotes exact M once and records its sealed evidence and ancestry`
- `promotes verified M by exact compare-and-set and records exact ancestry`
- `exactCompareAndSetPromotionRecordsSealedEvidenceTest`
- executable accepted-result integration MBT promotion actions

## Another integration advances the target before the request

### Starting situation

The candidate and verification facts are the same, but another human or task
legitimately advances the target from H to H2 before Dalph's required
post-intent Git read. H2 may even have the same file content as M; it is not the
exact commit M and does not have to contain M in its ancestry.

### Trigger and chronological behavior

1. Dalph records the same exact intent P and waits for that append to complete.
2. Dalph reads the target ref and M ancestry. Git returns current head H2 and
   proves that H2 does not contain M.
3. Dalph sends no compare-and-set. It records the stale result, preserves M, C,
   E, the candidate resource,
   and integration history, and releases the process-local target position.
4. The reconciliation accepted in issue #138 explicitly supersedes this
   H-bound integration session before one successor session can build and
   verify a new candidate against a freshly observed target head. Issue #60 does
   not rewrite M's parents or silently substitute H2.

The maintainer can see both expected H and observed H2, and the recorded facts
are sufficient for a later warning that another actor advanced the target.
Dalph must not overwrite H2, treat equal trees or patches as exact ancestry,
reuse E for a replacement candidate, or run an automatic force/update/reset
fallback.

A crash after Git returns H2 but before Dalph records it leaves P unresolved.
Restart rereads Git. H2 selects the same stale-candidate reconciliation and no
`H -> M` request is sent. If the post-intent read first returned exact H but a
human advanced the ref before the atomic request, Git instead rejects that
request with observed H2; Dalph records the same stale disposition and does not
retry without another fresh read.

### Acceptance tests and model checks

- `records stale H2 and never overwrites it`
- `rejects equivalent content without exact M ancestry`
- `staleTargetSelectsCandidateReconciliationTest`
- properties `promotionRequiresExactExpectedHead` and
  `staleTargetNeverOverwrites`

## A lost response is reconciled from current Git ancestry

### Starting situation

Dalph has durably recorded P and asked Git for `H -> M`. Git may have applied
the request, but the network response is lost and no promotion result is in the
journal. Dalph may then crash. Process-local target ownership is not durable.

### Trigger and chronological behavior

1. Before sending another compare-and-set, Dalph reads the exact target ref and
   asks Git whether M is the current head or an ancestor of it.
2. If Git reports M, Dalph records the exact promotion proof and E without
   another update request.
3. If Git reports a later head H2 and proves M is its ancestor, Dalph records
   that M was promoted and that the target legitimately advanced afterward.
   This remains exact ancestry even if another human or task performed one of
   the advances.
4. If Git reports a different head that does not contain M, Dalph records the
   stale result and follows the stale scenario above.
5. Before the third attempt, if Git cannot return a complete readable head and
   ancestry result, Dalph preserves P, M, and E, releases the physical target
   position when the action settles, and sends no compare-and-set. After an
   ambiguous third attempt, the same unreadable result establishes the bounded
   non-convergence outcome described below instead of beginning an unbounded
   read loop.

The maintainer sees one discovered promotion, one stale result, or an explicit
Git-read wait/failure. Dalph must not infer success from content equivalence,
infer failure from the lost response, use a journal row as Git authority, or
send an update before the read completes.

Repeated restart applies the same chronology. Once exact promotion is recorded,
no later activation repeats P even if the target advances again.

### Acceptance tests and model checks

- `discovers M in current target ancestry after losing the promotion response`
- `waits without another request when Git cannot be read`
- `restart reconciles promotion intent before another compare-and-set`
- `lostResponseDiscoversExactPromotedAncestryTest`
- `ambiguousPromotionNeverRetriesBeforeFreshGitTest`

## Git still reports `H`, so Dalph retries at most twice

### Starting situation

The first compare-and-set response was lost. A complete Git read proves the
target still equals H and therefore M is not currently promoted. P, M, and E
remain exact and unchanged.

### Trigger and chronological behavior

1. Dalph records the fresh exact-H observation and sends attempt 2 of the same
   `H -> M` request P. It does not allocate a replacement request or candidate.
2. If the second response is also lost, Dalph again reads Git. Only another
   complete exact-H result permits attempt 3.
3. If attempt 3 succeeds or a later read proves M ancestry, Dalph records the
   promotion as in the success scenario.
4. If attempt 3 remains ambiguous, Dalph performs one final reconciliation
   read. Exact M ancestry records success and a different readable head records
   stale reconciliation. Exact H or an unreadable result records promotion
   non-convergence at the three-attempt limit. Dalph preserves M, C, E, the
   candidate resource, session, and journal history, releases the process-local
   target position, and sends no fourth request.

The maintainer sees eventual exact promotion, stale reconciliation, a Git-read
wait, or typed three-attempt non-convergence. Dalph must not loop forever,
silently raise the limit on restart, count reads as update attempts, send two
updates without an intervening read, or discard verified work at exhaustion.

Crash recovery reconstructs the consumed request ordinals from durable
promotion-attempt intents written before each possibly ambiguous Git call. A
restart after attempt 2 may send only attempt 3 and only after
the required fresh exact-H observation. A restart after exhaustion sends none.

### Acceptance tests and model checks

- `retries only after H is freshly observed and stops after three ambiguous attempts`
- `reconciles a lost promotion response and never sends a fourth request`
- `promotionAmbiguityExhaustionPreservesVerifiedCandidateTest`
- `promotionAttemptCountSurvivesRestartTest`
- invariants `promotionAttemptsAreBounded` and
  `ambiguousPromotionRequiresFreshObservation`
- a negative control that sends attempt 4 and must violate
  `promotionAttemptsAreBounded`

## Waiting on one target does not serialize another target

### Starting situation

M's exact target T1 is in a compare-and-set call or waiting for the Git reread
required after an ambiguous response. A separately verified candidate for T2
is ready. The targets have distinct repository/ref locators.

### Trigger and chronological behavior

1. Dalph retains or reacquires only T1's process-local position for the exact
   active boundary call.
2. T2 acquires its own position and may run its compare-and-set protocol while
   T1 waits.
3. Success, stale result, unreadable Git, or exhausted ambiguity releases only
   the position for the action that settled. Durable logical responsibilities
   remain target-scoped.

There is no person-specific concurrency action. A maintainer may observe T2
advance while T1 waits. Dalph must not use one global promotion lock, release
T2 when T1 settles, or admit later T1 work past M.

### Acceptance tests and model checks

- `keeps another target usable while M promotion waits and releases only M when it settles`
- production integration-target controller assertions for exact T1/T2 release

## Scenario-to-invariant mapping

| Forbidden result | Durable invariant |
|---|---|
| Update a ref without intent, or retry before reading Git | D21 intent before ambiguity-crossing effects; D22 reconcile before retry |
| Force, reset, rewrite, reuse M against H2, or accept equivalent content | D26 exact candidate shape; D27 exact-head compare-and-set promotion |
| Promote without exact sealed passing evidence | D28 verification before promotion |
| Treat unreadable Git as absence or permission | D23 incomplete and unreadable facts never prove absence |
| Lose M, E, session, or resources on ambiguity/exhaustion | D10 retention; D16 work-in-progress survival; D31 same-work recovery |
| Persist or restore a process-local target position | D29 authority separation; D30 crash is absence |
