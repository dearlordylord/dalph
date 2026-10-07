# Publication grant batch/finality exhaustive proof

TLC completed the publication-grant batch/finality graph with all 19 required
invariants. [Issue #408](https://github.com/dearlordylord/dalph/issues/408) closes
the previously unproved exhaustive leg of #386. Scoped checks and both review
axes are closed; full submission aggregate qualification remains unproven.

Planned Base and Git HEAD during model checks:
`85998bcfe55269df19b518b0154f202fda59e63c`. Exact worktree:
`/workspace/typescript/dalph-408-exhaustive`. The [retained result](evidence/issue-408-exhaustive-results.json)
binds the canonical/projection/test source bytes, CLI arguments, terminal
verdicts, and verbatim backend logs. It establishes focused model proof; no full
candidate gate or hosted CI success is claimed.

## Cause and repair

The model's `recordExactCleanup` stayed enabled after `cleanupComplete` became
true. Every repeat incremented `qForwardEffectOrdinal`, so the reachable graph
was infinite despite bounded identities, grants, sessions, pushes and activations.
This contradicts the historical issue diagnosis of a merely large finite graph.

The canonical model and both copied projections now require
`not(state.cleanupComplete)` before recording cleanup. The action represents an
observed completed cleanup, so repeating it after that observation is not an
uncertain-outcome retry. The original proof → promotion → permission → completion
→ cleanup → settlement path remains enabled. The new
`exactCleanupCannotRepeatBeforeSettlementTest` reaches its actual cleanup boundary
and rejects another cleanup; removing the guard makes that same collected test
fail. No artificial ordinal bound, depth limit, branch split or reduced invariant
list was introduced.

This changes verification models and their required command inventory. No task
workflow operation, Git/tracker call, durable journal record, publication retry,
production cleanup action or visible Dalph delivery outcome changes. The generated
application inventory changes only the qualification validator's required formal
command count and shard positions.

## Accepted paths and interleavings

The [accepted publication scenario](scenarios/direct-remote-publication.md) still
owns S4/S5/S7/S8. Both projections retain their real-exhaustion prelude, full
invariant list and reachable negative controls. Batch/finality retains every
previous transition; its existing different-request replay stutter and associated
equivalence tests are unchanged. No new commutation omission needs justification.
The [projection contract](../scripts/quint-publication-batch-grant-projection-contract.mjs)
checks copied action bodies, selectors, stutter dependencies, invariant owners and
command bindings.

The following tests are collected in
[the batch/finality suite](../specs/directPublicationBatchGrant_batch_finality_proof_test.qnt).
The complete exhaustive graph includes the same chronological boundaries and
all their enabled orderings.

| Accepted chronology / required boundary | Direct collected path evidence |
| --- | --- |
| S4: third-session or third-push exhaustion, exact grant and unchanged cumulative ordinals | `thirdSessionExhaustionRetainsExactCauseWithoutPushIntentTest`; `thirdPushIntentExhaustionCanBeGrantedWithoutAnotherSessionTest`; `nextExactExhaustionRequiresFreshGrantWithoutResettingOrdinalsTest` |
| S4/S7: Pause allows the control receipt but defers Q's forward effects until Unpause | `recordsExactPausedGrantAndDefersOneBoundedBatchUntilUnpauseTest` |
| S5: crash before append; committed receipt before acknowledgement; replay before acknowledgement | `crashBeforeAppendRetriesExactOccurrenceWithoutGrantTest`; `committedGrantRecoversAfterLostAcknowledgementWithoutSecondBatchTest`; `exactGrantReplayBeforeAcknowledgementEnablesOneBatchTest` |
| S5: crash after session fixation or committed push intent retains the exact original session/ordinal | `crashAfterSessionFixationResumesSameSessionWithoutRepetitionTest`; `crashAfterCommittedGrantIntentReconcilesOriginalOrdinalTest` |
| S4/S5: exact replay is idempotent; a different request cannot create another grant | `sameRequestReplayIsExactAndDifferentRequestCannotMintAnotherGrantTest`; `batchFinalityStuttersDifferentRequestReplayTest`; `batchFinalityDifferentReplayThenUnrelatedProgressTest` |
| S7: Exit races with receipt append; committed receipt survives without forward batch work | `exitBeforeAppendRejectsGrantAndExitAfterCommitRetainsReceiptTest`; `committedGrantSurvivesExitWithoutStartingBatchTest` |
| S8: all four selectors compete at the same `GrantBatchReady` state | `exactPublicationProofAndFinalityRequireFreshBoundariesTest`; `safelyReusableCandidateUsesPushWithoutNewSessionTest`; `sameCommitSuccessorUsesOneTaskAttemptAndExactParentsTest`; `blockedPostUnpauseConstraintRetainsPreciseWaitTest` |
| S8: later sessions retain parent/candidate evidence; blocked waits preserve the selected path; unresolved push resolution remains distinct from exact proof | `laterSuccessorSessionRetainsPreviouslyRecordedExactParentsTest`; `alreadyPublishedReconciliationCannotReplaceStartedSuccessorSessionTest`; `blockedWaitOverlaysWithoutErasingStartedSuccessorPathTest`; `reusableCandidatePathDoesNotStartAThirdSessionAfterAnUnappliedPushTest` |
| S8: proof precedes promotion/current permission/completion; exact cleanup precedes settlement and termination | `exactPublicationProofAndFinalityRequireFreshBoundariesTest`; `exactCleanupCannotRepeatBeforeSettlementTest` |

The full graph also keeps unrelated-responsibility progress, lifecycle changes,
append versus crash/Exit, selector races, resolution versus proof, and second
occurrence retention versus later work jointly enabled. Existing reachable
mutation suites still falsify every owned invariant; their bodies were unchanged.
This establishes scoped safety and explicit reachability, not temporal progress or
new production/provider acceptance evidence.

## Required profile and measured cost

The effective profile now requires one TLC batch/finality exhaustive command
alongside its deterministic, negative and sampled commands. It uses all 19
invariants and has no `--max-steps`. The independent command oracle, canonical
manifest, hosted family ranges, generated qualification inventory and profile
fingerprint were updated together: 147 commands, including 28 exhaustive commands.
The added command occupies position 127 in the existing publication-grant family;
later positions shift by one. Later deterministic seeds follow their established
position-derived rule; existing sampled seeds, depths, samples and witnesses stay
unchanged.

The new command addresses the exact missing #408 proof; deterministic and sampled
checks cannot supply this evidence. It adds one exhaustive exploration per selected
formal qualification, replacing the deferred leg rather than adding repeated
sampling. Locally the checker took 441,887 ms. Hosted timing is unmeasured, and the
existing finite hosted deadline/budget policy is unchanged.

| Scope | Terminal exhaustive evidence |
| --- | --- |
| Batch/finality | [Backend log](evidence/issue-408-batch-finality-tlc.txt): 58,825,887 generated / 22,484,076 distinct / **0 queued**; depth 57; no violation; 441,887 ms |
| Grant control | [Backend log](evidence/issue-408-grant-control-tlc.txt): 2,758,767 generated / 979,980 distinct / **0 queued**; depth 47; no violation; 22,878 ms |

Environment: prepared Node 24.20.0, Quint 0.32.0, Apalache 0.56.1 and Debian
OpenJDK 17.0.20.1 on the local Linux ARM host. TLC used its default 12 workers
and 8 GiB heap. The bounded supervisor resolved only after proving absence of
its exact owned process group. TLC's retained fingerprint collision estimates
remain part of the backend's ordinary proof limits.

Two earlier 180-second diagnostics timed out without a verdict. Their partial
search counts are diagnostic evidence only. The successful run used the same
model bytes; verbosity exposed backend progress and an identified native JVM
replaced the earlier PATH-selected JVM. No historical interrupted run was credited.

## Checks and closure

- Canonical/projection typechecks passed. Collected positive paths: canonical
  21, grant control 34, batch/finality 23. Reachable negative controls: 16, 19,
  and 20 respectively. Guard-removal cleanup mutant is red; original finality
  path and new regression are green.
- Three existing sampled commands passed with their exact current effective
  arguments. Zero random finality witness hits remain sampling diagnostics;
  collected reachability and complete exhaustive verdicts provide their separate
  evidence.
- Projection-contract controls: 7 passed. Profile/partition owner controls:
  32 passed. Vitest independent command contract: 19 passed. Required formal
  controls: 150 passed.
- Qualification evidence consumers: 17 passed. Aggregate-shard controls: 3
  passed. The live-qualification launcher fixture initially omitted new position
  146 through stale shard ranges; after the fixture repair its whole file passed
  20 checks. No accepted schema assertion was removed.
- `check:submit` passed artifact preparation, formal controls, typecheck,
  changed-file lint, quality-selection fixtures and full lint census, then hit
  its mistakenly short 300-second outer stop during the cassette stage. The
  composite remains **timed out**. The previous completed cassette stage alone
  had taken 315.48 seconds. The last observed authored-domain file passed all
  11 focused checks. The separate 420-second cassette command also timed out,
  after **494 individually passing cases and 21 configured skips**. Its bounded
  supervisor proved stopped writers. Only the three serial files were unlaunched;
  their focused invocation passed **12/12 cases in 62.97 seconds**. All 506 selected
  cases therefore have individual passing evidence, but neither aggregate command
  is credited as passed. Successful prefix stages and the suffix remain separate.
  A final Linux process observation found no live worktree-associated process
  and no unreadable process entries after both interrupted runs and the suffix.
- The later tooling-fixture repair passed changed-file type-aware lint.
  Hosted formal input closure and the MBT manifest are fresh; neither required
  a new source-path inventory or MBT generation. No ordinary full suite,
  `check:all`, full formal portfolio, MBT replay or fresh live provider journey
  was run for this model/profile follow-up.

Standards and Spec independently reviewed the fixed diff from Base, snapshot
SHA-256 `32b1b42a9775efcd3220328021604ec90c0d63817b9ed5e2a077f6138394b540`.
Neither axis found a code blocker. Both separately confirmed that the retained
494-case prefix plus the passing exact 12-case suffix closes scoped verification
under the check-selection policy while both aggregate timeouts remain unproven.
The suffix passed, so that conditional closure is satisfied. No scoped finding
is deferred. Subsequent edits record only these terminal evidence/closure facts;
reviewed model and tooling source bytes are unchanged.
