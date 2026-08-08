import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChildEnvironment,
  classifyPreflight,
  isOwnedTemporaryRoot,
  REQUIRED_PREFLIGHT_IDS,
} from "../src/harness.mjs";

test("child environment is an allowlist and never forwards credential-like keys", () => {
  const child = buildChildEnvironment(
    {
      PATH: "/host/bin",
      GITHUB_TOKEN: "secret",
      LINEAR_API_KEY: "secret",
      OPENAI_API_KEY: "secret",
      AWS_ACCESS_KEY_ID: "secret",
      HTTP_PROXY: "http://proxy.invalid",
    },
    "/tmp/symphony-c0-test",
    "/usr/bin:/bin",
  );

  assert.deepEqual(Object.keys(child).sort(), [
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_TERMINAL_PROMPT",
    "HEX_OFFLINE",
    "HOME",
    "LANG",
    "LC_ALL",
    "MIX_HOME",
    "PATH",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]);
  assert.equal(JSON.stringify(child).includes("secret"), false);
});

test("preflight fails closed when any required proof is not passing", () => {
  const result = classifyPreflight([
    { id: "source-pin", status: "pass" },
    { id: "network-isolation", status: "blocked", detail: "unshare denied" },
    { id: "elixir-runtime", status: "blocked", detail: "mix missing" },
  ]);

  assert.equal(result.safeToInjectCrash, false);
  assert.ok(result.blockers.includes("network-isolation: unshare denied"));
  assert.ok(result.blockers.includes("elixir-runtime: mix missing"));
  assert.ok(result.blockers.includes("harness-tools: required proof missing"));
});

test("preflight permits a crash only when every required proof passes", () => {
  const result = classifyPreflight(
    REQUIRED_PREFLIGHT_IDS.map((id) => ({ id, status: "pass" })),
  );

  assert.equal(result.safeToInjectCrash, true);
  assert.deepEqual(result.blockers, []);
});

test("temporary-root ownership requires exact path, owner, and inode identity", () => {
  const owner = {
    experimentId: "experiment-1",
    temporaryRoot: "/tmp/symphony-c0-abc",
    uid: 1000,
    device: 42,
    inode: 99,
  };

  assert.equal(
    isOwnedTemporaryRoot(owner, {
      experimentId: "experiment-1",
      resolvedPath: "/tmp/symphony-c0-abc",
      uid: 1000,
      device: 42,
      inode: 99,
    }),
    true,
  );
  assert.equal(
    isOwnedTemporaryRoot(owner, {
      experimentId: "experiment-1",
      resolvedPath: "/tmp/symphony-c0-other",
      uid: 1000,
      device: 42,
      inode: 99,
    }),
    false,
  );
});
