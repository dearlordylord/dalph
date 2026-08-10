# Authorize Existing Planned-Attempt Continuation from Current Facts

Status: Accepted in the maintainer conversation on 2026-08-09

When a coordinator activation ends after Dalph has recorded responsibility for
one planned attempt, the next activation keeps that exact `(RunId, AttemptId)`.
It does not trust process-local activation state, allocate a replacement
attempt, or invent an executor invocation identity.

## Decision

The authored cassette may place a typed `CoordinatorProcessDies` lifecycle
control immediately after the durable executor-work responsibility and before
the next executor report. The control is interpreted on the same Effect fiber
as the action that reached it. It interrupts and disposes the scoped
activation, is absent from the workflow journal and occurrence projection, and
cannot be reconstructed as production history.

Startup recovery reconstructs the unfinished responsibility from the ordinary
Journal-backed Run entry. Before the executor is contacted, recovery performs
the existing journaled task-tracker reads for the current graph, authored
task-work specification, and exact claim. An unchanged graph uses the compact
task-tracker reconfirmation. Recovery separately performs the ordinary Git
read for the exact planned worktree. A generic durable
`PlannedAttemptContinuationAuthorized` fact then names the four observation
operation identities and the exact planned attempt. The action adapter accepts
the continuation only when the witnesses are after the latest executor
evidence, causally ordered after their own intents, and correctly correlated.

The authorization is an internal workflow fact rather than a recovery event;
it changes no reconstructed state and is not projected as a workflow
occurrence. Missing, stale, later, or wrong-attempt witnesses fail with the
owner's typed diagnostic before the executor boundary. The executor's later
`Running` or `Terminal` report remains a report for the retained exact
correlation.

## Rejected alternatives

- Journal a coordinator-crash event: rejected because process loss is a
  cassette/runtime lifecycle boundary, not a workflow fact owned by Dalph.
- Reuse volatile pre-death state or call authority readers directly from
  recovery: rejected because current tracker and Git facts must be obtained
  through their ordinary intent/observation protocols.
- Allocate another attempt or executor invocation identity: rejected because
  process death does not authorize replacement work and would split one
  responsibility's history.
- Let a continuation use any current-looking read: rejected because the
  durable authorization must witness the exact ordered reads and the exact
  planned attempt, with stale and cross-attempt evidence failing closed.
- Add a cassette-only queue, polling loop, or timeout for death: rejected
  because the typed lifecycle control must interrupt the same scoped fiber and
  leave the production workflow algebra unchanged.

## Consequences

The recovery frontier carries an optional typed witness until the existing
executor-work protocol permit is acquired. The permit adapter records one
authorization before the executor command. Journal history validation checks
the witness chronology and identity; reduction leaves the generic fact out of
operational projections. Authored tests must assert the same Run and attempt,
fresh tracker/Git reads, one authorization, no death record, and rejection of
missing, stale, later, and wrong-attempt witnesses.

The accepted chronology is
[`issue-165-domain-readable-cassettes.md`](../scenarios/issue-165-domain-readable-cassettes.md).
