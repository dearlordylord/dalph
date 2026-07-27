# Operational scenarios

An operational scenario explains Dalph by describing what a person, Dalph, and
the relevant outside systems actually do. It comes before domain terminology,
types, state machines, implementation plans, and code.

This is a delivery gate, not a writing-style preference. A behavior-changing
implementation must have accepted operational scenarios in its issue,
specification, or a file under `docs/scenarios/` before implementation begins.
The implementation handoff must map each scenario to passing tests.

A change is behavior-changing when it adds or changes a user command, workflow
decision, external request, durable journal fact, retry, crash recovery rule,
concurrency rule, cleanup action, or visible outcome. A documentation-only or
tooling-only change may state that it changes no Dalph runtime behavior and give
the concrete reason instead of inventing a scenario.

## Required scenario fields

Write each scenario in ordinary chronological language. Answer every relevant
question. When a boundary, crash, or retry cannot affect the behavior, say why
it does not apply instead of inventing an event.

1. **Who is acting?** Name the affected person when one exists and every
   relevant system. If no person directly triggers or observes the behavior,
   say so.
2. **What is true before the action?** Name the GitHub tasks, dependency
   relationships, claims, Git refs or worktrees, running executor sessions, and
   durable Dalph records that already exist.
3. **What happens outside Dalph?** Describe any GitHub edit, Git result,
   executor result, process exit, timeout, or lost response.
4. **What starts it?** Describe the person's command or the concrete system
   event without replacing it with a domain term.
5. **What does Dalph do, in order?** Name each external boundary Dalph reads or
   changes and each durable fact it records.
6. **Where can Dalph crash?** Put the crash between concrete steps rather than
   saying only that recovery is supported.
7. **What happens when the action is retried?** State what is repeated, what is
   reused, and what must occur only once.
8. **What can the person see?** State the visible result, wait, error, or lack of
   progress.
9. **What must Dalph not do?** Name work that must not be duplicated, lost,
   resumed, released, claimed, or silently inferred.
10. **Which acceptance test proves this?** Give the test name or declare the
    test seam that the implementation must add.

If an answer is unknown, write the competing real-world outcomes. Do not hide
the decision behind alternatives such as “global versus scoped identity.”

## Example form: a duplicated pause request

This is an illustration of the required level of explanation, not a second
source of Dalph product behavior. Assume the accepted feature specification
requires the behavior below; the actual feature specification remains
authoritative.

### Starting situation

Dalph claimed GitHub issue 2 by adding the repository label used as its claim
record. It created one worktree for issue 2 and started an executor session in
that worktree. GitHub issue 3 still lists issue 2 as a prerequisite, so Dalph
has not started issue 3.

### Person and outside event

Alice presses “pause issue 2.” Her browser sends command `pause-click-17`.
Dalph receives the command and records Alice, issue 2's run, and the requested
pause direction in the workflow journal. The response is lost before Alice's
browser receives it, so the browser sends `pause-click-17` again.

### Dalph behavior

Dalph reads the workflow journal for issue 2's run. It finds the same command
identifier with the same person, run, and requested direction. Dalph returns
the first journal record instead of appending a second record.

At this boundary Dalph does not claim that issue 2 has stopped. It does not
interrupt the executor, remove the GitHub claim label, delete the worktree, or
start issue 3. Later workflow code owns those decisions and must first account
for the executor session and issue 3's current dependency.

### Crash and retry

If Dalph crashes after the journal append but before returning the response, a
new Dalph process reads the same durable record and treats the browser retry as
the same click. Exactly one pause request remains recorded.

### Visible result and forbidden result

Alice sees one accepted pause request. She may still see issue 2 as “pausing”
while its executor reaches the separately specified stopping point. She must
not see two pause requests, a silently deleted claim, or issue 3 starting merely
because the pause command was recorded.

### Acceptance-test mapping

- Record one command when the browser delivers `pause-click-17` twice.
- Close and reopen the SQLite journal, deliver `pause-click-17` again, and
  return the original record.
- Within issue 2's run, reuse `pause-click-17` for a different person, task, or
  direction and return a visible contradiction instead of changing the first
  record.

This example does not decide what happens if a browser reuses
`pause-click-17` for another run. An accepted feature specification must show
the competing user-visible outcomes and choose one before implementation.

## Plan and implementation format

An implementation plan starts with the operational scenarios. Each plan step
names which scenario outcome it delivers and which test will prove it. Types,
events, services, reducers, models, and adapters follow those mappings.

Test names should describe the actor and observable behavior. Prefer “records
one pause request when Alice's browser retries after a lost response” over
“supports idempotent command acquisition.”

## Handoff evidence

An implementation handoff contains a scenario-to-test mapping with:

- the scenario name;
- the concrete outcome implemented;
- the passing test or model check;
- any part deliberately deferred and the ticket that owns it;
- any competing real-world outcome that remains undecided.

Passing typecheck, coverage, or model-checking totals do not replace this
mapping. They are additional evidence.

## Enforcement and limits

`AGENTS.md` makes this artifact a prerequisite for implementation, and
`CODE_REVIEW.md` makes its absence a hard review failure. Reviewers must inspect
the actual issue, specification, scenarios, tests, and handoff together.

A static repository check cannot prove that a scenario existed before coding,
that an issue was accepted, or that prose is understandable and truthful.
Adding a check that searches these documents for required words would create
false confidence and reject harmless rewrites. Process evidence and review own
those judgments until Dalph has structured scenario artifacts connected to
actual implementation changes.
