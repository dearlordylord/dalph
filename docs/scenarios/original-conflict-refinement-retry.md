# The Operator retries a failed original content-conflict resolution

Accepted scope: explicit human Retry may refine the provider's original conflict
resolution after a required check fails. The provider works only in its exact
retained candidate. Tracker owns accepted task scope, Git owns H/C and merge
facts, execution substrate owns writer observations, and Journal owns workflow
history. No workflow, event, control, model, model selection or authority changes.

## Governing behavior

This refines provider policy under [retained merge Retry](retained-integrator-merge-retry.md)
and preserves [Started Retry recovery](started-integrator-retry-lineage.md),
[quarantine and human control](recover-or-quarantine-integration-session.md),
and [lexical link repair](candidate-local-documentation-links.md).
[Serialized integration](../DELIVERY-INVARIANTS.md#serialized-integration) and
[ambiguity and evidence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence) remain binding.
The [accepted integration model](../../specs/acceptedResultIntegration.qnt)
continues to constrain `noAutomaticIntegratorSuccessor`,
`integratorRecoveryReusesSameSession` and `retryRequiresOneExplicitChoice`.
One FullRerun and no third session remain unchanged.

## P1: Refine the original resolution after human Retry

An immutable accepted C and fixed H have actual content conflicts in specific
paths. The provider resolves them but a required focused check fails because
both accepted behaviors were not preserved. It returns conclusive NotPrepared
with retained diagnostics and resource; it cannot repair automatically in that
run. The Operator submits a distinct exact native Retry for this quarantine.

Before effects, the native owner reconciles uncertain outcomes and proves stopped
writers. The provider reads Git conflict/merge history for H/C and the retained
failed diagnostic. It establishes the original conflict paths and the causal
resolution defect; uncertain provenance refuses repair. It may refine only that
resolution, not arbitrary bytes merely sharing a conflicted path. It runs the
failed boundary's focused check first. Only a passing result permits applicable
required candidate qualification. All required checks must pass before Prepared,
with exact direct ordered parents [H,C], target still H and unchanged C. Another
failure retains NotPrepared and waits for another explicit human direction.

## P2: Surface clean-merge defects to their owner

At that same boundary, a failure in a non-conflict path, new feature, unrelated
production behavior, existing tests/fixtures/assertions, narrative acceptance, raw or
hashed/manifest-bound evidence requires separate owner repair, even within an
originally conflicted path. Return NotPrepared without changing those bytes,
exempting checks or choosing one whole side. The existing lexical documentation
link permission retains all exclusions and remains separately applicable.

## P3: Recover the fixed identities

A crash or response loss between Retry admission, turn start, edits and sealing
retains the same session/run/resource and immutable H/C. Exact request redelivery
is idempotent. Recovery reconciles prior effects and proves stopped writers before
continuation. Changed target, foreign resource, unproved custody or ambiguous
history refuses/reconciles before further effects. Later human Retry remains
unlimited; no S3, automatic semantic retry, new leaf attempt or duplicate claim.

## P4: Preserve both accepted behaviors and evidence

Every refinement preserves H and C scenarios, old test/fixture assertions,
document/evidence byte ownership and exact parents. Optional diagnostics do not
become mandatory gates by invocation; applicable failed gates remain blocking.
The Operator sees non-conflict failures returned to their owner. Publication,
tracker mutations and cleanup are outside this provider-policy change; their
existing protocols remain binding.

## Verification map and limits

The policy is interpreted by Codex, not enforced by a new byte classifier.
Controlled provider results cannot prove semantic judgment; no new tests merely
matching prompt strings are added. Existing executable boundaries remain selected:

| Scenario | Focused owner/consumer verification and negative controls |
| --- | --- |
| P1 | [Provider tests](../../packages/dalph/src/application/codex-integrator.test.ts): `reconciles retained Retry $name before any new provider turn`, `starts exactly one fresh run-two turn on the retained session resources`; [Git candidate tests](../../packages/orchestrator/src/authorities/git/integrator-candidate.test.ts) enforce ordered parents and unchanged target. These prove admission/qualification, not semantic refinement. |
| P2 | Provider `replays a sealed NotPrepared boundary (%s) without starting another turn` proves conclusive refusal/replay; [envelope tests](../../packages/dalph/src/application/codex-integrator-envelope.test.ts) reject malformed success. Owner routing and forbidden byte judgment require provider interpretation. |
| P3 | Provider `restarts an unfinished retained-merge run two with its same durable token`, live/unreadable custody and foreign-history negatives; [worktree tests](../../packages/dalph/src/application/codex-integrator-worktree.test.ts) refuse changed H/C, foreign registration and invalid parents; [protocol tests](../../packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts), [successor tests](../../packages/orchestrator/src/workflow/protocols/integrator/successor-session.test.ts) and [reconstruction tests](../../packages/orchestrator/src/workflow/protocols/integrator/reconstruction.test.ts) prove exact authorization/redelivery and same S2 recovery. |
| P4 | Git candidate and worktree negative controls enforce identities/parents; sealed NotPrepared replay keeps failed required checks blocking. Semantic preservation and evidence exclusion remain provider-interpreted. |

## Native Retry handoff clarification (C1–C4)

C1 starts with fixed H/C, the exact retained merge and a conclusive sealed
NotPrepared predecessor. On a fresh explicit human Retry, the native owner
rereads the owned thread, predecessor token/terminal history and current activity
before allocating the new run token and starting the provider turn. The Retry
prompt identifies the completed native-owner reconciliation for admission-time
prior provider-owned activity in this exact session/run/resource. The provider
may rely on it without inventing a separate custody report or repeating a manual
process census. It still reads Git conflict history and retained failed diagnostics,
refines only the original resolution, and passes the failed focused boundary
before applicable qualification, preserving H/C and ordered parents [H,C].

C2 refuses admission for live/unreadable activity, changed ownership/token,
contradictory or nonterminal history, interrupted custody without exact stopped
proof, or a foreign candidate. No new provider turn receives the guarantee.
C3 bounds the guarantee to admission-time prior owned activity. The current turn may perform its authorized scoped work; admission does not
prove its completion or stopped custody. Later uncertain effects, live/background
activity, interrupted processes and foreign writers still require native
reconciliation before further effects, reuse or sealing. Crashes retain the same session/run/resource and fixed H/C;
redelivery remains idempotent, and a later Retry needs fresh native admission.
C4 preserves P2/P4, the lexical-link exception and all original repair exclusions.
No native guard, algebra, authority, cleanup, publication or Retry limit changes.

| Scenario | Verification and limits |
| --- | --- |
| C1 | Provider `reconciles retained Retry $name before any new provider turn` exercises a sealed NotPrepared followed by admitted retained Retry and captures its actual `startTurn` prompt, exact run and limited guarantee. Git candidate/worktree tests above preserve H/C and parents. Semantic interpretation remains parent-owned. |
| C2 | The same provider matrix asserts live/unreadable custody, foreign predecessor, wrong parents and Prepared predecessor start no new turn and receive no new prompt; existing foreign-token/history and interrupted-custody negatives remain required. Worktree tests reject foreign candidates. |
| C3 | Provider `starts and replays eight contiguous provider runs on one exact retained resource`, `refuses a third run while an old writer is still live and preserves both sealed runs`, interrupted recovery tests and sealing census tests exercise fresh admission, idempotence and later custody. The admitted prompt explicitly excludes current/later/foreign activity. |
| C4 | Existing P1–P4 mapping remains binding. Envelope, worktree and Git candidate negatives preserve refusal and identities; provider policy interpretation of repair exclusions remains unproven until the actual retained pack Retry. |

Source evidence is the existing `reconcileRetainedMergeRetry`, `prepare` and
`sealObservedRun` in the [native provider](../../packages/dalph/src/application/codex-integrator.ts).
The [physical conflict fixture](../../packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts)
records real native census observations; the
[interrupted fixture](../../packages/dalph/src/application/codex-integrator-interrupted-real-qualification.test.ts)
requires exact prior incarnation process-group absence. These are retained guard
evidence, not claims of a fresh live-provider run for this clarification.

Parent acceptance must use the actual retained pack integration as the one minimal
physical/provider proof after native publication and frozen-host upgrade. This
leaf does not claim that proof passed. Pack accepted C is
`d58eb957b271e7046c17b0f65e217b62864032e0`; fixed qualified H is
`a285a0dbc33c4ba283f55e53bcb1161f7e0def27`. Keep the original pack Run
paused/stopped, its graph, Journal, claims and resource intact. Restore with the
newly published built original-Dalph source, then issue one explicit native Retry
of its latest S2 quarantine. Verify original conflict provenance, required
idle/drain focused pass first, pre-claim legacy/native isolation, required pack
qualification, unchanged H/C, ordered parents and stopped custody. No S3 or
private-ledger/Journal rewriting; parent owns combined acceptance and publication.

Leaf qualification selects the mapped focused files, `check:fast`, scoped
standards/spec review, `check:docs` and `check:submit`. No local `check:all` or
pack application gate is authorized in this source-repair worktree.

## Permanent additive regression files after explicit Retry (T1–T4)

This refines P1/P2 and preserves C1–C4 native admission. The provider may add
permanent regression files for its original conflict resolution; no workflow,
event, authorization, custody, model or runtime algebra changes. Codex interprets
the policy; no byte classifier or test-only production export is introduced.

T1 starts with original content conflicts resolved in the exact retained candidate,
a conclusive required-check failure due to missing verification of that resolution,
and sealed NotPrepared diagnostics and custody. The Operator submits a fresh exact
explicit native Retry. Before edits, the provider uses the scoped admission proof,
reconciles subsequent uncertain effects, reads original H/C Git conflicts and
retained failed evidence, and establishes that the missing cases belong to its
resolution. It may add only new permanent regression-test files, using unchanged
existing helpers/fixtures or local controlled fixtures in those files. Tests prove
accepted positive and negative boundary behavior, including refusal before unsafe
effects, rather than implementation/string mirrors or numeric coverage tricks.
Production refinement remains independently bounded to the original resolution
paths. Run the failed boundary's focused tests/check first; only a pass permits
all applicable required qualification. Commit added files in the final exact
ordered [H,C] merge, preserving fixed H, immutable C and both accepted behaviors.

T2 at that same boundary forbids modifying, renaming, deleting or replacing existing
tests/fixtures/assertions, acceptance narratives, raw evidence, hashed/manifest-bound
bytes, gate command manifests, coverage inclusion/exclusion/ignore settings or
thresholds. Do not weaken guards, change production behavior for metrics, create
test-only production exports or inject ephemeral/discarded tests. Unrelated missing
verification, clean-merge defects, new features and unrelated production paths
require separate owner repair and NotPrepared. New files cannot hide assertion
changes or broaden production permission.

T3 covers crashes or response loss between admission, file creation, qualification
and sealing. Preserve exact session/run/resource, H/C and candidate including new
files. Request redelivery is idempotent; subsequent uncertain/live/foreign activity
requires native reconciliation and later Retry requires fresh admission. Changed
test or production bytes invalidate prior qualification. Obtain applicable complete
qualification for the exact coherent candidate; credit no missing/failed stage.
Another failure retains conclusive NotPrepared diagnostics without automatic semantic
retry, duplicate claim, new leaf, another FullRerun or S3.

T4 requires scoped standards/spec review of added files and preservation of existing
bytes before handoff. Parent owns actual provider/composed acceptance after native
source publication and host upgrade: the pack Retry must retain existing tests,
fixtures and evidence, cover meaningful rejection guards, pass focused checks then
the unchanged required 99% gate, and preserve ordered parents and target/publication
controls. This source repair does not claim that proof passed. Tracker mutations,
publication and cleanup are outside this policy boundary and keep their existing
owners; their scenarios are unchanged.

| Scenario | Verification and limits |
| --- | --- |
| T1 | P1/C1 provider admitted Retry controls and Git candidate/worktree ordered-parent controls above prove native admission and identity. Original-conflict provenance, meaningful new positive/negative tests and focused-before-complete qualification require actual parent-owned pack Retry; prompt-string tests would not prove them. |
| T2 | P2 sealed NotPrepared replay and envelope negatives prove conclusive refusal. P2/C2 worktree and provider negatives refuse foreign candidates/custody before turns. Source policy review checks exclusions; preservation of all existing bytes and semantic scope require actual pack diff/review. |
| T3 | P3/C3 provider lost-response, contiguous-run, live-writer and sealing controls; protocol exact direction/redelivery, successor and reconstruction tests above prove unchanged recovery identities and no S3. Qualification for the candidate including new files remains actual provider-owned proof. |
| T4 | Scoped source standards/spec review and focused owner/consumer checks qualify this policy change only. Parent must review new pack files and existing-byte preservation, observe focused and unchanged 99% qualification passing, then verify Git identity and publication controls. Controlled tests do not substitute. |

## Reduce proven runner capacity after explicit Retry (R1–R4)

The Operator may authorize one capacity-only extension to the preceding T1–T4
policy. This preserves P1–P4 and C1–C4, lexical link repair, additive regression
files, and all governing model laws and invariants above. Only provider instructions
change; native admission, custody, workflow algebra and runtime guards do not.

R1 starts after required complete qualification conclusively fails in the retained
original-conflict candidate and returns sealed NotPrepared. The provider reads the
retained failed-boundary evidence and controlled unchanged-source diagnostic:
reducing existing `maxWorkers: 2` to `1` passes all tests and coverage within the
unchanged stage deadline. This does not prove concurrency is the only cause.
The Operator issues a fresh exact native Retry; the native owner reconciles prior
writers before admission. The provider may change only that existing capacity
value in the actual candidate, documenting the boundary and diagnostic. Before
another complete run it obtains a passing focused reproducer there and closes
scoped standards/spec reviews. This exception requires no conflict in the runner
configuration itself and authorizes no general configuration repair.

R2 preserves every existing test, fixture, assertion, discovery setting, timeout,
coverage inclusion/exclusion/ignore setting and threshold, gate command manifest
and order, acceptance narrative, raw/hash-bound evidence and runtime guard.
Capacity increases, timeout increases, gate omissions, CLI substitutes for required
qualification and unrelated configuration edits are forbidden. Unsupported failures
return NotPrepared for separate owner repair.

R3 retains the exact pack Run/session/resource and S2, fixed H
`a285a0dbc33c4ba283f55e53bcb1161f7e0def27` and immutable C
`d58eb957b271e7046c17b0f65e217b62864032e0`. Crashes or response loss between
admission, edit, checks and sealing retain candidate and identities. Request
redelivery is idempotent; native reconciliation owns subsequent uncertain writers.
No new leaf, S3, duplicate claim or additional FullRerun is authorized. Complete
unchanged required qualification must pass on the final coherent candidate with
ordered direct parents [H,C]. A further failure retains evidence and conclusive
NotPrepared without automatic repeated full gates or semantic retries.

R4 requires source scoped standards/spec reviews of the narrow permission and
preserved guards. Parent owns actual provider acceptance after original-Dalph
publication: upgrade from the published source preserving the pack Run and ledgers,
then issue one exact native Retry of the latest quarantine. Observe the capacity-only
diff, focused success, closed reviews, and actual unchanged complete
`pnpm check-all` (all 11 stages, 99% coverage), exact parents and custody. The
retained 173-test one-worker diagnostic (504.10 seconds), isolated covered S9 pass
(225.96 seconds), and two-worker S9 timeouts (270 seconds) supply diagnosis only;
they do not qualify the retained or edited candidate. This leaf cannot edit the pack
or active frozen host and claims no post-publication acceptance.

| Scenario | Source verification and limits |
| --- | --- |
| R1 | P1/C1 admitted retained Retry provider tests and Git/worktree parent controls above prove admission and candidate identity. Actual capacity selection, documented diagnosis and focused-before-complete behavior require parent-owned provider acceptance; no new prompt-string mirrors are added. |
| R2 | P2 sealed NotPrepared replay, envelope negatives and C2 custody/foreign-candidate negatives preserve refusal boundaries. Scoped source review checks permission/exclusions; actual pack diff and review prove preserved configuration and bytes. |
| R3 | P3/C3 lost-response, contiguous-run, live-writer and sealing controls plus protocol, successor and reconstruction tests prove recovery/redelivery and unchanged session limits. Actual final complete qualification remains parent-owned. |
| R4 | Focused provider/consumer checks, `check:fast`, `check:docs`, `check:submit` and fresh scoped review qualify source only. Parent performs the exact upgrade/Retry and all 11 pack stages; no original-source `check:all` is authorized. |
