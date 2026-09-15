# Issue 170: run and record the maintained cassette catalog

This file records the implementation scope accepted for issue #170. It
specializes the issue #165 cassette scenarios without changing Dalph's tracker,
Git, executor, journal, retry, cleanup, or recovery behavior.

## A maintainer runs the maintained singleton story

A Dalph maintainer imports the checked-in singleton cassette. One tracker task
A is open, no task is claimed, its planned worktree is absent, the same-process
fake executor has no prior report, and the in-memory journal is empty.

The story begins with production `InitialControlPolicy` at task-execution
capacity one. The maintainer asks Dalph to coordinate the story's tracker
target. The story does not provide a `RunId`; Dalph applies its production
fresh-run identity rule. It schema-encodes the one exact tracker target together
with fresh UUID material, then puts that payload behind Dalph's versioned,
reversible Base64URL representation. The representation is deliberately not
encryption or a security boundary. The cassette runner supplies the ordinary
tracker, claim, Git worktree, executor, trace, and journal implementations and
invokes the production coordinator activation program.

Starting the same tracker target again creates a different `RunId`. The
maintainer sees an opaque value that does not expose a fixture locator or
GitHub owner, repository, and issue number as readable fields. Ordinary
journal, planner, executor, and activation consumers compare and carry that
exact value without interpreting its text. When debugging genuinely requires
the embedded information, the maintainer can pass the value to the fresh-run
diagnostic decoder and recover the exact structured target and freshness
material. A foreign, malformed, schema-invalid, or unsupported-version value
produces one typed diagnostic decode failure instead of guessed target facts.
Because this representation has no integrity check, changing one valid encoded
payload into another valid encoded payload is outside its opacity-only
contract.

There is no outside identity service, network request, or durable append in
allocation or diagnostic decoding, so an ambiguous boundary outcome and
reconcile-before-retry do not apply. If allocation is requested again after a
failure or process loss, Dalph creates a new fresh identity; it does not infer
that an unrecorded value identifies a durable run. Diagnostic decoding changes
no state, so retrying it repeats only the same pure validation.

Each registered cassette surface may consume only the current story item. A
Dalph-selected operation must match the current expected operation before the
story advances, and a tracker or executor response is returned only when its
tag and attempt match the current production interaction. The runner cannot
search ahead, append a journal row, invoke a reducer, assign reconstructed
state, or select work.

After Dalph records the terminal coarse executor report, the story reaches its
one final cassette-only assertion group. Its specialist-facing task-work
result says that A's planned work completed, without naming the attempt, and
its absence assertion says that Dalph undertook no planned work for B. The
runner derives both from Dalph's journaled handling rather than provider input.
The story omits optional orchestration and protocol evidence; their omission
does not remove those occurrences from the journal or relax chronological
consumption of explicitly authored interactions. The separately accepted
abstraction-level scenarios define those lenses.

There is no real GitHub, Git process, executor process, SQLite, network loss,
crash, or retry in this deterministic story. Rerunning creates fresh controlled
boundary layers and an empty in-memory journal. The maintainer sees the
readable story and a matching terminal result. Dalph must not continue into
tracker completion, integration, or whole-graph convergence.

Acceptance tests:

- `runs the maintained singleton through production activation and stops at
  terminal executor work`
- `runs another story with a different initial task-execution capacity`
- `assigns a fresh exact run identity each time the same tracker target starts`
- `assigns distinct opaque fresh run identities and diagnostically restores the
  exact target`
- `rejects malformed fresh run identities through one typed diagnostic
  failure`
- `requires one terminal assertion group and one owner for every decoded story
  item`
- `runs the maintained singleton through production activation and describes
  only its task-work result`
- `rejects cassette-local contradictions and leaves an authority mismatch to
  its ordinary boundary`

## A story names a live capacity change

Issue #170 deliberately left the decoded capacity-change item unsupported.
Issue #54 now supplies the production protocol and chronological scenarios. In
an authored story, the controlled Operator applies the item through the same
revision-checked journal service used by production. The next scheduling cycle
reads that durable revision and resizes the ordinary process-local admission
controller without interrupting a holder.

Acceptance test:

- `lowers capacity while A holds a position and admits B only after A releases
  it`

## A journal is recorded and checked after every occurrence

After the singleton completes, the maintainer projects each journaled
occurrence meaning into one recorded entry in the same order. For every
non-empty prefix, Dalph separately compares reconstructed operational state,
complete workflow history, the applied occurrence position, and the result of
the pure selector.

Dalph-generated run, operation, attempt, command, planned-branch, planned-
worktree, and claim-token values may be renamed only by exhaustive typed
renamers that preserve their causal relationships. Tracker identities and
revisions, task revisions, and Git commit SHAs are never renamed.

In the illegal-order case, executor-work responsibility and the first `ExecutorWorkExecuting`
report both appear before worktree readiness. The final operational state can
converge, but workflow history and an earlier selection checkpoint still
disagree. No outside call, crash, or retry occurs during this pure projection.

An empty journal has no recording because it carries no `RunId`; recording
begins with the first occurrence. The cassette projector never invents an
identity for empty input.

Acceptance tests:

- `projects every occurrence and checks state, history, position, and selection
  after every non-empty prefix`
- `alpha-renames every Dalph-generated identity and preserves tracker
  revisions, task revisions, and Git SHAs`
- `detects responsibility and ExecutorWorkExecuting before worktree readiness even when
  final operational state converges`
- `has no recording for an empty unidentified journal`

## Maintainers retain size and stress baselines

The 100-task/four-read encoding experiment remains a regression-visible
baseline only. It makes no production-representativeness, delta, compression,
or content-addressing claim.

The ordinary occurrence-projection test retains 3,000 intent/observation
pairs. A non-coverage performance test retains the 10,000-pair signal. Normal
tests use four workers; coverage uses two and excludes the performance signal.
These checks change no Dalph runtime behavior, outside call, durable fact,
crash, or retry.

Acceptance tests:

- `labels the 100-task four-read encoding experiment as a baseline`
- `projects a large journal without rescanning each retained prefix`
- `preserves the 10,000-pair non-coverage projection signal`
