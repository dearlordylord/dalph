# Dalph research index

This directory retains research that is still actively useful to current
Dalph work. Research is evidence, not product authority. Accepted issues,
operational scenarios, architecture pages, ADRs, and executable specifications
own requirements and behavior.

Completed plans, implementation reports, superseded decisions, predecessor
Ralph design assets, redundant competitor syntheses, and abandoned experiments
are preserved by Git history and, where useful, summarized on their owning
GitHub issues rather than kept in the active documentation tree.

## Agent-runtime and Codex evidence

- [Agent-runtime observation capability matrix](./issue-5-agent-runtime-observation-capability-matrix.md)
- [Codex CLI executor integration research](./codex-cli-executor-integration-research.md)
- [Codex app-server integration lifecycle](./codex-app-server-integration-lifecycle.md)

These documents record current provider capabilities and limitations. They do
not expand the accepted generic executor or Integrator boundaries.

## Competitor source audits

- [Competitor reliability architecture cards](./cards/README.md)
- [Pinned competitor source index](../.references/COMPETITORS.md)

Each card is a fixed-revision source audit. No crash experiment was completed,
so restart and failure claims remain explicitly source-inferred.

## Executable verification research

- [Verification bake-off](./verification-bakeoff/README.md)

The bake-off remains because its Markdown explains maintained executable
models, generated mappings, negative controls, and proof-tool comparisons.

## Maintenance rule

Add research here only while it remains a current input, a maintained
executable artifact, or evidence that has not yet been captured by its owning
issue or canonical documentation. Once an issue records the durable conclusion
and implementation no longer consumes the report, remove the report from the
active tree; Git history remains the archive.
