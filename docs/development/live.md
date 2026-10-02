# Protected live qualification

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

### Protected disposable live qualification

Alice dispatches [Production live qualification](../../.github/workflows/production-live-qualification.yml)
only for one accepted candidate and one dedicated disposable repository. The
dispatch supplies `candidate_sha`, `reviewed_base_sha`, and `repository`; the
first two values must each be exactly 40 lowercase hexadecimal characters.
The workflow checks out that candidate, verifies the reviewed Base exists,
and first asks GitHub Actions whether the exact candidate already has one
completed successful workflow named `CI`. A failed, running, cancelled,
wrong-SHA, or differently named workflow stops the dispatch before any formal
worker or protected-environment approval starts. It does not poll. After that
preflight succeeds, the workflow installs with pnpm 10.29.3 on Node 24.20.0
and runs `pnpm build` before any controlled-provider credential is generated.

The workflow has one constant concurrency group,
`production-live-qualification`, with `cancel-in-progress: false`, regardless
of dispatch ref or SHA. The `qualify` job requires approval from the protected
GitHub environment named `production-live-qualification`. Its one protected
secret, `DALPH_LIVE_GITHUB_TOKEN`, is mapped only into the single live-command
step and is scoped to issue and label mutation in the configured repository.
Ordinary CI never invokes this command.

Four matrix jobs after that preflight capture shards 0 and 1 for both the dedicated ARM
profile and the two-CPU stressed profile with `pnpm check:ci:formal:shard`.
Their reports and provenance files are downloaded by the approved job. Each
formal job records its setup/install duration and binds the SHA-256 digest of
its relative `report.json` to its profile, shard, and measured execution
condition; it never publishes the worker's absolute report or home path.
Before the live command, the approved job uses the current repository's
automatic Actions token (`GITHUB_TOKEN`, with only `actions: read`) to resolve
exactly one successful numeric Actions job ID for each of the four formal jobs in this run
attempt. It derives each complete-job duration from that successful Actions
job's `started_at` and `completed_at`; unlike a timestamp written by the formal
job itself, this interval covers provenance generation and the final formal
artifact upload. The literal 16-minute job timeout and this resolved duration
prove the complete-job limit. That token is used only for this read; it is not
the disposable repository credential.

The checked-in controller receives the downloaded evidence locators, the
candidate-bound source SHA, branded workflow/run/job/protected-environment
provenance, and these strict formal/output locators:

```text
DALPH_LIVE_QUALIFICATION_SOURCE_SHA
DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY
DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA
DALPH_LIVE_QUALIFICATION_BUILT_ENTRY
DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY
DALPH_LIVE_QUALIFICATION_LOCKFILE
DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE
DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER
DALPH_LIVE_QUALIFICATION_WORKFLOW
DALPH_LIVE_QUALIFICATION_RUN_ID
DALPH_LIVE_QUALIFICATION_JOB_ID
DALPH_LIVE_QUALIFICATION_MANIFEST
DALPH_LIVE_QUALIFICATION_ARTIFACT
DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS (under DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER)
DALPH_LIVE_QUALIFICATION_FORMAL_ROOT
```

The root command is:

```bash
pnpm qualify:production-live
```

Before that one launch, the wrapper creates the absolute manifest file with a
fresh invocation and issue-operation identity, the exact candidate/Base and
hosted provenance, the shipped `packages/dalph/dist/bin/dalph.js` entry, the
lockfile/Codex locators, the outside-Q artifact and retained-report locators,
and the two exact two-shard formal profiles processed by the built provenance validator. The
controller locator (`packages/dalph/dist/bin/production-live-qualification.js`)
is intentionally separate from the shipped Dalph entry. The retained report is
under the pre-created publication container and remains distinct from the
qualification artifact.

It validates `DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION=1`, the exact checked-out
candidate, the reviewed Base, the protected environment, the provenance shape,
the formal evidence files, and the built entry
`packages/dalph/dist/bin/production-live-qualification.js`. It then starts that
controller once with one absolute `--manifest` locator. The controller owns
fixture creation, the one shipped production Run, build/hash/provenance
evidence, exact cleanup, and the redacted artifact; this wrapper has no retry
or resume path. As soon as Q's GitHub issue exists, the controller writes its
exact redacted remote locator to `retained-locators.json`; after local setup it
atomically replaces that checkpoint with the complete remote/local retained
set before starting the shipped child. Outer cancellation can therefore upload
the last completed disposition checkpoint even when the controller never
returns. A successful final publication removes the stale checkpoint. The
controller generates a fresh random throwaway credential for the admitted
shipped child, binds it only to the
isolated `CODEX_HOME` config under
`DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL`, and passes that value only to the
controlled shipped child. The outer runner resolves the locked Codex JavaScript
entry once and carries that exact locator in the safe manifest. Its Bash observation wrapper starts the locked Codex
JavaScript entry with the wrapper locator retained as `argv[0]`; the ownership
census can therefore still identify and signal the exact detached app-server
after pnpm's ordinary shim would have replaced that identity with `node`. The
outer validator requires that derived locked JavaScript entry to be a readable
nonempty file before it launches the controller, and the generated wrapper
rereads it immediately before `exec`.
A failed or ambiguous provider boundary therefore leaves the Run and exact
retained locators for manual inspection rather than launching a second command.

The controller records the complete local fixture checkpoint, measures the
build, then runs the [accepted exact-launch probe](../scenarios/protected-live-launch-preflight.md)
through the existing Codex app-server owner. It uses the generated wrapper and
the fixture's `CODEX_HOME`, observes the effective argv and process identity,
and requires exact close before admitting the shipped child. The probe gets a
minimal environment without the controller's GitHub secret. It has a
15-second local bound inside the protected job's existing deadline. Its process
start is recorded separately inside the private fixture directory; the task
app-server count remains one. A failed or uncertain probe leaves the exact
fixture locators retained and admits no shipped child.

After the live command settles or the hosted job cancels it, an `if: always()`
step reads the latest retention checkpoint. It writes `diagnostics.json` with
only the checkpoint phase and disposition counts, durable journal event-kind
chronology, app-server start count, and hosted run identity. It never copies
journal payloads, GitHub node IDs, prompts, responses, credentials, private
Codex state, or runner-local locators. The final step uploads
`qualification.json`, `retained-locators.json`, and `diagnostics.json` with
`if: always()`, so a successful result and a failed live attempt use the same
explicit redacted artifact boundary. A successful final qualification omits
the not-qualified diagnostics file. It does not upload the controller
manifest or a pre-cleanup snapshot: those contain private absolute workspace or
temporary locators and are local controller inputs, not publication artifacts.
The uploaded artifact must contain no credential, raw environment,
provider-private session, prompt, response, raw Actions API payload, or private
absolute workspace/home locator. The disposable-repository secret remains named
`DALPH_LIVE_GITHUB_TOKEN` until the runtime maps it to the shipped child’s
`GITHUB_TOKEN` boundary. `CODEX_HOME` contains the controlled fixture config;
`codexExecutorPrivateStateDirectory` contains only Dalph-owned attempt and
app-server ownership state. The generated provider value is never serialized or
logged.

The focused contract mapping is:

| Scenario | Acceptance test |
| --- | --- |
| Alice dispatches a candidate whose exact `CI` workflow is failed, running, cancelled, absent, or successful only for another SHA; the preflight fails before formal work or environment approval. An exact completed successful `CI` permits the formal dependency. | `scripts/run-production-live-qualification.test.mjs`: `blocks formal qualification unless exact candidate CI is completed and successful`, `permits formal qualification after exact candidate CI completed successfully`; `scripts/production-live-qualification-workflow.test.mjs`: dependency-order assertions in the four-shard case |
| Alice's approved workflow is manually dispatched with exact candidate/Base inputs, one serialized lane, Node 24.20.0, build, and dedicated/stressed evidence; each shard records Node's unprefixed runtime version while the resolver rejects the `v24.20.0` spelling that caused run 34837785947 to fail; GitHub's successful whole-job timestamps prove each job finishes below its 16-minute cutoff after its final upload | `scripts/production-live-qualification-workflow.test.mjs` exact worker toolchain case; `scripts/run-production-live-qualification.test.mjs` v-prefixed hosted-metadata negative control, successful timestamp derivation, and 16-minute rejection cases |
| The command rejects missing opt-in, malformed inputs, or a changed candidate before any provider child starts | `scripts/run-production-live-qualification.test.mjs` validation cases |
| The built controller receives one manifest locator and secrets only through one child launch | `scripts/run-production-live-qualification.test.mjs` exact launch case |
| Uploaded formal provenance and live failure evidence disclose no private absolute worker/controller locator | `scripts/run-production-live-qualification.test.mjs` absolute formal-log rejection case; `scripts/production-live-qualification-workflow.test.mjs` manifest/pre-cleanup exclusion case |
| A child/provider failure is reported without a retry and without secret bytes in the wrapper error | `scripts/run-production-live-qualification.test.mjs` single-launch failure case and workflow artifact `if: always()` contract |
| The disposable issue exists but later local setup or the shipped command never returns; the always-upload step receives Q's latest exact retained-resource checkpoint rather than no artifact. An interruption during checkpoint replacement leaves the prior complete checkpoint intact. | `packages/dalph/test-support/production-live-qualification-runtime.test.ts`: `persists the exact remote fixture before local setup or the shipped child can stall`, `an unfinished recoverable Run retains every exact local locator for manual cleanup`, `preserves the prior valid checkpoint if replacement is interrupted` |
| The hosted job cancels the live command after its Execution checkpoint. Before the runner disappears, the always-run diagnostic step reads that checkpoint and the retained SQLite/app-server observation files. The uploaded diagnostic identifies the checkpoint phase, ordered journal event kinds, and number of app-server starts without copying runner paths, journal payloads, prompts, responses, resource IDs, or credentials. If no checkpoint exists, it reports that fact; after a final qualified artifact, it publishes no contradictory not-qualified diagnostic. | `scripts/run-production-live-qualification.test.mjs`: `hosted cancellation diagnostics retain progress without locators, payloads, prompts, or credentials`, `hosted diagnostics distinguish a missing checkpoint and do not misreport successful qualification`; `scripts/production-live-qualification-workflow.test.mjs`: always-run capture and uploaded diagnostics assertions |
| The generated Codex wrapper starts the exact locked JavaScript entry and remains signalable as the recorded wrapper process; a missing entry fails before any process observation. | `packages/dalph/test-support/production-live-qualification-runtime.test.ts`: `production live qualification fixture separates Codex home from executor private state`, `the generated wrapper fails before process observation when its locked entry is missing` |
