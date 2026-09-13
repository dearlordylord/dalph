# Local formal qualification after the execution timeout

The maintainer ran the complete local formal profile on the integration
candidate. Fifty-five commands passed, a verifier timed out at the shared
720-second deadline, and 49 commands did not start. Two sampled checks spent
524.154 seconds in total, including 516.69 seconds inside the Rust evaluator.
Every owned process stopped and no complete success was published.

On 2026-09-13 the maintainer explicitly authorized continuing this feature
despite Quint problems and increasing a timeout when necessary. A successful
fresh execution is necessary for #362's requested fresh/warm measurements.
This authorization supersedes the prior prohibition on increasing the local
execution allowance. It does not turn the earlier failure into success or
authorize omitting checks. Hosted CI policy remains unchanged.

## Maintainer runs the complete local profile with a longer allowance

- **Starting facts:** the supported Linux integration worktree has coherent
  identified tools, no unresolved children, and no qualifying success for the
  new effective profile. Git records the candidate and base. GitHub is only
  the task tracker; Dalph execution sessions and journal do not participate
  because this is repository tooling.
- **Trigger:** the maintainer invokes `pnpm check:quint`, or local handoff
  requests the same complete formal requirement after preflight.
- **Boundary calls:** acquire existing admission, identify and observe all
  inputs, record intent, start the identified owned server, and run all 105
  commands with the existing 42 scheduling/provenance steps. Server readiness
  and checker execution share one decreasing 1,800-second local deadline.
  The local regression allowance is 1,850 seconds. The helper envelope is
  1,857 seconds and acquisition has one decreasing 2,100-second outer bound.
  Existing preparation, input setup/qualification and final validation phase
  caps remain; termination and process-group absence retain 5+2 seconds.
- **Visible result:** only complete required verdicts, stopped children and
  unchanged observed inputs permit success. Effective local timing policy is
  part of profile identity. An old-policy record cannot qualify the new one.
- **Forbidden result:** do not shorten samples, steps or command membership;
  do not reset the deadline between children, accept partial success, relax
  observation, or inherit the longer deadline in hosted CI.
- **Crash/retry:** existing intent, failure invalidation and reconciliation
  apply unchanged. An expired deadline fails and cleans up. There is no
  automatic benchmark retry or further automatic budget increase.
- **Acceptance tests:** effective-profile tests prove identical commands and
  scheduling under different local/hosted timing policies; deadline tests
  prove decreasing remaining time and refusal after expiry; local workflow
  tests prove the local helper receives the recorded policy while hosted
  contract tests retain the literal 16-minute job and 720/750-second policy.
  A fresh real invocation then measures this finite policy; if it fails,
  record the failure and diagnose/fix its cause as the maintainer explicitly
  requested, without calling it a successful F or collecting purported warm
  reuse samples.

The 1,800-second execution allowance is a finite provisional qualification
ceiling, not a predicted runtime. It provides 2.5 times the exhausted original
allowance for the unchanged full inventory, which had reached only 56 of 105
commands. Actual completion and headroom remain to be measured. The outer
2,100 seconds contains the 1,857-second helper envelope and three 60-second
control caps with remaining overhead; it is not an independent allowance
reset for each phase. Final handoff validation keeps its separate 30 seconds.

## Hosted verification continues with its existing limits

When GitHub Actions invokes `check:ci:formal`, the raw complete checker retains
the original 720-second execution deadline, 750-second regression allowance
and 16-minute hosted job cutoff. It cannot reuse local evidence or select the
longer local timing policy from ambient environment values. Existing hosted
contract and deadline tests prove this separation. No new hosted crash or
retry behavior is introduced.
