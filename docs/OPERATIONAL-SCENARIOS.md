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

## Three registers of the same behavior

A scenario is prose. The same behavior is also carried by two other artifacts,
and each register owns a different half of what a scenario says.

**Prose** — the files under `docs/scenarios/`. One chronology told so a person
can follow it, with the actor, the outside events, the ordered boundary calls,
the crash points, and the visible result. This is the register that comes first
and the one a reader learns from.

**Cassette** — the recorded, replayable form of the same chronology. A cassette
carries what happened, occurrence by occurrence, and is authoritative for how
behavior is recorded and replayed.

**Invariant** — `DELIVERY-INVARIANTS.md`. A scenario's *What must Dalph not do?*
field states something no recording can carry: a cassette proves an occurrence
happened, and never that one cannot. Those clauses are general claims over every
Run, so they live as `D` invariants rather than in any single chronology.

A scenario is therefore complete when its chronology is recorded as a cassette
and each of its forbidden results is traceable to a `D` invariant. The prose
remains the readable register of both.

`DELIVERY-STORY.md` is the same three-register split applied to one long
chronology that spans many issues rather than one.

`scenarios/README.md` classifies each file by whether its owning issue is
closed as completed or still open. Ten of the sixteen issue-backed files belong
to open issues and state required behavior rather than describing what Dalph
does today.

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

## Example form: GitHub applies a claim but Dalph loses the response

This is an illustration of the required level of explanation, not a second
source of Dalph product behavior. Assume the accepted feature specification
requires the behavior below; the actual feature specification remains
authoritative.

### Starting situation

Dalph reads GitHub and finds issue 2 eligible. GitHub issue 3 still lists issue
2 as a prerequisite, so issue 3 is not eligible. Dalph has not created a
worktree or started an executor for either issue.

No person directly triggers the next step. The running Dalph coordinator
selects issue 2 from the current eligible tasks.

### Dalph action and outside event

Dalph records that it intends to add its exact claim label to issue 2. It asks
GitHub to create the claim. GitHub adds the label, but the network connection
fails before Dalph receives the response.

### Crash and recovery

Dalph crashes before it records what GitHub did. After restart, Dalph reads its
journal and sees the claim intent without an outcome. It checks issue 2 in
GitHub before trying to create another claim. GitHub reports the exact matching
claim label, so Dalph records that observed result and continues from the
existing claim.

### Visible result and forbidden result

The maintainer sees one claim on issue 2. Dalph must not create a second claim,
change another user's claim, start issue 3 while its prerequisite is
unsatisfied, or treat the lost response as proof that GitHub did nothing.

### Acceptance-test mapping

- Record claim intent before asking GitHub to add the label.
- After a lost response and process restart, check GitHub before another create.
- Treat one exact matching claim as applied, a conflicting claim as a typed
  conflict, and an unreadable GitHub response as no permission to retry.
- Keep issue 3 ineligible until a fresh GitHub read reports its prerequisite
  satisfied.

## Plan and implementation format

An implementation plan starts with the operational scenarios. Each plan step
names which scenario outcome it delivers and which test will prove it. Types,
events, services, reducers, models, and adapters follow those mappings.

Test names should describe the actor and observable behavior. Prefer “checks
GitHub after losing the claim response and keeps the existing claim” over
“supports idempotent acquisition.”

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
