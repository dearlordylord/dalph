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
production behavior, tests/fixtures/assertions, narrative acceptance, raw or
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
