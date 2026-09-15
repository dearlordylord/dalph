# Issue 165: domain-readable authored and recorded cassettes

These scenarios specialize the accepted fake-provider cassette behavior in
issue #163 for the maintained cassette library delivered by issue #165.

## A maintainer runs an authored singleton-task cassette

A Dalph maintainer has an authored cassette for run `cassette-singleton`. Its
starting tracker facts contain one open task A with readable title and body,
no prerequisite or grouping edges, and an empty structured task-claim list.
Its structured Git starting fact says the planned worktree is absent because
this milestone uses the controlled worktree boundary. Its executor starting
fact says there is no prior report, and its journal starting fact says the
in-memory Dalph journal is empty.

The maintainer asks the cassette runner to run the scenario. The cassette
runner decodes the structured cassette, supplies its tracker facts through the
production `TrackerGraphReader` interface, supplies claim and worktree behavior
through the existing controlled provider composition, and supplies executor
reports for the one planned `(RunId, AttemptId)`. It invokes `runWorkflow`; it
does not append journal events, assign reducer state, or select work itself.

Dalph reads and records the tracker graph, rereads A before crossing the claim
boundary, records and creates A's controlled claim, rereads A after the claim,
reads and records A's exact task-work specification, records the immutable
attempt, reconciles the controlled worktree, and asks the executor to do the
complete attempt work. The executor first reports `ExecutorWorkExecuting` and then `ExecutorWorkTerminal`
Completed. The authored cassette tells this complete real case through typed
starting facts, actor commands, controlled outside results, expected Dalph
actions, expected outcomes, and forbidden outcomes. Outcome assertions remain
distinct from production events even though the readable renderer presents
them together as one chronological story.

The runner interprets the expected domain behavior from that story and compares
it with the domain behavior observed from the production-loop trace. The
specialist-facing assertion says that A's planned work completed and that
Dalph undertook no planned work for B. Optional orchestration evidence may
name executor-work responsibility and reports for the exact attempt; optional
protocol evidence may name claim acquisition, attempt planning, and worktree
readiness. Journal validation and exact production occurrence inspection
support this comparison, but raw journal tags and
`ValidWorkflowJournalHistory` are not authored visible-outcome vocabulary.

There is no real GitHub, Git, SQLite, process, or operating-system boundary in
this scenario, so network loss, an external process crash, and provider retry
do not apply. A mismatch at a controlled provider is a typed cassette failure;
rerunning creates a new in-memory provider composition and journal from the
same decoded input.

The maintainer sees readable lyrics, the matching decision checkpoints, and a
valid journal. Dalph must not start an unplanned attempt, invent executor
review or retry stages, accept a different attempt identity, or let cassette
code bypass the production loop.

Acceptance tests:

- `runs an authored cassette through the production loop and matches its declared decisions`
- `rejects an executor entry for a different planned attempt`
- `fails typed authored boundaries and declared behavior mismatches`

## A maintainer runs one recovery cassette across coordinator death

A Dalph maintainer has an authored recovery cassette for one open task A. The
cassette starts with an empty in-memory journal, no prior executor report, no
task claim, and no planned worktree. Its controlled tracker reports A open and
supplies A's exact work specification. Its story says that the coordinator
process dies after Dalph records responsibility for A's planned attempt but
before a terminal executor report is journaled.

The maintainer runs the cassette. During the first activation, Dalph observes
the graph, claims A, records its immutable planned attempt, prepares its exact
worktree, and records that it has accepted responsibility for the executor
work. At that exact semantic checkpoint, before the next executor report, the
cassette's typed `CoordinatorProcessDies` lifecycle item immediately interrupts
and disposes the complete coordinator scope on the same Effect fiber. The item
belongs to the authored cassette and its execution harness; it is not appended
to Dalph's workflow journal and is not supplied to a reducer as production
history.

The in-memory journal and the controlled tracker's claim and Git worktree facts
survive into the next cassette activation. Because the milestone fake executor
shares the coordinator process lifetime, no unjournaled executor report
survives as evidence. The cassette constructs a new coordinator for the same
run through the authoritative journal-backed startup-recovery composition.
Dalph reconstructs the same planned attempt. Before contacting the executor,
ordinary production protocols journal and perform one sufficiently fresh
`ActiveTaskContinuationRead` for the current task facts and claim; when the
complete graph content is unchanged, #164's compact unchanged-graph
reconfirmation is the recorded observation. A separate fresh Git read proves
the exact planned worktree. Dalph then records one generic durable continuation
authorization that causally witnesses those observations and permits
continuation of the existing executor-work responsibility. Missing, stale,
later, or differently correlated witnesses fail before executor contact. The
executor reports for that same `(RunId, AttemptId)`, and Dalph records the report
through the production workflow.

The coordinator death is harness-controlled, so real operating-system process
qualification and an independently surviving executor do not apply. Pause and
Unpause may appear in later cassette stories only through their separately
accepted production control protocol. Graceful application Exit does not apply
because no accepted Exit semantics currently distinguish it from coordinator
death; a separate issue must specify those semantics before a cassette uses
them.

The maintainer sees one readable story spanning both activations, the same
planned attempt before and after restart, and matching recovery checkpoints.
Dalph must not journal a synthetic coordinator-crash occurrence, allocate a
replacement attempt, trust pre-crash volatile state, install another synthetic
fresh-only activation after restart, continue without current claim and
worktree authority, or treat process death as executor completion.

Acceptance-test seams:

- `runs one authored recovery cassette across coordinator death and startup recovery`
- `does not journal the cassette coordinator-death lifecycle event`
- `records fresh active-task and exact-worktree observations before continuation`
- `uses compact unchanged-graph reconfirmation when graph content is unchanged`
- `records one generic continuation authorization witnessing the current observations`
- `rejects missing, stale, later, and wrong-attempt witnesses before executor contact`

The authored-cassette conformance law for every cassette A is:

```text
meaningExpected(A) ≈ meaningObserved(run(A))
```

The recorded-cassette laws remain, for every corresponding prefix `n`:

```text
foldJournal(J prefix n) ≈α foldRecorded(project(J) prefix n)

select(foldJournal(J prefix n))
  ≈α
select(foldRecorded(project(J) prefix n))
```

`≈α` permits only one consistent accepted renaming of generated identities.
Projection contains only occurrences Dalph actually journaled; it never
manufactures the cassette's coordinator-death lifecycle event, an unobserved
outside happening, or a fact inferred only from final fake state.

## A journal is projected and folded occurrence by occurrence

A completed in-memory run journal contains the singleton scenario's tracker
read actions and observations, claim intent and result, planned attempt, Git
worktree intent and ready proof, executor-work responsibility, and coarse
executor reports. The physical records also contain journal keys, positions,
payload versions, and storage encoding concerns.

The maintainer projects that valid journal into a recorded cassette. The
projection emits exactly one structured domain entry for every journaled
occurrence in original order. It retains the task, operation, attempt,
evidence, and report meanings required by reconstruction. Tracker and executor
entries reuse #160's accepted actor and occurrence classifications; the other
entries do not invent classifications that #160 has not established. The
cassette does not copy journal keys, journal positions, event versions, or
database encoding. Readable lyrics are rendered from those entries.

For each corresponding prefix, Dalph folds the source journal and folds the
recorded cassette as history. It compares reconstructed domain state and runs
the same pure frontier selector on both states. It separately compares the
complete domain workflow history and logical applied-through occurrence count.
Generated identities use one consistent renaming when they differ. In the
illegal-early-start negative, the final operational state converges while the
retained occurrence history and an earlier selector decision expose the
illegal ordering. A later occurrence cannot hide that mismatch merely because
the final operational states agree.

No outside provider call, crash, or retry occurs during this pure projection
and fold. Repeating projection of the same valid history produces the same
recorded meanings.

The maintainer sees every checkpoint agree. Dalph must not omit or combine
occurrences, compare only final JSON, run the recorded cassette as an outside
world script, or treat physical storage fields as cassette-domain facts.

Acceptance tests:

- `round-trips every journaled occurrence and preserves state and decisions after every prefix`
- `renders recorded operator commands from their structured entry`
- `rejects an illegal early start even when the final semantic state agrees`

## An authored outside occurrence is never observed

An authored cassette contains a tracker edit made by another person after the
last tracker result Dalph receives. No later logical tracker read observes that
edit. The production loop runs only from the provider results it actually
receives and records only those observations.

Projecting the run journal produces no recorded entry for the unobserved edit.
There is no retry because Dalph made no request whose result was lost. The
maintainer can still read the unobserved edit in the authored cassette, while
the recorded cassette truthfully contains less outside-world information.

Dalph must not infer the edit from changed final fake state, invent a tracker
actor occurrence, or copy all authored outside occurrences into recorded
history.

Acceptance test:

- `does not invent an authored outside occurrence that Dalph never observes`

## Generated valid cassettes shrink to a readable failing checkpoint

The property generator constructs a small acyclic task graph directly, with
complete read coverage, readable task-work specifications, a run command,
coarse executor reports for each planned attempt, and expected decision
checkpoints. It never starts from arbitrary JSON or filters invalid graphs
afterward.

Each generated authored cassette is decoded and run through the production
loop into a journal accepted by workflow-journal-history validation. The
journal is projected and checked prefix by prefix. Fast-check shrinks the
graph, reports, and checkpoint list together, so any counterexample remains a
valid domain-readable cassette and retains the first failing semantic
checkpoint.

No real provider retry or process crash applies because generated runs use
bounded in-memory providers. A generated controlled mismatch is a test failure,
not a reason to discard the sample.

Acceptance test:

- `generated valid authored cassettes produce valid journals and checkpoint-equivalent recordings`

## Changed and unchanged observations are measured before compression work

A maintainer runs a 100-task chain through three complete graph reads. The
first is a complete changed observation and the next two are comparable
unchanged reconfirmations. Dalph encodes the journal records and recorded
cassette with their maintained schemas and measures their UTF-8 byte sizes.

This is a pure measurement; no person-visible runtime behavior, outside
boundary, crash recovery, or retry changes. The report records both sizes and
does not propose graph deltas or compression as part of issue #165.

Acceptance test:

- `reports encoded journal and cassette sizes for changed and unchanged graph observations`
