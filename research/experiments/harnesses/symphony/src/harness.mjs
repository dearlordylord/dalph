import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PINNED_SHA = "f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7";
const FORBIDDEN_ENV_PATTERN =
  /(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH|COOKIE|PROXY)/i;
export const REQUIRED_PREFLIGHT_IDS = [
  "harness-tools",
  "elixir-runtime",
  "source-pin",
  "disposable-source-copy",
  "checkout-cleanliness",
  "fixed-link-resolution",
  "credential-free-environment",
  "network-isolation",
  "resource-limits",
  "fake-protocol",
  "fixture-bootstrap",
  "otp-isolation",
  "idle-external-signal-canary",
  "idle-in-beam-orchestrator-canary",
  "idle-whole-beam-restart-canary",
  "offline-dependency-proof",
  "teardown-negative-canary",
  "outside-root-mutation-proof",
];

export function buildChildEnvironment(_parentEnvironment, root, pathValue) {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: join(root, "home"),
    HEX_OFFLINE: "1",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    MIX_HOME: join(root, "mix-home"),
    PATH: pathValue,
    TMPDIR: join(root, "tmp"),
    XDG_CACHE_HOME: join(root, "xdg", "cache"),
    XDG_CONFIG_HOME: join(root, "xdg", "config"),
    XDG_DATA_HOME: join(root, "xdg", "data"),
  };
}

export function classifyPreflight(checks) {
  const seen = new Set(checks.map((check) => check.id));
  const missing = REQUIRED_PREFLIGHT_IDS.filter((id) => !seen.has(id)).map(
    (id) => `${id}: required proof missing`,
  );
  const blockers = checks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.id}: ${check.detail ?? check.status}`)
    .concat(missing);
  return { safeToInjectCrash: blockers.length === 0, blockers };
}

export function isOwnedTemporaryRoot(owner, observed) {
  return (
    owner.experimentId === observed.experimentId &&
    owner.temporaryRoot === observed.resolvedPath &&
    owner.uid === observed.uid &&
    owner.device === observed.device &&
    owner.inode === observed.inode
  );
}

function timestamp() {
  return new Date().toISOString();
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

async function findExecutable(name, pathValue) {
  for (const directory of pathValue.split(":")) {
    const candidate = join(directory, name);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the explicit search path.
    }
  }
  return null;
}

function resourceLimitedArgv(argv, limitTool) {
  return [
    limitTool,
    "--cpu=15:15",
    "--as=4294967296:4294967296",
    "--fsize=536870912:536870912",
    "--nofile=256:256",
    "--nproc=256:256",
    "--core=0:0",
    "--",
    ...argv,
  ];
}

async function runCommand({
  argv,
  cwd,
  env,
  commands,
  processes,
  limitTool,
  timeoutMs = 10_000,
}) {
  if (!limitTool) throw new Error("runCommand requires a prlimit executable");
  const launchedArgv = resourceLimitedArgv(argv, limitTool);
  const startedAt = timestamp();
  const startedNs = process.hrtime.bigint();
  const child = spawn(launchedArgv[0], launchedArgv.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  const processRecord = {
    role: "preflight-command",
    argv: launchedArgv,
    requestedArgv: argv,
    pid: child.pid,
    processGroupId: child.pid,
    parentPid: process.pid,
    startedAt,
    ownedByExperiment: true,
  };
  processes.push(processRecord);
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const timer = setTimeout(() => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  }, timeoutMs);
  const outcome = await new Promise((resolveOutcome) => {
    child.once("error", (error) =>
      resolveOutcome({ code: null, signal: null, error: error.message }),
    );
    child.once("close", (code, signal) =>
      resolveOutcome({ code, signal, error: null }),
    );
  });
  clearTimeout(timer);
  processRecord.endedAt = timestamp();
  processRecord.exitCode = outcome.code;
  processRecord.signal = outcome.signal;
  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  const record = {
    argv,
    launchedArgv,
    cwd,
    startedAt,
    endedAt: timestamp(),
    durationMilliseconds: Number(process.hrtime.bigint() - startedNs) / 1e6,
    exitCode: outcome.code,
    signal: outcome.signal,
    spawnError: outcome.error,
    stdoutSha256: sha256(stdoutBuffer),
    stderrSha256: sha256(stderrBuffer),
    stdout: stdoutBuffer.toString("utf8").slice(0, 4_096),
    stderr: stderrBuffer.toString("utf8").slice(0, 4_096),
  };
  commands.push(record);
  return record;
}

function observeProcessGroups(processes) {
  return [
    ...new Map(
      processes
        .filter((record) => record.processGroupId)
        .map((record) => [record.processGroupId, record]),
    ).values(),
  ].map((record) => {
    try {
      process.kill(-record.processGroupId, 0);
      return {
        processGroupId: record.processGroupId,
        absent: false,
        detail: "process group still accepts signal 0",
      };
    } catch (error) {
      return {
        processGroupId: record.processGroupId,
        absent: error.code === "ESRCH",
        detail: error.code,
      };
    }
  });
}

async function verifyOwnedRoot(owner) {
  const observedPath = await realpath(owner.temporaryRoot);
  const observedStat = await lstat(observedPath);
  const marker = JSON.parse(
    await readFile(join(observedPath, "owner.json"), "utf8"),
  );
  const observed = {
    experimentId: marker.experimentId,
    resolvedPath: observedPath,
    uid: process.getuid(),
    device: observedStat.dev,
    inode: observedStat.ino,
  };
  return { observed, owned: isOwnedTemporaryRoot(owner, observed) };
}

async function listFiles(root, relative = "") {
  const directory = join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, entryRelative)));
    } else if (entry.isFile()) {
      files.push(entryRelative);
    }
  }
  return files.sort();
}

function parseArguments(argv, repositoryRoot) {
  const options = {
    source: join(repositoryRoot, ".references", "symphony"),
    resultsRoot: join(repositoryRoot, "research", "experiments", "results"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") options.source = resolve(argv[++index]);
    else if (argv[index] === "--results-dir")
      options.resultsRoot = resolve(argv[++index]);
    else if (argv[index] === "--help") options.help = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(moduleDirectory, "../../../../..");
  const options = parseArguments(argv, repositoryRoot);
  if (options.help) {
    process.stdout.write(
      "Usage: run.sh [--source PATH] [--results-dir PATH]\n" +
        "Runs the fail-closed Symphony C0 preflight. It never injects a fault unless every proof passes.\n",
    );
    return 0;
  }

  const experimentId = randomUUID();
  const compactTime = timestamp().replaceAll(/[-:.]/g, "");
  const resultDirectory = join(
    options.resultsRoot,
    `symphony-c0-${compactTime}-${experimentId.slice(0, 8)}-blocked`,
  );
  await mkdir(options.resultsRoot, { recursive: true });
  await mkdir(resultDirectory, { recursive: false });

  const createdTemporaryRoot = await mkdtemp(join(tmpdir(), "dalph-symphony-c0-"));
  let temporaryRoot = createdTemporaryRoot;
  let owner = null;
  const commands = [];
  const checks = [];
  const processes = [];
  let crashInjected = false;
  let cleanup = { attempted: false, completed: false };
  let archivedSource = null;
  let interruptedSignal = null;
  const interruptHandler = (signal) => {
    interruptedSignal = signal;
    for (const processRecord of processes.filter((record) => !record.endedAt)) {
      try {
        process.kill(-processRecord.processGroupId, "SIGKILL");
      } catch {
        // The child may already have exited; the close event remains authoritative.
      }
    }
  };
  const onSigint = () => interruptHandler("SIGINT");
  const onSigterm = () => interruptHandler("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    temporaryRoot = await realpath(createdTemporaryRoot);
    const rootStat = await stat(temporaryRoot);
    const evidenceStat = await stat(resultDirectory);
    owner = {
      schemaVersion: 1,
      experimentId,
      scenario: "C0-before-claim",
      sourceRevision: PINNED_SHA,
      creatorPid: process.pid,
      uid: process.getuid(),
      createdAt: timestamp(),
      temporaryRoot,
      device: rootStat.dev,
      inode: rootStat.ino,
      evidenceDirectory: await realpath(resultDirectory),
      evidenceDevice: evidenceStat.dev,
      evidenceInode: evidenceStat.ino,
    };
    const ownerJson = `${JSON.stringify(owner, null, 2)}\n`;
    await writeFile(join(temporaryRoot, "owner.json"), ownerJson, {
      flag: "wx",
    });
    await writeFile(join(resultDirectory, "owner.json"), ownerJson);

    const explicitPath = "/usr/local/bin:/usr/bin:/bin";
    const childEnvironment = buildChildEnvironment(
      process.env,
      temporaryRoot,
      explicitPath,
    );
    for (const directory of Object.values(childEnvironment).filter((value) =>
      value.startsWith(temporaryRoot),
    )) {
      await mkdir(directory, { recursive: true });
    }
    await writeFile(
      join(resultDirectory, "environment-keys.txt"),
      `${Object.keys(childEnvironment).sort().join("\n")}\n`,
    );

    const toolNames = [
      "git",
      "tar",
      "node",
      "unshare",
      "prlimit",
      "timeout",
      "elixir",
      "mix",
    ];
    const tools = {};
    for (const name of toolNames) tools[name] = await findExecutable(name, explicitPath);

    const missingCore = ["git", "tar", "node", "unshare", "prlimit", "timeout"].filter(
      (name) => !tools[name],
    );
    checks.push(
      missingCore.length === 0
        ? { id: "harness-tools", status: "pass", detail: tools }
        : {
            id: "harness-tools",
            status: "blocked",
            detail: `missing: ${missingCore.join(", ")}`,
          },
    );
    checks.push(
      tools.elixir && tools.mix
        ? {
            id: "elixir-runtime",
            status: "pass",
            detail: { elixir: tools.elixir, mix: tools.mix },
          }
        : {
            id: "elixir-runtime",
            status: "blocked",
            detail: `missing: ${[
              !tools.elixir && "elixir",
              !tools.mix && "mix",
            ]
              .filter(Boolean)
              .join(", ")}`,
          },
    );

    const sourcePath = await realpath(options.source);
    const sourceHead = tools.git && tools.prlimit
      ? await runCommand({
          argv: [tools.git, "-C", sourcePath, "rev-parse", "HEAD"],
          cwd: repositoryRoot,
          env: childEnvironment,
          commands,
          processes,
          limitTool: tools.prlimit,
        })
      : null;
    const observedSha = sourceHead?.stdout.trim();
    checks.push(
      sourceHead?.exitCode === 0 && observedSha === PINNED_SHA
        ? {
            id: "source-pin",
            status: "pass",
            detail: { expected: PINNED_SHA, observed: observedSha },
          }
        : {
            id: "source-pin",
            status: "blocked",
            detail: `expected ${PINNED_SHA}; observed ${observedSha ?? "unavailable"}`,
          },
    );

    if (observedSha === PINNED_SHA && tools.git && tools.tar && tools.prlimit) {
      const archivePath = join(temporaryRoot, "symphony-source.tar");
      const copyPath = join(temporaryRoot, "source", "symphony");
      await mkdir(copyPath, { recursive: true });
      const archive = await runCommand({
        argv: [tools.git, "-C", sourcePath, "archive", "--format=tar", "-o", archivePath, PINNED_SHA],
        cwd: repositoryRoot,
        env: childEnvironment,
        commands,
        processes,
        limitTool: tools.prlimit,
      });
      const extract = await runCommand({
        argv: [tools.tar, "-xf", archivePath, "-C", copyPath],
        cwd: temporaryRoot,
        env: childEnvironment,
        commands,
        processes,
        limitTool: tools.prlimit,
      });
      if (archive.exitCode === 0 && extract.exitCode === 0) {
        archivedSource = {
          path: copyPath,
          archiveSha256: await sha256File(archivePath),
          sourceRevision: PINNED_SHA,
        };
        checks.push({
          id: "disposable-source-copy",
          status: "pass",
          detail: archivedSource,
        });
      } else {
        checks.push({
          id: "disposable-source-copy",
          status: "blocked",
          detail: "git archive or extraction failed",
        });
      }
    } else {
      checks.push({
        id: "disposable-source-copy",
        status: "blocked",
        detail: "source pin or archive tools unavailable",
      });
    }

    const forbiddenChildKeys = Object.keys(childEnvironment).filter((key) =>
      FORBIDDEN_ENV_PATTERN.test(key),
    );
    checks.push(
      forbiddenChildKeys.length === 0
        ? {
            id: "credential-free-environment",
            status: "pass",
            detail: {
              inheritedKeys: [],
              childKeys: Object.keys(childEnvironment).sort(),
            },
          }
        : {
            id: "credential-free-environment",
            status: "blocked",
            detail: `forbidden child keys: ${forbiddenChildKeys.join(", ")}`,
          },
    );

    if (tools.unshare && tools.node && tools.prlimit) {
      const network = await runCommand({
        argv: [
          tools.unshare,
          "--user",
          "--map-root-user",
          "--net",
          "--mount-proc",
          tools.node,
          "--input-type=module",
          "-e",
          [
            "import { networkInterfaces } from 'node:os';",
            "import { connect } from 'node:net';",
            "const nonLoopback = Object.values(networkInterfaces()).flat().filter((x) => x && !x.internal);",
            "if (nonLoopback.length) process.exit(20);",
            "const socket = connect({ host: '192.0.2.1', port: 9 });",
            "const timer = setTimeout(() => process.exit(21), 1000);",
            "socket.once('connect', () => process.exit(22));",
            "socket.once('error', (error) => {",
            "  clearTimeout(timer);",
            "  process.exit(['ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL'].includes(error.code) ? 0 : 23);",
            "});",
          ].join("\n"),
        ],
        cwd: temporaryRoot,
        env: childEnvironment,
        commands,
        processes,
        limitTool: tools.prlimit,
      });
      checks.push(
        network.exitCode === 0
          ? {
              id: "network-isolation",
              status: "pass",
              detail:
                "new user/network namespace has no non-loopback IPv4/IPv6 interface and rejects an outbound connection",
            }
          : {
              id: "network-isolation",
              status: "blocked",
              detail: `unshare canary failed with exit ${network.exitCode}; ${network.stderr.trim()}`,
            },
      );
    } else {
      checks.push({
        id: "network-isolation",
        status: "blocked",
        detail: "unshare or node unavailable",
      });
    }

    const cgroupMount = await readFile("/proc/mounts", "utf8").catch(() => "");
    const cgroupWritable = await access("/sys/fs/cgroup", fsConstants.W_OK)
      .then(() => true)
      .catch(() => false);
    checks.push({
      id: "resource-limits",
      status: "blocked",
      detail:
        tools.prlimit && tools.timeout && cgroupMount.includes("cgroup2") && cgroupWritable
          ? "resource controller wiring has not yet passed CPU, memory, PID, disk, and elapsed-time canaries"
          : "hard CPU, memory, PID, disk, and elapsed-time containment cannot be proven; cgroup v2 is not writable",
    });

    const sleepPath = await findExecutable("sleep", explicitPath);
    if (sleepPath && tools.prlimit) {
      const canaryArgv = resourceLimitedArgv([sleepPath, "30"], tools.prlimit);
      const canary = spawn(canaryArgv[0], canaryArgv.slice(1), {
        cwd: temporaryRoot,
        env: childEnvironment,
        detached: true,
        stdio: "ignore",
      });
      const canaryStartedAt = timestamp();
      processes.push({
        role: "idle-external-signal-canary",
        argv: canaryArgv,
        requestedArgv: [sleepPath, "30"],
        pid: canary.pid,
        processGroupId: canary.pid,
        parentPid: process.pid,
        startedAt: canaryStartedAt,
        ownedByExperiment: true,
      });
      canary.kill("SIGKILL");
      const canaryOutcome = await new Promise((resolveOutcome) =>
        canary.once("close", (code, signal) => resolveOutcome({ code, signal })),
      );
      processes.at(-1).endedAt = timestamp();
      processes.at(-1).exitCode = canaryOutcome.code;
      processes.at(-1).signal = canaryOutcome.signal;
      processes.at(-1).terminationAction = {
        operation: "node ChildProcess.kill",
        signal: "SIGKILL",
        exactTargetPid: canary.pid,
      };
      checks.push(
        canaryOutcome.signal === "SIGKILL"
          ? {
              id: "idle-external-signal-canary",
              status: "pass",
              detail: `exact owned PID ${canary.pid} acknowledged SIGKILL`,
            }
          : {
              id: "idle-external-signal-canary",
              status: "blocked",
              detail: `owned PID ${canary.pid} did not acknowledge SIGKILL`,
            },
      );
    } else {
      checks.push({
        id: "idle-external-signal-canary",
        status: "blocked",
        detail: "sleep or prlimit unavailable",
      });
    }

    checks.push({
      id: "idle-in-beam-orchestrator-canary",
      status: "blocked",
      detail:
        "not attempted because the complete preflight gate did not pass; no Symphony process was started",
    });
    checks.push({
      id: "idle-whole-beam-restart-canary",
      status: "blocked",
      detail:
        "not attempted because the complete preflight gate did not pass; no BEAM start, kill, restart, or snapshot action was attempted",
    });
    checks.push({
      id: "offline-dependency-proof",
      status: "blocked",
      detail:
        "not attempted because the complete preflight gate did not pass; offline mode remained enforced and no package registry was contacted",
    });
    if (interruptedSignal) {
      checks.push({
        id: "operator-interruption",
        status: "blocked",
        detail: `${interruptedSignal} received; owned active process groups were terminated`,
      });
    }

    const classification = classifyPreflight(checks);
    const preflight = {
      schemaVersion: 1,
      experimentId,
      scenario: "C0-before-claim",
      sourceRevision: PINNED_SHA,
      recordedAt: timestamp(),
      checks,
      ...classification,
      crashInjected,
      symphonyStarted: false,
    };
    await writeFile(
      join(resultDirectory, "preflight.json"),
      `${JSON.stringify(preflight, null, 2)}\n`,
    );
    await writeFile(
      join(resultDirectory, "process-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          experimentId,
          coordinatorPid: process.pid,
          processes,
          symphonyProcesses: [],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(resultDirectory, "commands.jsonl"),
      `${commands.map((command) => JSON.stringify(command)).join("\n")}\n`,
    );

    const result = `# Symphony C0 experiment result

**Status:** blocked in preflight; C0 was not run
**Scenario:** stop before claim
**Pinned revision:** \`${PINNED_SHA}\`
**Experiment ID:** \`${experimentId}\`
**Recorded:** ${timestamp()}

The harness did not start Symphony and did not inject a fault. The credential-free child
environment was constructed, the pinned source was copied through \`git archive\` into the
owned temporary root, and the harmless exact-PID signal canary was validated. The hard gate
failed on the proofs listed below; this record does not infer a cause beyond their captured
command output and check details.

## Outcomes

- **In-BEAM Orchestrator reset:** not run. No Orchestrator PID existed, so no
  \`Process.exit(pid, :kill)\` call was made.
- **Whole-BEAM restart:** not run. No BEAM PID existed, so no external kill was sent.
- **Crash injected:** no.
- **Result classification:** blocker/execution record only; this is not a unit test
  represented as crash recovery.

## Blocking proofs

${classification.blockers.map((blocker) => `- ${blocker}`).join("\n")}

Exact command arguments, output hashes, timestamps, process ownership, and preflight checks
are recorded beside this file. No external service or package registry was contacted.
`;
    await writeFile(join(resultDirectory, "result.md"), result);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    const verification = owner
      ? await verifyOwnedRoot(owner).catch((error) => ({
          owned: false,
          observed: { error: error.message },
        }))
      : {
          owned: false,
          observed: {
            error: "owner marker was not durably written; retaining root",
          },
        };
    const everyProcessEnded = processes.every(
      (processRecord) => processRecord.endedAt,
    );
    const processGroupObservations = observeProcessGroups(processes);
    const everyProcessGroupAbsent = processGroupObservations.every(
      (observation) => observation.absent,
    );
    const evidenceObservation = owner
      ? await stat(owner.evidenceDirectory)
          .then((observedStat) => ({
            path: owner.evidenceDirectory,
            device: observedStat.dev,
            inode: observedStat.ino,
            matchesOwner:
              observedStat.dev === owner.evidenceDevice &&
              observedStat.ino === owner.evidenceInode,
          }))
          .catch((error) => ({ error: error.message, matchesOwner: false }))
      : { matchesOwner: false, error: "owner marker unavailable" };
    const forbiddenRoots = [
      "/",
      resolve(repositoryRoot),
      resolve(process.env.HOME ?? "/"),
    ];
    const safeDeletionPath =
      temporaryRoot.startsWith(`${resolve(tmpdir())}/dalph-symphony-c0-`) &&
      !forbiddenRoots.includes(temporaryRoot) &&
      !forbiddenRoots.some((path) => path.startsWith(`${temporaryRoot}/`));
    cleanup = {
      attempted: true,
      ownershipVerification: verification,
      evidenceObservation,
      everyRecordedProcessEnded: everyProcessEnded,
      processGroupObservations,
      everyRecordedProcessGroupAbsent: everyProcessGroupAbsent,
      noSymphonyProcessOrListenerStarted: true,
      safeDeletionPath,
      completed: false,
      retainedTemporaryRoot: temporaryRoot,
    };
    if (
      verification.owned &&
      evidenceObservation.matchesOwner &&
      everyProcessEnded &&
      everyProcessGroupAbsent &&
      safeDeletionPath
    ) {
      await rm(temporaryRoot, { recursive: true, force: false });
      cleanup.completed = true;
      cleanup.retainedTemporaryRoot = null;
    }
    await writeFile(
      join(resultDirectory, "teardown.json"),
      `${JSON.stringify(cleanup, null, 2)}\n`,
    );
  }

  const evidenceFiles = (await listFiles(resultDirectory)).filter(
    (path) => path !== "manifest.json",
  );
  const evidence = {};
  for (const relativePath of evidenceFiles) {
    evidence[relativePath] = {
      sha256: await sha256File(join(resultDirectory, relativePath)),
      bytes: (await stat(join(resultDirectory, relativePath))).size,
    };
  }
  const harnessFiles = {
    "run.sh": join(moduleDirectory, "..", "run.sh"),
    "src/harness.mjs": fileURLToPath(import.meta.url),
  };
  const harness = {};
  for (const [relativePath, path] of Object.entries(harnessFiles)) {
    harness[relativePath] = {
      sha256: await sha256File(path),
      bytes: (await stat(path)).size,
    };
  }
  await writeFile(
    join(resultDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        experimentId,
        scenario: "C0-before-claim",
        sourceRevision: PINNED_SHA,
        crashInjected,
        archivedSource,
        cleanup,
        harness,
        evidence,
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(`${resultDirectory}\n`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    },
  );
}
