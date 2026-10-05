# Repository navigation

Start with the action or failed boundary, then read its owner and exact tests.
The tracker owns accepted task scope and dependencies; Git owns candidate and
integration facts. This map does not mirror issue status.

| Question | First owner | Source locator |
| --- | --- | --- |
| What must a Run, attempt, publication, or cleanup do? | [Scenario catalog](scenarios/README.md), then the named chronology | Follow that scenario's source and test mapping |
| What does a domain term mean? | [Context glossary](CONTEXT.md#language) | Search the exact term in the glossary; read [architecture](ARCHITECTURE.md#protected-compositions) for exported symbols |
| Where is delivery description, planning, or live execution composed? | [Protected compositions](ARCHITECTURE.md#protected-compositions) | The symbol/source table points directly to the current module |
| Who owns tracker graphs and claims? | [Tracker graph and claims](architecture/tracker-graph-and-claims.md) | The protocol and test links in that owner |
| Who owns journal replay and reconstruction? | [Journal and reconstruction](architecture/journal-and-reconstruction.md) | The durable-event and reducer links in that owner |
| Where do integration, publication, and finality meet? | [Attempt delivery and integration](architecture/attempt-delivery-and-integration.md) | [Direct-publication chronology](scenarios/direct-remote-publication.md) |
| Where is the live host graph page built and tested? | [Browser owners](development/browser.md#running-host-graph-page) | [Accepted graph-page scenarios](scenarios/live-task-graph-page.md) |
| Which verifier script should I inspect? | [Verification drivers and callers](development/tooling.md#verification-drivers-and-owners) | Start with the invoked driver, then its imported policy |
| Which check should I run, and does it need a build? | [Choosing checks](development/checks.md#choosing-checks), then [command preparation](development/commands.md#focused-test-preparation) | `package.json` owns the actual command |
| Where is failure evidence, and may I retry? | [Finite diagnosis](development/workflow.md#keeping-implementation-work-finite) and [gate custody](development/gates.md#heavy-gate-admission) | `pnpm gate:status <run-id>` and retained child logs |
| Which model owns this runtime boundary? | [Quint guide](QUINT-GUIDE.md) | Its model-family and runtime/test mapping |

Use `rg -n -F '<term or symbol>' <owner>` before opening a whole reference.
The glossary is vocabulary; scenarios own chronology and architecture owns
composition. Read only the owner needed for the current question.

## Current guidance and evidence

Remove superseded instructions and repair their incoming links; Git preserves
history. Keep an evidence note only while it supports a current acceptance or
audit question. It must identify the exact candidate, observation date, command
or review boundary, and limits before presenting a passing result. Protocol-only
tests do not prove production composition; one commit's passing gate does not
qualify another commit. Current scenario-to-test mappings stay with scenarios.

## Documentation check

Run `pnpm check:docs` after documentation changes and source renames/deletions.
The checker scans maintained Markdown against the current tree, including
unstaged new documents. It uses pinned Lychee with offline local-file and heading
checks; it cannot prove that a named test exercises the claimed behavior.
See [checker setup and scope](development/commands.md#documentation-links).
