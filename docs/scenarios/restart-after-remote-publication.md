# Restart after Git publishes the candidate without acknowledgement

The maintainer reopens the original Run after its pinned receiving branch
accepts M and the application loses the send result. This qualification adds
public restart and native sender-custody evidence; it changes no Dalph runtime
behavior, journal schema, retry policy, or formal transition.

## Governing behavior

Reconciliation uses [direct publication S1 and S2](direct-remote-publication.md)
and [D28a–D28c](../DELIVERY-INVARIANTS.md#integration-and-promotion): the pinned
endpoint/ref, exact candidate and original operation survive interruption, and
remote proof precedes local promotion and tracker completion. The existing
[accepted-result integration model](../../specs/acceptedResultIntegration.qnt)
and its [executable scenarios](../../specs/acceptedResultIntegration_test.qnt)
`publicationProofMustPrecedeLocalPromotionTest` and
`ambiguousPublicationReconcilesToRetainedAncestorProofTest` constrain publication
proof and finality. This fixture preserves those rules;
it does not replace protocol or retained-prefix conformance evidence.

Issue: [Parent #491](https://github.com/dearlordylord/dalph/issues/491).

## Starting facts and ordered cut

The controlled tracker has one open task A. The fixture owns a source Git
repository, distinct bare receiving repository, SQLite journal, coordinator
lock, evidence directory, and child executor. Both Git targets begin at H0.
The maintainer starts public `runWorkflow`; Dalph claims A, records one planned
attempt, runs its child and accepts C. One Integrator prepares exact M with
direct parents H0 and C. The Run already pins the bare endpoint and master.

Dalph journals the exact publication intent and numbered send intent before
native Git performs the ordinary explicit-refspec push. The receiving branch
accepts M. Native Git finishes, leaving its durable file-backed sender custody
stopped, but the controlled boundary loses the result before the application
can journal publication success. The first application scope stops. SQLite
contains one pending send, no publication proof, no local promotion attempt,
and no tracker completion. The receiving branch equals M and the local
integration ref still equals H0.

The maintainer activates the same public Run with reopened SQLite and fresh
application services. Dalph reconciles the original sender custody before
reading the same pinned receiving branch. Git proves M current. Dalph journals
`ReconciledCandidateCurrent` for original ordinal one, promotes M locally once,
then completes A using fresh tracker premises. Existing finality and exact
cleanup settle before the same Run terminates.

No second push, force push, changed candidate, task attempt, Integrator session,
Run beginning, or invented publication proof is permitted. No live provider is
used. The test deliberately cuts the application scope rather than killing an
OS host; native Git sender completion and file-backed custody are physical.

## Unavailable evidence and a further cut

If prior sender stop cannot be proved, Dalph retains the custody wait without
observing or sending. If ancestry is unavailable or contradictory, it retains
the exact wait and original identity, without automatic mutation retry or
fabricated proof. Reopening again preserves the retained result. These are
existing protocol and retained-prefix obligations, not additional native Git
recovery fixtures in this slice.

## Acceptance mapping

- [Hermetic public journey](../../packages/dalph/test/scenarios/hermetic-mvp.test.ts):
  `restarts the same Run after native Git publishes M without acknowledgement and reconciles stopped custody before promotion`
  proves the pending SQLite cut, unchanged local target, stopped-custody-before-
  read order, original correlation/ordinal, one push, one candidate/session,
  publication-before-promotion-before-completion and same-Run cleanup.
- [Direct publication protocol](../../packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts):
  `does not observe or push when prior sender custody cannot be proved stopped`,
  `retains a redacted ancestry-observation wait without automatic reread`, and
  `retains unproven push custody without a later observe or send` retain the
  unavailable-evidence and further-reopen negative controls.
- [Retained-prefix conformance](../../packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts):
  `reconciles one lost publication response through the actual remote observation boundary`
  and `replays the seed 57 pre-publication prefix without crossing a Git mutation boundary`
  retain protocol authority evidence.
- [Direct-publication ordering](../../packages/dalph/test/integration/direct-remote-publication.integration.test.ts):
  `publishes M before local promotion and task completion, then releases its dependant from a later complete graph`
  remains the ordinary full publication/finality composition owner; this task
  does not duplicate that fixture or claim a new live-provider qualification.
