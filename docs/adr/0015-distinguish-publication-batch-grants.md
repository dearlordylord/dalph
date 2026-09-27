# Distinguish Publication-Batch Grants from Integration Quarantine Directions

Status: Accepted in the maintainer conversation on 2026-09-27

Issue #386 lets the Operator continue one exact retained integration after a
publication or successor-session allowance is exhausted. The Operator-facing
choice is called Full rerun, which is also used for an Integration quarantine
direction.

## Decision

Record a distinct durable publication-batch grant for the exact
`(RunId, integration responsibility, publication-exhaustion occurrence)`. The
grant authorizes one bounded additional batch and preserves all earlier session
and publication-intent history and ordinals. Exact request redelivery returns
the same grant. A grant is not publication proof or task-completion evidence.

The publication-batch grant is distinct from
`IntegrationQuarantineDirectionApplied`. That event records a choice for one
quarantined integration session; its Full rerun direction creates a new
integration session and candidate resource. A publication-batch grant continues
an exhausted publication responsibility and may reuse its candidate without
creating a session.

## Rejected alternatives

- Reuse `IntegrationQuarantineDirectionApplied`: its subject and resulting
  session/resource lifecycle differ, so it would misstate publication history
  and make exact replay or recovery ambiguous.
- Edit allowance counters or ordinals: that would erase the causal history of
  consumed work and make crash recovery unable to derive one authorized batch.
- Treat the grant as publication success: only exact remote proof and the
  existing promotion and finality sequence can settle the responsibility.

## Consequences

The Journal records the exhaustion occurrence before the Operator grants a new
batch. A grant is unique per `(RunId, responsibility, occurrence)` even if a
different request identity is submitted. Recovery derives remaining allowance
from the committed grant and subsequent session/intent history. A later exact
exhaustion requires a separate grant. The accepted chronology is in
[`direct-remote-publication.md`](../scenarios/direct-remote-publication.md).
