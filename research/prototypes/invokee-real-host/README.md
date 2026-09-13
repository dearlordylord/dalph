# Disposable real-host disconnection experiment

Status: passed on 2026-09-13, including independent parent rerun and source review. This does not
change Dalph production code or add a supported attachment API. Its small HTTP
observation adapter exists only inside the disposable host callback.

Question: can the existing real host continue actual task delivery while an OS
observation client disconnects, and can another client observe the same Run?

## Chronology and evidence required

Alice's disposable repository starts with a real Git base commit, one controlled
open tracker task, no claim, no executor, and a new SQLite journal. The unchanged
production host owns its coordinator lock, workflow, exact task worktree and
executor adapter. GitHub and Codex process/network edges are controlled fixtures.

1. Start the real host and hold a controlled executor response while its task is
   in progress. Record the selected Run and actual journal/task evidence.
2. Launch a separate OS client. It receives a current observation through the
   disposable HTTP adapter; wait for its stdout observation before proceeding.
3. Terminate that client and observe process exit. This must not end the host
   callback or request Dalph Exit.
4. Release the controlled executor response. Observe actual downstream delivery
   and journal progress, not a synthetic timer or fake task-status counter.
5. Launch another OS client. It observes the same Run and later delivery state.
   Verify coordinator ownership was not duplicated.

Forbidden results: passing before the first client really observes state;
synthetic ticks mistaken for delivery; releasing the host and recovering a Run
mistaken for uninterrupted delivery; orphan client processes or scratch Git
resources after the experiment settles.

The assertions in `host-probe.test.ts` map these steps directly to evidence.
No actual provider account, user repository, or native interactive agent is
used. Host crash recovery and command cancellation are separate experiments.

## Run

From the interview worktree root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-real-host/vitest.config.ts
```

The dedicated config resolves existing packages to unchanged source and includes
only this research probe. It does not alter the production test configuration.

## Executed result

The independent run passed one experiment in 5.41 seconds (24.68 seconds including
source transformation/import). First client: accepted journal position 16, then
SIGTERM exit. Fresh snapshot client: position 58, normal exit, same Run. One
coordinator acquisition, one Run beginning, zero application Exit requests.
Persisted records prove accepted executor result, integration candidate result,
candidate Git commit observation, successful target promotion and focused
tracker completion confirmation. The Run termination disposition is Completed.

The host fiber remains live through reconnect. Only then is its callback
released and joined, closing the observation server and host resources. The
SQLite evidence reader has its own closed scope. Both client exits are awaited,
and the exact fixture directory is removed and checked absent.

This resolves the requested five-step composition question with the existing
host and controlled providers. It does not qualify a production attachment API,
MCP transport, live Codex process, or host crash recovery. `/watch` emits one
current snapshot and holds the connection; it does not subscribe to later
runtime publications. Real-time streaming is not demonstrated.

The host runs from unchanged TypeScript source using the dedicated aliases.
The fixture also requires the existing `packages/dalph/dist/bin/dalph.js` artifact
for its manifest digest only; that binary is **not executed**. Dependencies and
that artifact were already present in this worktree. In a fresh checkout, follow
the repository's normal install/build setup before running this probe.

See [full evidence and interpretation](../../invokee-real-host-results.md).
