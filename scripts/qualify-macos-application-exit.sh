#!/usr/bin/env bash

set -euo pipefail

readonly QUALIFICATION_COMMIT="5229c43a0f115e9e1230c5b05ab2958aefa4a0f7"
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(git -C "$SCRIPT_DIRECTORY/.." rev-parse --show-toplevel)"
readonly EVIDENCE_DIRECTORY="$REPOSITORY_ROOT/.scratch"

usage() {
  cat <<'EOF'
Usage: ./scripts/qualify-macos-application-exit.sh

Runs the human-only #211 macOS qualification against the exact built fixture
delivered by #210. The script writes a uniquely named evidence file under
.scratch/ and leaves tracked files, branches, and the current checkout unchanged.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 0 ]]; then
  usage >&2
  exit 64
fi

mkdir -p "$EVIDENCE_DIRECTORY"
readonly EVIDENCE_FILE="$(mktemp "$EVIDENCE_DIRECTORY/issue-211-macos-evidence.XXXXXX.txt")"
readonly QUALIFICATION_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dalph-macos-211.XXXXXX")"
readonly QUALIFICATION_WORKTREE="$QUALIFICATION_ROOT/checkout"
readonly OUTPUT_DIRECTORY="$QUALIFICATION_ROOT/output"
readonly FIXTURE_RELATIVE_PATH="packages/dalph/dist/bin/linux-application-exit-host-fixture.js"
ACTIVE_CHILD_PID=""

stop_active_child() {
  if [[ -n "$ACTIVE_CHILD_PID" ]] && kill -0 "$ACTIVE_CHILD_PID" >/dev/null 2>&1; then
    kill -KILL "$ACTIVE_CHILD_PID" >/dev/null 2>&1 || true
    wait "$ACTIVE_CHILD_PID" >/dev/null 2>&1 || true
  fi
  ACTIVE_CHILD_PID=""
}

best_effort_cleanup() {
  stop_active_child
  if [[ -d "$QUALIFICATION_WORKTREE" ]]; then
    if ! git -C "$REPOSITORY_ROOT" worktree remove --force "$QUALIFICATION_WORKTREE" >/dev/null 2>&1; then
      return
    fi
  fi
  rm -rf -- "$QUALIFICATION_ROOT"
}
trap best_effort_cleanup EXIT

wait_until_ready() {
  local output_file="$1"
  local attempt
  for ((attempt = 0; attempt < 600; attempt += 1)); do
    if grep -q '"ready":true' "$output_file" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$ACTIVE_CHILD_PID" >/dev/null 2>&1; then
      echo "Fixture exited before reporting ready: $output_file" >&2
      return 1
    fi
    sleep 0.1
  done
  echo "Fixture did not report ready within 60 seconds: $output_file" >&2
  return 1
}

start_fixture() {
  local mode="$1"
  local output_file="$2"
  shift 2
  node "$QUALIFICATION_WORKTREE/$FIXTURE_RELATIVE_PATH" \
    "$mode" "$QUALIFICATION_GIT_COMMON_DIRECTORY" "$@" >"$output_file" 2>&1 &
  ACTIVE_CHILD_PID=$!
  wait_until_ready "$output_file"
}

wait_for_fixture_status() {
  local expected_status="$1"
  local actual_status
  if wait "$ACTIVE_CHILD_PID"; then
    actual_status=0
  else
    actual_status=$?
  fi
  ACTIVE_CHILD_PID=""
  echo "shell_status=$actual_status"
  if [[ $actual_status -ne $expected_status ]]; then
    echo "Expected shell status $expected_status but received $actual_status" >&2
    return 1
  fi
}

require_output() {
  local output_file="$1"
  local expected="$2"
  if ! grep -Fq "$expected" "$output_file"; then
    echo "Missing expected evidence '$expected' in $output_file" >&2
    return 1
  fi
}

print_fixture_evidence() {
  local label="$1"
  local output_file="$2"
  echo "--- $label JSON lines ---"
  cat "$output_file"
  echo "--- end $label JSON lines ---"
}

run_signalled_fixture() {
  local mode="$1"
  local expected_status="$2"
  local output_file="$OUTPUT_DIRECTORY/$mode.jsonl"
  shift 2
  echo "+ built-fixture $mode"
  start_fixture "$mode" "$output_file" "$@"
  echo "signal=SIGTERM pid=$ACTIVE_CHILD_PID"
  kill -TERM "$ACTIVE_CHILD_PID"
  wait_for_fixture_status "$expected_status"
  print_fixture_evidence "$mode" "$output_file"
}

run_lock_successor() {
  local predecessor="$1"
  local output_file="$OUTPUT_DIRECTORY/acquire-after-$predecessor.jsonl"
  echo "+ built-fixture acquire-once after $predecessor"
  start_fixture "acquire-once" "$output_file"
  wait_for_fixture_status 0
  require_output "$output_file" '"lockAcquired":true'
  print_fixture_evidence "acquire-once-after-$predecessor" "$output_file"
}

validate_timeout_evidence() {
  local output_file="$OUTPUT_DIRECTORY/stuck-repeat.jsonl"
  node - "$output_file" <<'NODE'
const fs = require("node:fs")
const lines = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
const requests = lines.filter((line) => line.lifecycle?._tag === "ExitRequested")
const cutoffIndex = lines.findIndex((line) => line.lifecycle?._tag === "AdmissionCutoffClosed")
const secondRequestIndex = lines.findLastIndex((line) => line.lifecycle?._tag === "ExitRequested")
const result = lines.find((line) => line.lifecycle?.result?._tag === "TimedOut")
if (requests.length !== 2 || cutoffIndex < 0 || cutoffIndex >= secondRequestIndex || result === undefined) {
  throw new Error("repeated signal did not join one timed-out drain after its cutoff")
}
const elapsed = result.observedAt - requests[0].observedAt
if (elapsed < 4500 || elapsed > 5750) {
  throw new Error(`five-second timeout measured ${elapsed}ms, outside accepted scheduling uncertainty`)
}
if (!lines.some((line) => line.repeatedSignalSent === true)) {
  throw new Error("fixture did not record the controlled repeated signal")
}
console.log(`measured_timeout_ms=${elapsed}`)
console.log("measurement_uncertainty=performance.now observations accept 4500..5750ms for scheduling delay")
NODE
}

strict_cleanup() {
  local cleanup_failed=0
  stop_active_child
  if [[ -d "$QUALIFICATION_WORKTREE" ]]; then
    if ! git -C "$REPOSITORY_ROOT" worktree remove --force "$QUALIFICATION_WORKTREE"; then
      echo "Failed to remove temporary Git worktree: $QUALIFICATION_WORKTREE" >&2
      cleanup_failed=1
    fi
  fi
  if [[ $cleanup_failed -eq 0 ]] && [[ -d "$QUALIFICATION_ROOT" ]] && ! rm -rf -- "$QUALIFICATION_ROOT"; then
    echo "Failed to remove qualification directory: $QUALIFICATION_ROOT" >&2
    cleanup_failed=1
  fi
  return "$cleanup_failed"
}

set +e
(
  set -euo pipefail
  trap 'stop_active_child' EXIT
  trap 'stop_active_child; exit 130' INT
  trap 'stop_active_child; exit 143' TERM

  echo "=== DALPH #211 MACOS QUALIFICATION ==="
  echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "qualification_commit=$QUALIFICATION_COMMIT"
  echo

  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This qualification must run on supported Apple hardware under macOS." >&2
    exit 64
  fi
  for command_name in git node pnpm sw_vers uname; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "Required command is unavailable: $command_name" >&2
      exit 69
    fi
  done
  if ! git -C "$REPOSITORY_ROOT" cat-file -e "${QUALIFICATION_COMMIT}^{commit}" 2>/dev/null; then
    echo "Commit $QUALIFICATION_COMMIT is unavailable. Run 'git fetch origin' and retry." >&2
    exit 69
  fi

  echo "=== HOST ==="
  sw_vers
  uname -a
  echo "architecture=$(uname -m)"
  echo "node=$(node --version)"
  echo "pnpm=$(pnpm --version)"
  echo

  echo "=== EXACT CHECKOUT ==="
  echo "+ git worktree add --detach <temporary-worktree> $QUALIFICATION_COMMIT"
  git -C "$REPOSITORY_ROOT" worktree add --detach "$QUALIFICATION_WORKTREE" "$QUALIFICATION_COMMIT"
  cd "$QUALIFICATION_WORKTREE"
  echo "head=$(git rev-parse HEAD)"
  mkdir -p "$OUTPUT_DIRECTORY"
  echo

  echo "=== FROZEN INSTALL AND BUILD ==="
  echo "+ pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
  echo "+ pnpm build"
  pnpm build
  test -f "$FIXTURE_RELATIVE_PATH"
  echo "built_fixture=$FIXTURE_RELATIVE_PATH"
  echo

  echo "=== PHYSICAL GIT FACTS FOR RUNNING WORK ==="
  readonly QUALIFICATION_REPOSITORY="$QUALIFICATION_ROOT/repository"
  readonly QUALIFICATION_PLANNED_WORKTREE="$QUALIFICATION_ROOT/planned-worktree"
  echo "+ create a Git repository, commit Base, register the planned worktree, and write the uncommitted artifact"
  git init "$QUALIFICATION_REPOSITORY"
  git -C "$QUALIFICATION_REPOSITORY" config user.email dalph@example.invalid
  git -C "$QUALIFICATION_REPOSITORY" config user.name "Dalph Exit Qualification"
  printf 'application Exit fixture\n' >"$QUALIFICATION_REPOSITORY/README.md"
  git -C "$QUALIFICATION_REPOSITORY" add README.md
  git -C "$QUALIFICATION_REPOSITORY" commit -m "fixture base"
  readonly QUALIFICATION_BASE="$(git -C "$QUALIFICATION_REPOSITORY" rev-parse HEAD)"
  git -C "$QUALIFICATION_REPOSITORY" worktree add \
    -b dalph/running-exit-qualification \
    "$QUALIFICATION_PLANNED_WORKTREE" "$QUALIFICATION_BASE"
  printf 'uncommitted executor work must survive application Exit\n' \
    >"$QUALIFICATION_PLANNED_WORKTREE/dalph-preserved-work.txt"
  readonly QUALIFICATION_GIT_COMMON_DIRECTORY="$QUALIFICATION_REPOSITORY/.git"
  echo "base_sha=$QUALIFICATION_BASE"
  echo "planned_worktree=$QUALIFICATION_PLANNED_WORKTREE"
  echo

  echo "=== IDLE SUCCESS ==="
  run_signalled_fixture idle 0
  require_output "$OUTPUT_DIRECTORY/idle.jsonl" '"_tag":"Succeeded"'
  run_lock_successor idle
  echo

  echo "=== RUNNING EXECUTOR SAFE SUSPENSION ==="
  run_signalled_fixture running 0 - "$QUALIFICATION_PLANNED_WORKTREE" "$QUALIFICATION_BASE"
  require_output "$OUTPUT_DIRECTORY/running.jsonl" '"controlledExecutor":"FastSuspensionRequested","llmRequests":0'
  require_output "$OUTPUT_DIRECTORY/running.jsonl" '"journalEvents":["PlannedAttemptExecutorWorkResponsibilityBegan","PlannedAttemptExecutorWorkReported","PlannedAttemptExecutorCommandIntended","PlannedAttemptExecutorWorkReported"]'
  require_output "$OUTPUT_DIRECTORY/running.jsonl" '"_tag":"RunningExecutorWorkReachedSafeBoundary","correlations":[{"attemptId":"linux-host-attempt","runId":"linux-host-run"}]'
  require_output "$OUTPUT_DIRECTORY/running.jsonl" '"ExitResultReported"'
  require_output "$OUTPUT_DIRECTORY/running.jsonl" '"_tag":"Succeeded"'
  echo "+ git worktree list --porcelain"
  git -C "$QUALIFICATION_REPOSITORY" worktree list --porcelain
  echo "+ git status --porcelain -- dalph-preserved-work.txt"
  readonly ARTIFACT_STATUS="$(git -C "$QUALIFICATION_PLANNED_WORKTREE" status --porcelain -- dalph-preserved-work.txt)"
  echo "$ARTIFACT_STATUS"
  test "$ARTIFACT_STATUS" = "?? dalph-preserved-work.txt"
  echo "+ read dalph-preserved-work.txt"
  readonly ARTIFACT_CONTENT="$(cat "$QUALIFICATION_PLANNED_WORKTREE/dalph-preserved-work.txt")"
  echo "$ARTIFACT_CONTENT"
  test "$ARTIFACT_CONTENT" = "uncommitted executor work must survive application Exit"
  echo

  echo "=== CONCLUSIVE DRAIN FAILURE ==="
  run_signalled_fixture failed 1
  require_output "$OUTPUT_DIRECTORY/failed.jsonl" '"_tag":"Failed"'
  run_lock_successor failed
  echo

  echo "=== STUCK ATOMIC SECTION AND REPEATED SIGNAL ==="
  run_signalled_fixture stuck-repeat 1
  require_output "$OUTPUT_DIRECTORY/stuck-repeat.jsonl" '"_tag":"TimedOut"'
  require_output "$OUTPUT_DIRECTORY/stuck-repeat.jsonl" '"diagnostics"'
  validate_timeout_evidence
  run_lock_successor stuck-repeat
  echo

  echo "=== UNEXPECTED PROCESS DEATH JOURNAL PREFIX ==="
  readonly DEATH_JOURNAL="$OUTPUT_DIRECTORY/unexpected-death-journal.txt"
  readonly DEATH_OUTPUT="$OUTPUT_DIRECTORY/unexpected-death.jsonl"
  echo "+ built-fixture idle followed by SIGKILL"
  start_fixture idle "$DEATH_OUTPUT" "$DEATH_JOURNAL"
  echo "signal=SIGKILL pid=$ACTIVE_CHILD_PID"
  kill -KILL "$ACTIVE_CHILD_PID"
  if wait "$ACTIVE_CHILD_PID"; then
    readonly DEATH_STATUS=0
  else
    readonly DEATH_STATUS=$?
  fi
  ACTIVE_CHILD_PID=""
  echo "shell_status=$DEATH_STATUS"
  test "$DEATH_STATUS" -ne 0
  print_fixture_evidence unexpected-death "$DEATH_OUTPUT"
  echo "journal_prefix=$(cat "$DEATH_JOURNAL")"
  test "$(cat "$DEATH_JOURNAL")" = "WorkflowRunBegan"
  echo

  echo "=== RESULT ==="
  echo "qualification=PASSED"
  echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
) 2>&1 | tee "$EVIDENCE_FILE"
readonly PIPELINE_STATUS=("${PIPESTATUS[@]}")
set -e

readonly QUALIFICATION_STATUS=${PIPELINE_STATUS[0]}
readonly EVIDENCE_STATUS=${PIPELINE_STATUS[1]}
if [[ $EVIDENCE_STATUS -ne 0 ]]; then
  echo "Evidence writer failed with status $EVIDENCE_STATUS: $EVIDENCE_FILE" >&2
  exit "$EVIDENCE_STATUS"
fi

set +e
strict_cleanup 2>&1 | tee -a "$EVIDENCE_FILE"
readonly CLEANUP_PIPELINE_STATUS=("${PIPESTATUS[@]}")
set -e
readonly CLEANUP_STATUS=${CLEANUP_PIPELINE_STATUS[0]}
readonly CLEANUP_EVIDENCE_STATUS=${CLEANUP_PIPELINE_STATUS[1]}

if [[ $CLEANUP_EVIDENCE_STATUS -ne 0 ]]; then
  echo "Evidence writer failed during cleanup with status $CLEANUP_EVIDENCE_STATUS: $EVIDENCE_FILE" >&2
  exit "$CLEANUP_EVIDENCE_STATUS"
fi
if [[ $CLEANUP_STATUS -ne 0 ]]; then
  echo "Qualification cleanup failed. Evidence retained at: $EVIDENCE_FILE" | tee -a "$EVIDENCE_FILE" >&2
  exit "$CLEANUP_STATUS"
fi
if [[ $QUALIFICATION_STATUS -ne 0 ]]; then
  echo "macOS qualification failed with status $QUALIFICATION_STATUS" | tee -a "$EVIDENCE_FILE" >&2
  echo "Evidence retained at: $EVIDENCE_FILE" | tee -a "$EVIDENCE_FILE" >&2
  exit "$QUALIFICATION_STATUS"
fi

echo "cleanup=PASSED" | tee -a "$EVIDENCE_FILE"
echo "macOS qualification passed." | tee -a "$EVIDENCE_FILE"
echo "Send this file back for #211: $EVIDENCE_FILE" | tee -a "$EVIDENCE_FILE"
