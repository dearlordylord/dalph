```mermaid
flowchart LR
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

  i127 --> i168
  i168 --> i140

  i140 --> i142
  i142 --> i143
  i143 -. evaluation authorized .-> effectWorkflow
```

Completed prerequisites are removed from the active graph. Issue #66 was
integrated and closed on master at `147a1774b`; #167 was integrated on master
at `8fd47e052`. Issue #127 is now the active entry node for the production
executor decision. Effect Workflow evaluation remains blocked by #127, #168,
#140, #142, and #143 in that order.
