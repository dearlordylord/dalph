# Reducer Lab: run every maintained cassette through production

These scenarios add a throwaway Lab over all three production-owned maintained
cassette catalogs. They do not change a Dalph command, workflow decision,
tracker or Git request, durable journal fact, retry rule, cleanup action, or
production-visible result. The Lab imports the authored, target-promotion, and
integration-finality catalogs and their production runners; it does not define
another cassette catalog or workflow interpreter.

The shared authored-cassette harness also resolves a recovery scheduling race.
After an authored `CoordinatorProcessDies`, the recovered production
coordinator may ordinarily finish at the same turn that the story cursor
reaches its terminal assertion group. The harness accepts that successful
coordinator completion, then consumes the terminal group at its exact current
position and checks the returned journal. A failed recovered coordinator still
fails the cassette, and an earlier or mismatched story item still produces an
interaction mismatch. This changes deterministic test-harness chronology only;
the production coordinator, boundaries, journal events, and visible command
outcomes are unchanged.

## A maintainer runs one maintained cassette to its authored end

### Starting situation

A Dalph maintainer opens the Reducer Lab. The checked-in maintained cassette
catalogs contain stories with their own tracker, claim, Git, executor,
integration-candidate, verification, promotion, control, and journal starting
facts. No real GitHub repository, Git worktree, executor process, or durable
journal is changed: each cassette declares controlled boundary results and the
production cassette runner constructs fresh in-memory adapters and a fresh
in-memory journal for that run.

### Trigger and ordered behavior

The maintainer selects a catalog entry and chooses **Run cassette**. The Lab
passes that exact catalog value to `runAuthoredScenarioCassette`,
`runTargetPromotionProtocolCassette`, or
`runIntegrationFinalityProtocolCassette`, according to the production catalog
that owns it. The production runner validates the story, invokes the implemented
coordinator or protocol, and consumes each declared boundary result only when
production reaches the matching interaction.
The Lab does not search ahead, append journal rows, invoke a reducer directly,
or manufacture a successful result.

When the production run consumes the terminal assertion or observation, the
Lab displays the story name, completed status, exact consumed-item count, and
the production journal records returned by the runner. The maintainer may run
the same cassette again; every runner creates fresh controlled runtime state.
The authored runner also creates a fresh journal and Run identity, so a second
authored result does not reuse the first run's state. Protocol fixtures retain
their declared identities while replaying through fresh in-memory state.

### Visible and forbidden results

The maintainer sees whether production completed or stopped, how many authored
items were consumed, and the resulting production journal. The Lab must not
label a story complete when an item remains, silently skip an unsupported item,
replace implemented production behavior with a fake reducer, or mutate the
catalog value. Controlled cassette boundaries remain visibly identified as
controlled inputs rather than real GitHub, Git, or executor processes.

### Crash and retry

Browser-process loss discards the displayed result because the Lab has no
persistence. It cannot ambiguously change an outside system. Retrying by
choosing **Run cassette** starts the whole deterministic story again with fresh
in-memory adapters; recovery inside a cassette occurs only at an authored
`CoordinatorProcessDies` item and is handled by the production runner.

### Acceptance-test mapping

- `runs every maintained cassette through production to its declared end`
  enumerates the exact three public catalogs, delegates every entry to its
  production runner, and requires complete story consumption.
- `reports the exact authored item when production cannot complete a cassette`
  runs a deliberately mismatched story and requires a visible failure rather
  than skipped input or synthetic success.
- `accepts successful recovered completion at the terminal assertion boundary`
  runs a maintained recovery story and requires its recovered coordinator and
  terminal assertions both to complete without hiding failures.
- `renders every maintained cassette and its production execution evidence`
  checks that the browser view contains each catalog key and exposes status,
  consumed-item count, controlled-boundary provenance, and journal evidence.

## A maintainer runs the whole catalog

### Starting situation and trigger

The same maintained catalog is loaded and no cassette run is active. The
maintainer chooses **Run all cassettes**.

### Ordered behavior and visible result

The Lab starts each catalog entry independently through the same production
runner used by the single-story action. A failure is retained beside its exact
catalog key and does not become a passing result. Once every entry settles, the
summary reports the exact completed and failed counts; successful entries have
consumed their complete authored stories.

There is no bounded production task concurrency claim here: this is a local
developer tool running isolated deterministic cassettes. No real boundary,
cleanup, or retry is introduced. Reloading the browser is the only cleanup and
discards all displayed results.

### Acceptance-test mapping

- `runs every maintained cassette through production to its declared end`
  is the command-independent execution proof for the whole catalog.
- `the Run all command retains one terminal result for every catalog entry`
  checks the browser update path and the exact completed/failed summary.

## A maintainer finds, follows, and diagnoses the cassette that matters

### Starting situation and trigger

A Dalph maintainer opens the Lab against one exact source revision. Forty or
more maintained cassettes may be present across authored coordinator,
target-promotion, and integration-finality catalogs. No cassette is running.
The maintainer may not already know a catalog key or which production runner
owns the behavior they need to inspect.

### Ordered behavior and visible result

The Lab first states that this is a local deterministic harness, identifies the
source revision, and says that no GitHub issue, Git repository, executor
process, or durable journal will be changed. It groups cassettes by the
production runner that owns them. A search narrows rows by human story name,
exact catalog key, category, runner, controlled-boundary description, or any
declared input value. Search words may occur separately and all must match. A
category filter and a terminal-status filter independently narrow the view.
When a match exists only inside the exact input, the row shows the matching
snippet instead of appearing without an explanation.

Each visible row makes the human story name primary and retains the exact
catalog key. The production runner and controlled boundaries appear once for
their catalog rather than repeating in every row. A collapsed declared input
shows a readable one-column sequence and retains the exact JSON under a second
disclosure; both are labelled as input, not execution proof. An evidence
disclosure is absent until a run produces a result.

When the maintainer runs one row, that row immediately stops displaying its
previous result, says that production code is running with controlled
boundaries, and disables overlapping commands. When the maintainer runs the
whole catalog, every row immediately becomes running and each row receives its
terminal result as soon as its own production runner settles; **Run shown** is
offered only for a narrowed view and runs only the rows admitted by the current
filters. Status-filtered visibility updates at each state change. The Lab does not
keep old green evidence visible and does not wait for the slowest cassette
before showing faster results. The catalog summary distinguishes not-run,
running, cassette-completed, cassette-failed, and Lab-defect counts. It explains
that cassette completion means reaching the declared end, which may include an
expected protocol failure. After a single run it no longer claims that the
whole catalog is merely ready.

A completed row shows a compact execution summary: the runner, coordinator
activations and Run identity when those concepts apply, and interpreted
journal or terminal facts. Protocol-specific counters remain under a secondary
diagnostic disclosure. Journal records appear separately, grouped by Run
identity and described as chronological only within each Run.
The complete returned object remains available only under **Raw execution
result**.

A failed cassette leads with its exact consumed count and failed item when
known, followed by a concise error. Raw cause and stack detail remain under
**Raw diagnostic**. When the typed failed result cannot return partial journal
records, the concise evidence explicitly says they are unavailable. The
aggregate result links both failed cassettes and Lab defects by human story and
exact key, clears concealing filters before focusing a linked problem, and
offers **Retry problem rows**. If the browser composition itself unexpectedly
rejects instead of returning a cassette result, the affected row and aggregate
summary show a distinct Lab defect and controls become usable again. While any
runner is still waiting, **Reload Lab and discard displayed results** provides
an explicit escape and names the local diagnostic state that it discards.

### Visible and forbidden results

Every visible label or value helps the maintainer select a cassette, understand
the safety boundary, follow current execution, verify completion, or diagnose
a stop. Category is not repeated in a prefixed title, empty evidence panels do
not appear, a journal count is not presented as correctness proof, declared
input is not presented as observed output, and an earlier result never appears
current during a rerun. Filtering changes **Run shown** but never changes which
catalog entries the explicitly counted **Run all** command executes.

Browser loss discards this local presentation state and cannot ambiguously
change an outside system. Retrying repeats the selected deterministic
cassette through fresh controlled runtime state as described above.

### Acceptance-test mapping

- `shows only information that selects, explains, or diagnoses a maintained cassette`
  checks the source/safety context, grouped hierarchy, non-repeated runner and
  boundary facts, completion meaning, hidden pre-run evidence, and readable and
  exact declared input.
- `searches declared behavior without changing the maintained run-all catalog`
  checks token-AND declared-behavior search, independent category filtering,
  and the filter-independent full-catalog command.
- `replaces stale evidence with live per-row progress and settles rows independently`
  holds two controlled UI promises, observes both rows become running, and
  observes the first terminal result before releasing the second.
- `presents concise execution proof before chronological journal and raw output`
  runs one real cassette and checks its runner, activation or protocol facts,
  journal ordering scope, exact event detail, and secondary raw result.
- `links, reveals, and retries cassette failures and Lab defects`
  injects one returned cassette failure and one unexpected rejected promise,
  then checks distinct visible states, filter-safe navigation, retry of both
  problem kinds, and recovered controls.
- `offers an explicit reload escape while a runner is still waiting` holds one
  runner promise open and checks that the isolated Lab exposes its reload
  recovery action.
