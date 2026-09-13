# Throwaway MCP cancellation probe

Question: does the installed real MCP SDK signal cancellation to a running tool
handler on explicit request cancellation and on connection closure?

Run from the interview worktree:

```sh
node research/prototypes/invokee-mcp-lifecycle/run.mjs
```

The default SDK location is the existing sibling Dnd installation. An alternative
installed SDK package directory can be supplied as the first argument. Nothing
is installed and no dependency manifest is changed. This run used SDK 1.29.0.

Both cases passed: a started handler's initially un-aborted signal was aborted,
and the client request rejected. The output reports each observation.

This uses the SDK's in-memory linked transports and real initialization/tool
request handlers. It has no Dalph host, external agent, OS process, HTTP server,
or persistent state. It establishes SDK cancellation behavior only. See the
[research note](../../invokee-mcp-lifecycle.md) for source evidence and limits.
