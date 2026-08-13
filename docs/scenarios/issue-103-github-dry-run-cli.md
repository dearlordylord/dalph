# Issue #103: expose GitHub tracker targets through the dry-run CLI

Issue: [Expose GitHub tracker targets through the dry-run CLI](https://github.com/dearlordylord/dalph/issues/103)

These scenarios make the accepted #103 CLI behavior chronological. They consume
the provider-neutral complete-observation and repeated-read contracts from
#164 and #53, and the real GitHub closure behavior qualified by #71. The
operator surface adds no GitHub claim or lifecycle mutation. The dry-run
composition has a read adapter and a controlled fixture workflow, but it does
not install a tracker mutation capability for the GitHub path.

## Alice reads one live GitHub target closure from the ordinary dry-run command

### Starting situation

Alice has a GitHub issue root identified by owner `octo`, repository `dalph`,
and issue number `42`. `GITHUB_TOKEN` is available to the process. GitHub owns
the issue identity, lifecycle, grouping, prerequisite edges, and the complete
target closure; no Dalph claim, lifecycle mutation, Git worktree, executor
session, or workflow-journal responsibility exists for this CLI invocation.
The process has the production `githubTrackerGraphReaderNodeLayer` available,
and no `TrackerMutation` capability is installed in the dry-run application.

### Trigger and chronological behavior

1. Alice runs `dalph run github:octo/dalph#42 --dry`. The CLI receives one raw
   target argument and first checks the explicit `github:` target syntax. It
   decodes that argument once at the CLI boundary into one branded
   `GithubIssueTarget`; the fixture decoder is not tried after a recognized
   GitHub prefix.
2. The command selects the read-only GitHub graph reader for that typed target.
   The reader resolves the repository and issue, follows the bounded
   `subIssues` and `blockedBy` pages, and returns the provider-neutral complete
   normalized closure or a typed read failure. Pagination, cursors, and raw
   GraphQL records do not enter the CLI trace.
3. The dry interpreter records one `OperationSelected` and then one complete
   `TaskTrackerFactsObserved` trace item for the same target and normalized
   snapshot. The invocation ends after the read; it does not ask for focused
   task work, acquire or release a claim, change lifecycle, or invoke Git,
   executor, or journal authority.

Alice sees the normalized live graph observation (or a typed GitHub read
failure). Dalph must not silently read a fixture, publish a partial closure,
infer missing blockers, guess a different target syntax, or expose any tracker
mutation authority to the GitHub dry-run path.

There is no applicable crash-retry protocol for a CLI-only read composition:
the invocation has no ambiguity-crossing mutation or durable local effect to
reconcile. A provider read may use the bounded retry and complete-read rules
already owned by #71, #164, and #53; a failed logical read remains a typed
failure and never authorizes a mutation.

### Acceptance test

`decodes a GitHub issue target once and reads it without tracker writes` proves
the single typed target delivered to the reader and the read-only trace shape.
`selects the production GitHub reader for an explicit GitHub target` proves the
application router chooses the injected production-reader seam rather than the
fixture reader. The `DryApplicationRequiresOnlyStdio` type assertion and the
same test's failing focused-read sentinel prove that no tracker mutation or
focused task-work authority is needed by this path.

## Alice keeps fixture targets on the fixture adapter

### Starting situation

Alice has an existing fixture locator such as a path to
`orchestrator/fixtures/singleton.json`. It is not a GitHub target and may have
no `GITHUB_TOKEN`. The fixture reader owns the serialized normalized task graph
for this dry-run; the GitHub reader must not be consulted.

### Trigger and chronological behavior

1. Alice runs `dalph run <fixture-locator> --dry`. The CLI sees no explicit
   GitHub prefix and decodes the value once as a branded `FixtureTarget`.
2. The application routes the fixture target to the fixture graph reader and
   runs the existing controlled dry workflow, preserving its deterministic
   planner and trace behavior. It never guesses GitHub ownership from a path,
   repository-looking text, or a failed fixture read.

Alice sees the established fixture dry-run trace. Dalph must not redirect an
ordinary fixture to GitHub, require a token for it, or change fixture behavior
   merely because the live adapter is registered.

There is no crash or retry boundary specific to target selection: no external
mutation occurs before the selected fixture read, and a fresh invocation can
repeat the same fixture read. Fixture reader failures remain the existing typed
fixture failures.

### Acceptance test

`runs the complete dry CLI with only Stdio left to supply` preserves the
existing fixture trace, and `replaces fixture reads at the complete dry CLI
boundary` proves an injected fixture reader receives the fixture target rather
than the GitHub reader.

## Alice can discover and correct a missing GitHub token

### Starting situation

Alice has the explicit target `github:octo/dalph#42`, but `GITHUB_TOKEN` is
absent. The command still has the production read-only adapter registration;
there is no tracker mutation capability that could be used as a fallback.

### Trigger and chronological behavior

1. Alice asks for `dalph run --help` (or `dalph run <target> --help`). The CLI
   help names the GitHub target form and states that GitHub targets require
   `GITHUB_TOKEN`.
2. Alice runs `dalph run github:octo/dalph#42 --dry`. Adapter-layer
   configuration fails before a GitHub request can begin. The application maps
   that missing configuration to the typed `GithubTokenRequiredError`, naming
   the exact variable. It does not fall back to a fixture or claim that the
   target was read.

Alice sees actionable help or a typed startup failure identifying
`GITHUB_TOKEN`. Dalph must not print a raw configuration stack, silently use a
fixture, issue a tracker mutation, or expose a token value.

No retry is applicable to missing process configuration; Alice must provide
the variable and start a new invocation. No crash-recovery protocol applies
because no external effect was attempted.

### Acceptance test

`advertises the GitHub token requirement in run help` checks the operator help,
and `reports the missing GitHub token as a typed startup failure` checks the
typed variable name and the no-fixture route.

## Scenario-to-test mapping

| Scenario | Concrete result | Acceptance test |
| --- | --- | --- |
| Alice reads one live GitHub target closure | One explicit target is decoded once, routed to the production read-only graph reader, and observed as one complete normalized closure with no tracker mutation | `decodes a GitHub issue target once and reads it without tracker writes`; `selects the production GitHub reader for an explicit GitHub target` |
| Alice keeps fixture targets on the fixture adapter | A non-GitHub locator remains a fixture target and preserves the controlled fixture dry workflow | `runs the complete dry CLI with only Stdio left to supply`; `replaces fixture reads at the complete dry CLI boundary` |
| Alice discovers and corrects missing configuration | Help and startup failure identify `GITHUB_TOKEN`; no fixture fallback or tracker mutation is attempted | `advertises the GitHub token requirement in run help`; `reports the missing GitHub token as a typed startup failure` |
