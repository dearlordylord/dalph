# Remaining issues before the Effect Workflow evaluation

Snapshot date: 2026-07-29, at
[`master` commit `0f964cf2f`](https://github.com/dearlordylord/dalph/commit/0f964cf2fb86a25a45fdce3906d86b6ddbd26d49).

This graph contains every currently open issue in the native prerequisite
closure of
[#143](https://github.com/dearlordylord/dalph/issues/143). Closed prerequisites
are omitted because they no longer need to be completed.

An arrow means **the issue at the tail blocks the issue at the head**. All 29
GitHub issue nodes in this graph must be completed before #143 can close. The
Effect Workflow evaluation is a non-issue destination authorized by closing
#143.

```mermaid
flowchart LR
  subgraph executor["Executor and event foundations"]
    i165["#165 Readable cassettes"]
    i131["#131 Frontier and admission"]
  end

  subgraph traversal["Traversal and admission"]
    i53["#53 Refresh complete pipelines"]
    i54["#54 Resize admission"]
    i55["#55 Localize conflicts"]
  end

  subgraph integration["Integration"]
    i56["#56 Queue accepted result"]
    i57["#57 Two-parent candidate"]
    i59["#59 Target verification"]
    i60["#60 Promote or reconcile"]
    i61["#61 Complete tracker task"]
  end

  subgraph reconciliation["Reconciliation"]
    i136["#136 Changed task reconciliation"]
    i137["#137 Claim reconciliation"]
    i138["#138 Blocker reconciliation"]
    i139["#139 Git reconciliation"]
    i141["#141 Integration finality"]
  end

  subgraph controls["Pause, drain, and dispositions"]
    i166["#166 Apply Pause/Unpause"]
    i134["#134 Whole-run pause"]
    i135["#135 Task/group pause"]
    i156["#156 Reject stale pause"]
    i63["#63 Drain to quiescence"]
    i65["#65 Cancel or continue"]
    i66["#66 Clean restart"]
    i67["#67 Abandon or quarantine"]
  end

  subgraph milestone["Fake-provider milestone"]
    i167["#167 Complete fake-provider behavior"]
  end

  subgraph production["Production executor decision"]
    i127["#127 Decide production executor"]
    i168["#168 Reconcile experimental executor"]
    i140["#140 Unavailable executor sessions"]
  end

  subgraph final["Final qualification"]
    i142["#142 Complete conformance matrix"]
    i143["#143 Delete superseded orchestration"]
    effectWorkflow["Effect Workflow evaluation"]
  end

  i165 --> i131

  i131 --> i53
  i165 --> i53
  i53 --> i54
  i131 --> i54
  i165 --> i54
  i54 --> i55

  i165 --> i56
  i56 --> i57
  i139 --> i57
  i57 --> i59
  i59 --> i60
  i139 --> i60
  i53 --> i61
  i60 --> i61
  i141 --> i61

  i165 --> i136
  i136 --> i137
  i136 --> i138
  i139 --> i138
  i165 --> i139
  i137 --> i141
  i138 --> i141
  i139 --> i141

  i165 --> i166
  i166 --> i134
  i134 --> i135
  i166 --> i135
  i134 --> i156
  i166 --> i156
  i134 --> i63
  i135 --> i63
  i56 --> i65
  i136 --> i65
  i65 --> i66
  i65 --> i67
  i137 --> i67

  i53 --> i167
  i54 --> i167
  i55 --> i167
  i56 --> i167
  i57 --> i167
  i59 --> i167
  i60 --> i167
  i61 --> i167
  i63 --> i167
  i65 --> i167
  i66 --> i167
  i67 --> i167
  i131 --> i167
  i134 --> i167
  i135 --> i167
  i136 --> i167
  i137 --> i167
  i138 --> i167
  i139 --> i167
  i141 --> i167
  i156 --> i167
  i165 --> i167
  i166 --> i167

  i167 --> i127
  i127 --> i168
  i167 --> i168
  i168 --> i140
  i165 --> i140

  i134 --> i142
  i135 --> i142
  i136 --> i142
  i137 --> i142
  i138 --> i142
  i139 --> i142
  i140 --> i142
  i141 --> i142
  i167 --> i142
  i142 --> i143
  i167 --> i143
  i143 -. evaluation authorized .-> effectWorkflow
```

## Count

- Open prerequisite issues before #143: 28.
- Final checkpoint issue #143: 1.
- Total GitHub issues still to complete: **29**.
- Effect Workflow evaluation node: not a GitHub issue.

## Recommended next work

[#164](https://github.com/dearlordylord/dalph/issues/164) is closed after the
[journal-first tracker-observation implementation on
`master`](https://github.com/dearlordylord/dalph/commit/de51cd58bcc7c3291f1fd3e96a378d2a573c1e4f)
and its [example-driven documentation
follow-up](https://github.com/dearlordylord/dalph/commit/311af4e6cb0ff37e17ca02f1dd005b98407f1527).
It and its three outgoing edges to #165, #53, and #167 are therefore omitted
from the remaining graph.

[#158](https://github.com/dearlordylord/dalph/issues/158) also remains closed
after the [acceptance-evidence cleanup on
`master`](https://github.com/dearlordylord/dalph/commit/80d11e05965698b8abec5c64ee8aac19014f94da),
so it and its six outgoing edges remain omitted.

[#165](https://github.com/dearlordylord/dalph/issues/165) is now the **only**
dependency-ready issue in this prerequisite closure: both of its native
blockers, #160 and #164, are closed, and GitHub marks it `ready-for-agent`.
Current `master` contains the maintained authored-cassette protocol, recorded
projection, domain-level behavior assertions, and their acceptance coverage.
The [latest #165 acceptance-evidence
comment](https://github.com/dearlordylord/dalph/issues/165#issuecomment-5126196336)
leaves two explicit issue-owned results before closure: property-generated
valid authored cassettes with validity-preserving shrinking, and the
changed-versus-unchanged observation size report.

There is no second dependency-valid implementation issue to run in parallel
with #165. [#131](https://github.com/dearlordylord/dalph/issues/131),
[#56](https://github.com/dearlordylord/dalph/issues/56),
[#136](https://github.com/dearlordylord/dalph/issues/136),
[#139](https://github.com/dearlordylord/dalph/issues/139), and
[#166](https://github.com/dearlordylord/dalph/issues/166) all retain #165 as
an open native blocker.

Finish those two #165 results, verify them against its accepted scenarios, and
close #165. Its closure releases the first useful parallel wave:
[#131](https://github.com/dearlordylord/dalph/issues/131),
[#56](https://github.com/dearlordylord/dalph/issues/56),
[#136](https://github.com/dearlordylord/dalph/issues/136),
[#139](https://github.com/dearlordylord/dalph/issues/139), and
[#166](https://github.com/dearlordylord/dalph/issues/166).

GitHub's native issue-dependency relation is authoritative. This file is a
dated projection and must be refreshed when issue states or dependency edges
change.
