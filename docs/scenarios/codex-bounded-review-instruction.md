# Ask Codex to review a candidate before accepting it

Status: accepted in the supervised issue #384 dogfood follow-up on 2026-09-19.

## Governing behavior

This scenario refines [the persistent Codex app-server executor](codex-app-server-executor.md)
only by adding default instructions inside its one opaque task turn. It preserves
[the planned-attempt executor boundary](planned-attempt-executor-boundary.md):
Dalph does not acquire reviewer identities, review-round state, findings, or
handback authority. A later configuration surface may replace or omit the
default instruction without changing that boundary.

## Codex reviews one candidate and the first clean review ends the loop

### Starting situation

Alice runs Dalph with the Codex planned-attempt executor. Dalph has claimed task
A, prepared its exact worktree at Base B, and is ready to send the one task turn.
No review sub-agent exists and Dalph has no executor result for the attempt.

### Trigger and ordered actions

Dalph starts the task turn with A's instructions, immutable attempt facts, and
the default executor instruction. That instruction tells the implementer to ask
a fresh `gpt-5.6-sol` sub-agent using medium reasoning to review the candidate
against A, linked specifications, repository instructions, and `B..HEAD` before
returning an accepted result.

The implementer completes a candidate and asks the first reviewer. When that
review reports no reasonable blocking finding, the implementer stops reviewing
and returns the existing exact correlated accepted-result JSON. Dalph observes
one terminal accepted executor result through the existing boundary.

The reviewer and its reads are internal to the provider turn. Dalph makes no
separate tracker, Git, journal, or provider call for a review round.

### Visible and forbidden result

Alice sees the ordinary executing and terminal attempt states. Dalph must not
require four reviews after the first clean review, expose internal reviewer
stages as generic workflow state, or accept a different result shape.

No Dalph crash or retry rule is added. If Dalph restarts while the provider turn
is active, existing app-server reconciliation observes the same turn; it does
not create another prompt or reset an internal review count.

### Acceptance-test mapping

- `supplies the bounded fresh-review instruction in the default task prompt`
  proves the model, reasoning level, review inputs, early exit, four-round cap,
  blocking-finding failure rule, and unchanged accepted-result contract are in
  the one prompt sent to Codex.

## Codex stops after four reviews when blocking findings remain

### Starting situation and outside event

The same attempt reaches review, but each fresh reviewer reports at least one
reasonable blocking finding. The implementer repairs findings between reviews
and asks no more than four fresh reviewers. After the fourth review, at least
one reasonable blocking finding remains.

### Ordered result

The instruction tells the implementer to report failure and omit the accepted
result. The completed provider turn therefore lacks the valid correlated JSON,
and the existing Codex adapter reports terminal `Failed`. The worktree and
provider transcript remain available under the existing attempt custody rules.

### Visible and forbidden result

Alice sees a failed executor attempt instead of an accepted candidate. Codex
must not start a fifth review or return accepted-result JSON while it knows a
reasonable blocking finding remains. Dalph must not reinterpret explanatory
text or an uncorrelated commit as acceptance.

Crashes and retries use the same provider-turn reconciliation as the clean
case. The prompt instruction is advisory provider policy: Dalph does not claim
durable proof of each internal review round.

### Acceptance-test mapping

- `supplies the bounded fresh-review instruction in the default task prompt`
  proves the cap and failed-result instruction.
- Existing test `rejects malformed, foreign, ambiguous, and non-JSON terminal
  messages without accepting a commit` proves a completed turn without the
  accepted-result JSON becomes terminal `Failed` rather than accepted.

## A later host supplies different executor instructions

### Starting situation and trigger

A host constructs the Codex executor layer with an explicit instruction list.
This controlled composition changes only prompt text; it does not change task,
attempt, thread, worktree, or result identities.

### Ordered and visible result

Dalph sends the supplied instructions in place of the default Sol-medium review
instruction. An empty explicit list sends no review instruction. Alice still
sees the ordinary executor boundary and result contract.

No outside mutation, crash, or retry behavior changes. Dalph must not append the
default instruction after the host explicitly replaces it.

### Acceptance-test mapping

- `replaces the default task instructions through executor-layer options`
  proves the narrow configuration seam without adding a public production
  configuration field.
