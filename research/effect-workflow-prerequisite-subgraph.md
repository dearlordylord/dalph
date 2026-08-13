```mermaid
flowchart LR
  subgraph generic["Generic executor boundary"]
    i220["#220 Supply exact task instructions"]
  end

  subgraph concrete["Maintainer-selected executor implementation"]
    i58["#58 Implement persistent Codex app-server executor"]
    i75["#75 Qualify its sessions/processes"]
    i68["#68 Retry/replace/quarantine integration session"]
    i69["#69 Disposition-authorized cleanup"]
    i77["#77 Qualify production cleanup"]
  end

  subgraph final["Final qualification"]
    i142["#142 Complete conformance matrix"]
    i143["#143 Delete superseded orchestration"]
    effectWorkflow["Effect Workflow evaluation"]
  end

  i142 --> i143
  i143 -. evaluation authorized .-> effectWorkflow

  i220 --> i58
  i58 --> i75
  i58 --> i68
  i68 --> i69
  i69 --> i77
```

Completed prerequisites are removed from the active graph. Issue #66 was
integrated and closed on master at `147a1774b`; #167 was integrated on master
at `8fd47e052`; #127 accepted the opaque planned-attempt executor boundary and
closed at `2769e1c63`. Issue #168 was integrated at `78ed1b3e3`, making generic
Dalph production-capable without choosing an executor's private algorithm.
Issue #140 was integrated at `d606b63fd`, adding fail-closed normalized
projection outcomes without exposing executor internals.

#219 selected one simple persistent Codex app-server executor and explicitly
rejected a required review loop. The current generic executor call omits the
tracker-authored task title/body, so #220 repairs that exact input first. The
rewritten #58 then implements the selected private app-server/thread behavior,
and #75 qualifies its real session and process lifecycle. The integration-
session and cleanup chain continues through #68, #69, and #77.

The concrete-implementation branch does not block the focused Effect Workflow
evaluation. With #140 complete, that evaluation remains blocked by #142 and
#143 in that order. Closing #143 authorizes evaluation, not adoption.
