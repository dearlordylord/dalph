```mermaid
flowchart LR
  subgraph integration["Integration"]
    i57["#57 Two-parent candidate ✓"]
    i59["#59 Target verification ✓"]
    i60["#60 Promote or reconcile ✓"]
    i61["#61 Complete tracker task"]
  end

  subgraph reconciliation["Reconciliation"]
    i138["#138 Blocker reconciliation ✓"]
    i141["#141 Integration finality"]
  end

  subgraph controls["Pause, drain, and dispositions"]
    i134["#134 Whole-run pause ✓"]
    i135["#135 Task/group pause ✓"]
    i156["#156 Reject stale pause ✓"]
    i63["#63 Drain to quiescence"]
    i65["#65 Cancel or continue"]
    i66["#66 Clean restart"]
    i67["#67 Abandon or quarantine"]
  end

  subgraph architecture["Delivery architecture"]
    i195["#195 Service convergence ✓"]
  end

  subgraph milestone["Controlled-provider milestone"]
    i167["#167 Complete controlled-provider behavior"]
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

  i57 --> i59
  i59 --> i60
  i60 --> i61
  i141 --> i61

  i138 --> i141

  i195 --> i167

  i134 --> i135
  i134 --> i156
  i134 --> i63
  i135 --> i63
  i65 --> i66
  i65 --> i67

  i57 --> i167
  i59 --> i167
  i60 --> i167
  i61 --> i167
  i63 --> i167
  i65 --> i167
  i66 --> i167
  i67 --> i167
  i134 --> i167
  i135 --> i167
  i138 --> i167
  i141 --> i167
  i156 --> i167

  i167 --> i127
  i127 --> i168
  i167 --> i168
  i168 --> i140

  i134 --> i142
  i135 --> i142
  i138 --> i142
  i140 --> i142
  i141 --> i142
  i167 --> i142
  i142 --> i143
  i167 --> i143
  i143 -. evaluation authorized .-> effectWorkflow
```
