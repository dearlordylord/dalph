# Issue #336 item 4: local qualification evidence

The local `check:all` runner now admits the three independent frozen-candidate
qualification obligations through one checked-in scheduler. This is repository
qualification tooling only; it does not change a Dalph command, workflow
decision, provider boundary, Journal fact, retry, cleanup action, or
runtime-visible result. The accepted behavior remains the LQ01–LQ06 section of
[issue #336](https://github.com/dearlordylord/dalph/issues/336).

## Scenario-to-test mapping

| Accepted scenario | Implemented outcome | Passing evidence |
| --- | --- | --- |
| LQ01 — every qualification obligation passes | The local suffix admits each manifest obligation once, under the fixed cap, and succeeds only when all rows pass. | `scripts/quality-gate-qualification-scheduler.test.mjs`: `LQ01 all passing obligations respect the fixed cap and retain one canonical candidate inventory`; `scripts/gate-resume-integration.test.mjs`: `an unaffected candidate resumes proven stages with not-applicable formal evidence and no formal workflow` |
| LQ02 — one candidate has multiple ordinary failures | Proved ordinary exits and timeouts are retained as failed rows; safe siblings still run; the aggregate is rendered in manifest order. | `scripts/quality-gate-qualification-scheduler.test.mjs`: `LQ02 two ordinary failures and one pass produce one canonical fail-slow inventory`; `scripts/gate-resume-integration.test.mjs`: `local qualification collects every ordinary suffix failure in canonical manifest order` |
| LQ03 — a stage times out and cleanup is proved | The scheduler waits for the stage operation to settle before admitting the next row; a proved timeout remains failed and is never converted to pass. | `scripts/quality-gate-qualification-scheduler.test.mjs`: `LQ03 a proved timeout settles before its permit is released and preserves the timeout failure` |
| LQ04 — evidence, identity, prerequisite, or custody becomes unsafe | A non-ordinary runner/custody failure stops admission, cancels the active operation, and leaves unproven and not-run rows explicit. | `scripts/quality-gate-qualification-scheduler.test.mjs`: `LQ04 a safety failure stops queued launches and records unproven work separately` |
| LQ05 — interruption or runner death | A handled interruption stops admission and drains the active operation; queued rows remain not-run. Existing custody/status/reconciliation tests retain the abrupt-death boundary. | `scripts/quality-gate-qualification-scheduler.test.mjs`: `LQ05 interruption drains launched siblings and leaves queued obligations not run`; existing `scripts/gate-custody.test.mjs`, `scripts/gate-previous-boot-reconcile.test.mjs`, and `scripts/gate-run-status.test.mjs` |
| LQ06 — same-candidate resume and repaired candidate | Resume still selects only the canonical contiguous proven prefix; completion order cannot create reusable islands or cross-candidate credit. | `scripts/gate-resume-policy.test.mjs`: `out-of-order completion preserves canonical contiguous-prefix credit`, plus the retained prefix/refusal cases in that file |

Crash and retry fields from the Dalph operational-scenario template do not apply
to LQ01–LQ04: these scenarios contain no Dalph runtime boundary or retry. LQ05
uses the existing execution-substrate custody and reconciliation records for the
runner-death boundary. LQ06 uses the existing input identity and candidate SHA
checks; a repaired candidate has no reuse path.

## Fixed-cap memory evidence

The production cap is the checked-in `localQualificationConcurrency = 1` in
`scripts/quality-gate-stage-policy.mjs`. It is not derived from host cores or
available RAM. The campaign used candidate commit
`7881959662b3d603aa7dd0888f9720c1f21cb002` in the isolated worktree
`/tmp/dalph-item336-local` on Linux `aarch64`, Node `v24.20.0`, pnpm `10.29.3`,
12 CPUs, and 61,677,504 KiB reported host memory.

The observer command launched each pair as detached `pnpm --silent` commands and
sampled every 100 ms. A sample is the sum of `VmRSS` for every process in both
detached process trees; the reported peak is the maximum sampled sum. Each pair
had a 300-second bound, retained its child logs, and was stopped/reconciled at
the bound or on custody loss.

| Pair | Result | Peak sampled RSS | Evidence disposition |
| --- | --- | ---: | --- |
| `test:delivery-repeatability` + `test:recorded-catalog` | both passed | 2,758,979,584 bytes | complete pair proof |
| `test:delivery-repeatability` + `test` (coverage) | delivery passed; coverage attempt reached the 300-second bound; the observer’s first run lost its `/proc` race, and the repaired run encountered the exact unresolved custody fence `8eb9872c-1ecf-459f-a217-88daebba56c0` before coverage could publish a result | 1,257,062,400 bytes on the repaired observation | not proof of a safe overlap; fence reconciled as stopped/UNPROVEN |
| `test:recorded-catalog` + `test` (coverage) | catalog passed; coverage was refused by the same reconciled worktree custody boundary | 1,862,082,560 bytes | not proof of a safe overlap |

The only complete overlap proof is delivery plus catalog. Coverage overlap was
not proved safe, and issue #336 records a 7.8 GB live Vitest RSS observation.
Therefore the highest proven-safe fixed local cap is one. This is the accepted
no-overlap fallback; it still runs every independent ordinary sibling and
reports all failures together. The measurement logs and pairwise command plan
were retained during the attempt under `/tmp/dalph-item336-memory-results-*` and
`/tmp/dalph-item336-memory-plan.txt`.
