# Historical candidate-agent implementation

Issue: [Build the exact two-parent integration candidate](https://github.com/dearlordylord/dalph/issues/57)

Status: implemented on `master` in a9eec76cb and closed completed on
2026-08-14. The implementation is superseded by issue #222 because it exposes
candidate construction, correction, and continuation as Dalph-owned stages.

The issue comments and repository history retain the original scenario-to-test,
cassette, model, review, and verification evidence. This file is historical
evidence only. It does not authorize new implementation or imply that the
candidate-agent boundary remains the target architecture.

The retained facts are the isolated session/resource, explicit candidate
identity, and Git proof of ordered parents `[H, C]`. The replacement chronology
is in `issue-222-introduce-outer-integrator.md`; retry and quarantine behavior is
in the issue #68 scenario.
