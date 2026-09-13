# Dalph design research

This worktree carries the research notes created in the invoker/invokee
conversation. Research is evidence, not accepted runtime behavior.

- [Command, graph subscription, and MCP process validation](./invokee-attachment-validation.md)
- [SQLite command interruption results](./invokee-command-interruption-results.md)
- [Live graph subscription results](./invokee-graph-stream-results.md)
- [MCP process cancellation and reconnection](./invokee-mcp-process-results.md)
- [Real-host disconnection/reconnection evidence](./invokee-real-host-results.md)
- [Earlier targeted-validation findings](./invokee-validation-round.md)
- [Research continuation and targeted validation](./invokee-research-next.md)
- [Runnable hosting experiment](./prototypes/invokee-hosting/README.md)
- [MCP lifecycle and SDK cancellation probe](./invokee-mcp-lifecycle.md)
- [Command response-loss and cancellation semantics](./invokee-command-semantics.md)
- [Task graph observation evidence](./invokee-graph-observation.md)
- [Actual host lifetime validation](./invokee-host-lifetime-validation.md)
- [Hosting research](./invokee-hosting-research.md) and [experiment evidence](./invokee-hosting-results.md)
- [Consolidated first invokee milestone](./invokee-first-milestone.md)
- [Active invoker/invokee interview](./invoker-invokee-interview.md)
- [Agent-operated Dalph design exploration](./agent-driven-dalph.md)
  ([MCP evidence](./agent-driven-mcp.md),
  [executor alternatives](./agent-driven-executors.md),
  [repository assessment](./agent-driven-repo-assessment.md))
- [Codex managed-worktree assessment](./codex-managed-worktrees-assessment.md)
  ([local CLI probes](./codex-managed-worktrees-local-probes.md))
- [Human interaction with workers](./agent-human-interaction.md)
- [Recursive planning and task publication](./recursive-planning.md)

The investigations inspected the original workspace at
`/workspace/typescript/dalph`, including its existing uncommitted changes.
This interview worktree starts from master commit
`76696349e30912e5d71c5f649aeee4d06e90d9ff`; source findings must be rechecked
against this baseline before implementation. Unrelated source-workspace edits
were not transferred. Temporary offline probe artifacts remain at the exact
paths recorded in the probe note.
