# Run the target repository's selected verification

Issue: [#59 Run target-selected verification](https://github.com/dearlordylord/dalph/issues/59)

Status: accepted on 2026-08-08 as the chronological elaboration of issue #59's
provider-neutral, repository-selected verification requirement.

No person directly starts these scenarios. The running Dalph coordinator acts
after Git has proved an exact integration candidate. A maintainer can observe
the recorded result and whether the task advances. Git owns commits, refs, and
candidate ancestry. The target repository's public verification wrapper owns
the commands it runs and its heavy-verification lock. Dalph owns the order of
its journal records, its process-local integration-target position, and the
evidence it accepts before promotion.

## How the repository-selected plan is fixed

Configuration selects one opaque public verification plan for the exact
repository/ref target. Dalph records that selection in the verification intent
before the wrapper starts, so recovery cannot silently run a different plan.
Dalph does not inspect package scripts, invent commands, ask the wrapper to
choose after the intent, or call a private command. This keeps plan selection a
configuration fact and permits intent-before-effect without adding a second
selection protocol.

## A passing wrapper result authorizes only the exact candidate it checked

### Starting situation

Run R has one accepted task result. Git previously reported target head H and
proved candidate M has exactly the ordered direct parents `[H, C]`. Dalph's
journal contains the exact `IntegrationCandidateConstructed` occurrence with
M, its full candidate correlation, and its journal position. No later complete
tracker or Git observation has introduced a dependency or lineage constraint.
The process has reconstructed no integration-target ownership after restart.
The configured public verification plan for the target is P.

### Trigger and chronological behavior

1. Dalph freshly confirms the tracker and Git facts required by the ordinary
   integration frontier, then acquires the process-local position for M's
   exact repository/ref target. Same-target work waits; work for another
   target remains independently eligible.
2. Dalph derives verification request V from the exact candidate identity and
   records an intent that fixes R,
   M, the complete candidate correlation, the exact constructed-occurrence
   position, target, and plan P.
3. Dalph asks the repository verification boundary to run or resume V for M
   under P. That one public wrapper waits for, acquires, and releases its own
   heavy-verification lock. Dalph neither acquires that lock separately nor
   calls a guarded command from inside another guarded command.
4. The wrapper reports that P completed successfully for exact M and returns
   its complete evidence objects.
5. Dalph stores the complete objects by content, writes a deterministic
   manifest that links to the constructed-candidate occurrence, and rereads
   every referenced object and the manifest bytes.
6. Only after those reads succeed does Dalph record that exact M has sealed
   passing verification evidence. It releases the process-local target
   position when the action settles.
7. The later promotion frontier may offer M to Git. This issue does not mutate
   the target ref.

The maintainer can see that exact M passed P and may advance to promotion.
Dalph must not classify the process exit alone, a clean worktree, a different
commit, an unverified manifest reference, or the newest candidate as verified.
It must not run a private command, bypass the wrapper's lock, hold two
same-target lifecycle positions, or promote M in this issue.

### Crash and retry

If Dalph crashes before step 2, restart derives the same V only after current
tracker and Git facts permit verification. If it crashes after step 2, restart
reuses V and asks the verification boundary to run or resume that exact
request. If it crashes after the wrapper finished but before step 6, the
boundary returns V's existing result; content-addressed writes reproduce the
same object and manifest identities. Dalph does not start a second wrapper run.
Process-local target and heavy-lock ownership are never reconstructed from the
journal.

### Acceptance tests and model checks

- `runs only the selected public wrapper and seals passing evidence for exact M`
  (maintained cassette and protocol test)
- `restart rereads the exact target head before offering candidate verification`
  (recovered production-shaped relation and real journal)
- `selectedWrapperSealsPassedEvidenceForExactCandidateTest`
- `candidateReadyRestartReconstructsNoTargetLeaseTest`
- `reacquisitionWaitsForFreshMatchingTargetHeadTest`

## A completed failed, killed, partial, or timed-out wrapper run cannot advance

### Starting situation

The facts through the recorded verification intent for V are the same as in
the passing scenario. The wrapper owns any process it started and its
heavy-verification lock.

### Trigger and chronological behavior

1. Dalph asks the same public wrapper to run or resume V for M.
2. The wrapper returns one exact terminal result: its checks failed, its
   process was killed, it could produce only a partial result, or its
   configured time limit elapsed. Any complete or partial diagnostic objects
   are identified separately from passing evidence.
3. Dalph stores and rereads the available diagnostic objects and a manifest
   that states the exact non-passing result. Missing objects remain missing;
   Dalph does not substitute empty bytes or a success-shaped reference.
4. Dalph records the non-passing result for V, preserves M, its candidate
   resource, its integration session, its accepted result, and its journal
   evidence, and releases process-local resources.
5. The exact lifecycle stops without promotion or an automatic replacement
   verification request. A later explicit recovery issue may decide whether
   to resume, replace, or quarantine it; #59 neither returns work to an agent
   nor consumes #58's review loop.

The maintainer sees the exact failed, killed, partial, or timed-out result and no
promotion. Dalph must not treat partial diagnostics as a passing manifest,
silently retry unchanged work, delete M, release the task claim, or allow later
same-target work to pass the unresolved logical queue position.

A Dalph process crash does not change the result. Restart reuses V to reconcile
the wrapper result and records it at most once. A killed wrapper process is an
observed terminal result, not evidence that no invocation occurred.

### Acceptance tests and model checks

- `preserves exact M and stops before promotion when selected checks fail`
- `seals failed killed partial and timed-out diagnostics without passing evidence`
- `failedVerificationStopsBeforePromotionAndBlocksLaterQueueTest`
- `killedVerificationSealsDiagnosticsWithoutPromotionTest`
- `timedOutVerificationSealsDiagnosticsWithoutPromotionTest`
- `partialVerificationSealsDiagnosticsWithoutPromotionTest`
- `completedNonPassCannotAllocateReplacementRequestTest`

## A lost wrapper response is reconciled before another invocation

### Starting situation

Dalph recorded intent V and acquired the process-local target position. The
public wrapper has a request record keyed by V. No wrapper result is present in
the Dalph journal.

### Trigger and chronological behavior

1. Dalph asks the public wrapper to run or resume V.
2. The wrapper begins or completes its guarded checks, but Dalph loses the
   response or crashes before recording the result.
3. Restart reconstructs the unresolved intent and no process-local resource
   ownership. After current tracker and Git facts still permit the lifecycle,
   Dalph reacquires the target position and asks the wrapper about the same V.
4. If the wrapper has a settled result, it returns that result without running
   the checks again. Dalph records and handles it exactly as the passing or
   non-passing scenario above.
5. If the wrapper proves V never began, it may begin that same V once. If it
   cannot prove either an existing result or absence, Dalph stops with a typed
   boundary failure and does not guess.

The maintainer sees one eventual result or an explicit wait/failure, never two
verification runs whose results race. Dalph must not allocate a replacement V
to escape uncertainty, infer failure from a lost response, infer success from
artifacts alone, or loop internally on an unavailable wrapper.

### Acceptance tests and model checks

- `reconciles a lost verification response by the same request identity`
- `lostVerificationResponseReconcilesSameRequestAfterRestartTest`
- `verificationInvocationAndReconciliationAreBounded`
- `verificationRequestIdentityIsStable`

## Waiting for the repository's heavy lock does not create Dalph lock ownership

### Starting situation

M is ready for verification and Dalph holds M's process-local integration-target
position. Another process is using the repository's heavy-verification lock.
An accepted result for another repository/ref target is independently ready.

### Trigger and chronological behavior

1. Dalph invokes the public wrapper for V. The wrapper reports or internally
   observes that it is waiting for its heavy-verification lock.
2. Dalph does not call a separate lock-acquire operation and does not invoke an
   inner guarded command. The wrapper eventually acquires its lock, runs P,
   releases the lock, and returns one terminal result.
3. Dalph retains M's exact target position during the active call. The other
   target may proceed under its own position; later work for M's target may
   not pass M.
4. If Dalph is interrupted, the wrapper contract owns interruption and lock
   release. Restart reconstructs neither lock nor target ownership and
   reconciles V as described above.

There is no person-specific lock action. A maintainer may observe waiting or
interruption diagnostics supplied by the wrapper. Dalph must not persist a
derived lock row, claim it owns the repository lock, bypass the public wrapper,
or serialize unrelated targets behind M.

### Acceptance tests and model checks

- `runs only the selected public wrapper and seals passing evidence for exact M`
  (the fake-provider boundary exposes only `runOrResume`; there is no Dalph
  heavy-lock call to author or record)
- `keeps another target usable while exact M verifies and releases only M's target when it settles`
  (the production resource controller holds T1 during the suspended wrapper
  call, admits T2, rejects a later T1 owner, and releases only T1 afterward)
- `candidateReadyRestartReconstructsNoTargetLeaseTest`
- `activeVerificationRetainsTargetUnlessRestarted`
- `logicalIntegrationResponsibilityBlocksLaterQueue`

## Foreign or incomplete evidence fails closed

### Starting situation

Intent V fixes M, candidate correlation K, constructed-occurrence position J,
target T, and plan P. The verification boundary or evidence store instead
returns a result for another candidate, correlation, request, target, plan, or
manifest bytes that do not match their content address.

### Trigger and chronological behavior

1. Dalph compares the returned identity with the complete intent before
   accepting any result.
2. For a mismatch, Dalph records no passing verification occurrence. For a
   missing or corrupt evidence object, Dalph records no sealed passing
   manifest.
3. Dalph preserves M and its history, releases process-local resources, and
   stops the exact lifecycle with a typed contradiction or evidence failure.

The maintainer sees an explicit verification/evidence failure and no
promotion. Dalph must not compare only M, only V, or only a digest; repair
foreign evidence; choose the newest result; or manufacture a complete
manifest from partial objects.

Crashing and reopening cannot turn the mismatch into success because the
intent and accepted journal records remain exact. Retrying uses the same V and
must receive a completely matching result.

### Acceptance tests and model checks

- `records a contradiction and fails closed for a foreign wrapper result`
- `records and alpha-renames verification terminal and contradiction occurrences`
- `fails closed when referenced evidence cannot be reread`
- `fails with a typed read failure for an absent or corrupt object`
- `foreignVerificationCorrelationFailsClosedTest`
- `incompleteVerificationEvidenceFailsClosedTest`
