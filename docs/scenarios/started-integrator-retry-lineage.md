# Resume an already Started integration Retry

The Run owner reactivates one stopped, explicitly authorized Retry in the same
Integrator session. The original authorization and the current Git read belong
to different chronological prefixes. Issue [513](https://github.com/dearlordylord/dalph/issues/513)
composes the qualified [retained merge owner](retained-integrator-merge-retry.md).

## Governing behavior

Before admitting a provider call, preserve the human choice and stopped-writer
rules in [integration recovery](recover-or-quarantine-integration-session.md#dalph-disappears-while-the-integrator-session-is-unfinished)
and [production recovery](production-codex-integrator.md). This refines the
implementation of existing [D44 integration session preservation](../DELIVERY-INVARIANTS.md#serialized-integration),
without a new event, control, session or Retry policy.
[The accepted integration model](../../specs/acceptedResultIntegration.qnt)
owns `integratorRecoveryReusesSameSession`, `retryRequiresOneExplicitChoice`,
and `retryAdvancesSameSessionToOrdinalTwo`. Its paired
[tests](../../specs/acceptedResultIntegration_test.qnt) include
`retryRecoveryPreservesQuarantineAndExactRunTest` and
`resumeAfterAuthorizedRetryPreservesExistingIntegratorHistoryTest`.
The model's abstract reactivation preserves the existing invocation; it does
not model individual journal positions or native ownership tokens. This repair
implements that abstraction at the journal/provider boundary; it changes no
model action, obligation, journal format, or provider-private transition.

## P1: The Run owner resumes the same Started run

Before interruption, an exact conclusive predecessor result has a unique human
Retry direction D. The original canonical Git read L follows D and precedes one
contiguous Started run. The session fixes H, C, Base and the candidate resource.
The process stops before provider admission, or loses an outer response after
the native provider has recorded a token. All native writers must be proved
stopped before recovery effects.

On ordinary reactivation, record a new Git read intent, read Git, and record its
lineage observation after Started. Reconstruct historical D/Q/predecessor/L
from the prefix before Started. Independently validate the exact current L and
request against the full accepted history. Reuse the same Started, session,
ordinal, candidate path and recorded token. If no token exists, the ordinary
native owner allocates its first token once. After an uncertain response,
reconcile the native record/history and custody before another effect. Required
checks must pass before Prepared; Git must prove ordered direct parents [H,C].
No tracker mutation, promotion or publication belongs to this provider admission
fixture; those remain ordinary parent Run responsibilities.

Acceptance tests:

- `resumes the same Started Retry with a fresh post-Started lineage in dense and gapped histories`
  in [protocol tests](../../packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts)
  exercises ordinary replay and separately validates gapped canonical L positions.
- `applies a recorded Retry after restart without another user request` exercises
  an interrupted provider call and a fresh Git read without another direction.
- `reopens an authorized Started Retry through the native protocol with absent and recorded tokens`
  in [native qualification](../../packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts),
  using [the live journal fixture](../../packages/dalph/test/support/native-started-retry.ts),
  exercises actual Codex 0.162.1 and the production outer protocol. It proves
  pre-token Started admission, sealed ordinal-one NotPrepared, stopped custody,
  run-two first allocation, lost outer response, unchanged run-history recorded-token
  recovery and conclusive replay. It checks session/path/thread, required check
  exits and exact parents before Prepared. It uses a disposable repository and
  an authenticated live model, not original #501 resources.

## P2: Historical authority cannot revive invalidated work

The same resume must fail before provider admission if original D/Q/predecessor
is missing, duplicated, foreign, noncontiguous, after Started or contradictory.
The fresh L must have the exact canonical intent/outcome pair for this request,
Run, target and planned attempt. Missing, wrong-keyed, foreign, duplicated,
pre-Started or superseded L is not current evidence. Changed H/C/Base cannot
reuse the old authority. A post-Started changed-head quarantine remains terminal,
even after H returns. Later session quarantines, directions, starts or foreign
results invalidate historical authority. The exact current result may replay
idempotently until a later quarantine/direction supersedes it.

`rejects each historical or current Started Retry contradiction before provider admission`
in the protocol tests names and asserts these branches individually: missing D,
Q, predecessor Started/result; duplicate D/Q/Started/L; foreign D/Q/L; D/Q after
Started; noncontiguous ordinal; missing L/intent; wrong-keyed L/intent/Started;
stale pre-Started and post-Started L; nonmatching request; changed H/C/Base;
post-Started changed-head quarantine, conclusive Q, superseding/conflicting D
and foreign result. The unchanged negative controls also cover malformed
predecessor detail, evidence positions, candidates, absence and replay identities.

[Native owner tests](../../packages/dalph/src/application/codex-integrator.test.ts)
`reconciles retained Retry live custody before any new provider turn` and
`reconciles retained Retry unreadable custody before any new provider turn`
retain custody refusal. `restarts an unfinished retained-merge run two with its same durable token`
proves lost turn-start response reconciliation without another turn start.
The native fixture separately proves absent-token first allocation and sealed
recorded-token recovery. No OS-crash or full-capacity guarantee is claimed.

## P3: Initial admission and conclusive replay stay distinct

Without Started, retain the existing D-before-L-before-Started rule.
`starts run two only after exact Retry and a fresh matching target-head read`
proves initial admission. The P1 dense/gapped test separately proves Started
recovery and repeated conclusive replay without another opaque call.
`human directions admit runs two through sixteen once each in the same exact session`
retains #508's human-only numeric Retry policy. Existing #511 required-versus-
optional checks and #512 retained merge admission remain composed. Reused
native evidence is limited to unchanged runtime boundaries with exact source
hashes; the changed protocol/native fixture receives new evidence.

[The qualification packet](../evidence/issue-513-acceptance.md) maps results and
source hashes. No full gate, #501 submission/capacity rerun, manual push, closure,
or mutation of the original Run is part of this leaf qualification.
