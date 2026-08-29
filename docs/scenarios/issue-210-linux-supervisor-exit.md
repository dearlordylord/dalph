# Accept Linux supervisor Exit signals at the application host

Issue: [#210 Accept supervisor Exit signals and qualify Linux automatically](https://github.com/dearlordylord/dalph/issues/210)

This file narrows the production-host and Linux evidence owned by issue #210.
It consumes, but does not change, the application-lifecycle behavior accepted
in `issue-169-graceful-application-exit.md`. `SIGTERM` is the V1 Linux
supervisor signal. A remote Operator transport, a public production CLI, a
supervisor implementation, and macOS qualification remain outside this issue.

## A Linux supervisor stops an idle Dalph host

There is no person at the trigger instant. A Linux process supervisor controls
one Dalph child. The child has installed its signal adapter in the outer
application scope and holds the coordinator lock for one exact Git common
directory. Its Run journal either does not exist or contains only ordinary Run
workflow facts. No forward-progress owner or executor responsibility is live.

The supervisor sends `SIGTERM`. The adapter submits the same transport-neutral
Exit request exposed to an in-process Operator. The application closes
admission, flushes produced writes, closes process-local resources, releases
the coordinator lock, and reports the lifecycle result through the host
diagnostic seam. Only then does the host end with status zero. Closing the
outer scope removes the exact signal listener.

If the process dies before the typed result is reported, disappearance is not
success. A later child starts with no restored Exit mode and reads only the
ordinary journal prefix. Signal receipt, listener removal, and process death
are never appended as Run workflow occurrences.

The supervisor sees a structured `Succeeded` diagnostic followed by status
zero. Dalph must not translate `SIGTERM` into Pause, Run termination, or a
journal occurrence; report success merely because the child disappeared; or
retain a signal listener after its host scope closes.

Acceptance tests:

- `an idle Linux child reports successful Exit and status zero after SIGTERM`
- `removes the Linux supervisor signal adapter when the host scope closes`
- `signal receipt, scope closure, and unexpected death leave only the ordinary journal prefix`
  runs both graceful `SIGTERM` and unexpected `SIGKILL` children and proves no
  application-lifecycle entry reaches the Run journal.

## A Linux supervisor stops running controlled executor work

The child owns one exact planned attempt and its controlled executor has
reported `ExecutorWorkExecuting`. The task-work position, worktree, claim, WIP, and journaled
responsibility remain present. No real LLM boundary exists in this controlled
host fixture. The fixture is the JavaScript application-host executable emitted
by the normal `@dalph/dalph` package build, not a TypeScript source loader. Its
planned attempt names a real Git-registered worktree at the exact committed Base
SHA, and that worktree contains a concrete uncommitted artifact.

The supervisor sends `SIGTERM`. The same Exit boundary closes admission,
records the exact suspension intent, uses the fast controlled suspension path,
and records the correlated `ExecutorWorkSafelySuspended` report. Only that report releases
the process-local task-work position. The host emits `Succeeded` and ends with
status zero while preserving the workflow artifacts and ordinary journal
evidence.

If the child dies before the report, the child does not synthesize safe
suspension. Restart follows the existing planned-attempt recovery protocol.

The supervisor sees success only after exact suspension evidence. Dalph must
not wait for executor completion, call `begin` or `resume`, manufacture a report
from signal receipt, delete the registered worktree, or change/delete its
uncommitted artifact.

Acceptance test:

- `a running controlled executor suspends before its Linux child exits zero`
  exercises the ordinary planned-attempt command protocol and observes the
  journaled suspension intent before the exact safe report and lifecycle result.
  The automated Linux test launches the built JavaScript fixture, then asks Git
  for the same registered worktree and reads its artifact after process status
  zero; both must be byte-for-byte unchanged.

## Repeated Linux signals join one stuck atomic drain

The child has admitted one atomic owner and entered a controlled section that
does not return. The section's ordinary intent is already acknowledged. The
supervisor sends `SIGTERM`, waits until the child reports that the cutoff is
closed, and sends `SIGTERM` again before the original five seconds elapse.

Every signal receipt submits the same transport-neutral request. The first
request owns the cutoff and monotonic deadline; the later request joins it. No
later action starts. At the original five-second limit, the host emits one
`TimedOut` result and ends the process with nonzero status without waiting for
the supervisor to kill it.

The supervisor sees that the elapsed drain is measured from the first signal
and sees one nonzero process result. Dalph must not start another drain, reset
or extend the deadline, infer the atomic effect's result, append an Exit fact,
or wait indefinitely for the stuck section.

Acceptance tests:

- `repeated SIGTERM joins the original stuck Linux child drain and exits nonzero at five seconds`
  proves both the stuck boundary and unchanged original deadline.

## A successor child acquires the same coordinator lock

After either the idle-success child or the nonzero forced-termination child
has ended, the supervisor starts a second child against the exact same Git
common directory. The first child no longer exists; its Run journal contains
only workflow facts committed by ordinary protocols.

The successor asks the operating-system lock boundary for ownership. It
acquires the lock and reports readiness. It does not read an Exit result or
restore the prior process-local cutoff. No retry of the prior signal applies:
signals are operating-system deliveries to one process incarnation.

The supervisor sees the successor acquire ownership. Dalph must not leave a
live coordinator-lock holder after either process status, persist lifecycle
mode into the Run journal, or require an Exit-specific recovery path.

Acceptance test:

- `a successor Linux child acquires the coordinator lock after zero success and nonzero failed or timed-out Exit`

## Deliberately deferred

Issue #211 records equivalent evidence on supported Apple hardware. This Linux
automation does not qualify macOS. A production `dalph exit` command, remote
Operator identity, configurable signal, or supervisor-owned deadline needs a
separately accepted scenario.

## Built-fixture evidence and macOS handoff

Every real-child acceptance test above launches
`packages/dalph/dist/bin/linux-application-exit-host-fixture.js`, produced by
`pnpm build` from the exact checkout. No test or manual qualification command
may substitute the TypeScript source file, a source loader, or output copied
from another commit. The host's JSON Lines output and its process status are the
observable application boundary.

After `pnpm install --frozen-lockfile && pnpm build`, a maintainer can run the
same built executable with this positional command contract:

```text
node packages/dalph/dist/bin/linux-application-exit-host-fixture.js \
  <acquire-once|failed|idle|running|stuck|stuck-repeat> \
  <git-common-directory> [journal-path|-] [planned-worktree] [base-sha]
```

`running` requires all three trailing planned-attempt facts: use `-` when no
journal file is requested, pass a Git-registered worktree containing
`dalph-preserved-work.txt`, and pass that worktree's exact `HEAD`. The fixture
reports its initial physical-work evidence, the exact fast suspension request,
the resulting journal chronology, and the application-lifecycle result. The
maintainer must still ask Git for the registered worktree and read the artifact
after the child ends; fixture output alone is not preservation proof. Other
modes accept the optional journal path and ignore the worktree/Base positions.

This executable and command contract are evidence tooling for #210/#211. They
do not add a production Dalph command, qualify macOS automatically, or change
the transport-neutral Exit behavior.

Before installing, the macOS maintainer records the exact checkout and host
facts in the attached terminal evidence:

The minimum-action path is one command from the shared repository checkout:

```sh
./scripts/qualify-macos-application-exit.sh
```

The script creates a temporary detached worktree at the exact #210 fixture
commit, records the host and tool versions below, installs from the frozen
lockfile, builds the normal JavaScript fixture, drives every real-host boundary
directly, and records its JSON lines, shell statuses, Git preservation reads,
lock successors, and measured timeout. It writes one uniquely named evidence
file under the ignored `.scratch/` directory and removes the temporary
worktree. It does not switch the maintainer's current checkout or change its
tracked files, branches, or refs. Attach the reported evidence file to #211.

The equivalent individual setup commands are:

```sh
git rev-parse HEAD
sw_vers
uname -m
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build
```

For the running-work preservation case, a maintainer prepares the physical
facts in one shell from the exact checkout:

```sh
QUALIFICATION_ROOT="$(mktemp -d)"
QUALIFICATION_REPOSITORY="$QUALIFICATION_ROOT/repository"
QUALIFICATION_WORKTREE="$QUALIFICATION_ROOT/planned-worktree"
mkdir -p "$QUALIFICATION_REPOSITORY"
git -C "$QUALIFICATION_REPOSITORY" init
git -C "$QUALIFICATION_REPOSITORY" config user.email dalph@example.invalid
git -C "$QUALIFICATION_REPOSITORY" config user.name 'Dalph Exit Qualification'
printf 'application Exit fixture\n' >"$QUALIFICATION_REPOSITORY/README.md"
git -C "$QUALIFICATION_REPOSITORY" add README.md
git -C "$QUALIFICATION_REPOSITORY" commit -m 'fixture base'
QUALIFICATION_BASE="$(git -C "$QUALIFICATION_REPOSITORY" rev-parse HEAD)"
git -C "$QUALIFICATION_REPOSITORY" worktree add \
  -b dalph/running-exit-qualification \
  "$QUALIFICATION_WORKTREE" "$QUALIFICATION_BASE"
printf 'uncommitted executor work must survive application Exit\n' \
  >"$QUALIFICATION_WORKTREE/dalph-preserved-work.txt"
QUALIFICATION_GIT_COMMON_DIRECTORY="$QUALIFICATION_REPOSITORY/.git"
node packages/dalph/dist/bin/linux-application-exit-host-fixture.js \
  running "$QUALIFICATION_GIT_COMMON_DIRECTORY" - \
  "$QUALIFICATION_WORKTREE" "$QUALIFICATION_BASE"
```

When the last command reports `{"ready":true,"pid":PID}`, a second shell sends
`kill -TERM PID`. After the first shell returns status zero, it verifies the
owning Git facts and preserved bytes with:

```sh
git -C "$QUALIFICATION_REPOSITORY" worktree list --porcelain
git -C "$QUALIFICATION_WORKTREE" status --porcelain -- dalph-preserved-work.txt
test "$(cat "$QUALIFICATION_WORKTREE/dalph-preserved-work.txt")" = \
  'uncommitted executor work must survive application Exit'
```

For idle, failed, stuck, and stuck-repeat evidence, use the same
`QUALIFICATION_GIT_COMMON_DIRECTORY`, replace `running` with the exact mode, and
omit the final three arguments. Send `kill -TERM PID` only after that long-lived
child's ready line; `stuck-repeat` sends its second signal itself immediately
after observing the closed cutoff. Do not signal `acquire-once`: it reports
`lockAcquired` and `ready`, releases the lock, and must exit zero on its own.

Immediately after each `idle`, `failed`, and `stuck` child ends, start this
exact follow-up child against the same Git common directory:

```sh
node packages/dalph/dist/bin/linux-application-exit-host-fixture.js \
  acquire-once "$QUALIFICATION_GIT_COMMON_DIRECTORY"
```

For each follow-up, attach its `{"lockAcquired":true}` line and status zero to
prove the preceding child released the coordinator lock after successful Exit
or nonzero forced termination. The maintainer records every command, JSON Line,
shell status, and monotonic elapsed time externally as the human-only #211
evidence requires.
