import { env as processEnvironment } from "node:process"
import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const mbtTestPattern = "packages/**/*.mbt.test.ts"
const acceptedResultIntegrationMbtTestPattern =
  "packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts"
const deliveryRepeatabilityTestPattern = "packages/dalph/test/cassettes/delivery-repeatability.test.ts"
const capabilityRegistrationTestPattern = "scripts/capability-registration.test.ts"
const performanceTestPattern = "**/*.performance.test.ts"
// This built-binary recovery diagnostic is intentionally manual: it cannot
// contribute parent-worker V8 coverage and is not reliable on hosted runners.
const publicRecoveryProcessBoundaryTestPattern =
  "packages/dalph/src/application/production-public-recovery.integration.test.ts"
const recordedCatalogCoverageTestPattern = "packages/dalph/test/cassettes/recorded-catalog-coverage.test.ts"
const publicationIntegrationTestPattern =
  "packages/dalph/test/integration/direct-remote-publication.integration.test.ts"
const liveLaunchPreflightIntegrationTestPattern =
  "packages/dalph/test/qualification/production-live-launch-preflight.integration.test.ts"
// These process-heavy files passed focused coverage but crossed their own
// deadlines when competing with other files in a broad coverage run.
const lateCoverageTestPatterns = ["packages/dalph/test/conformance/disposition-cleanup-recovery-prefixes.test.ts"]
const serialCoverageTestPatterns = [
  "packages/dalph/test/cassettes/distinct-finality.test.ts",
  "scripts/quint-ci-contract.test.ts"
]
const resourceSensitiveCoverageTestPatterns = [...lateCoverageTestPatterns, ...serialCoverageTestPatterns]
const ordinaryTestTimeoutMilliseconds = 10_000
const coverageTestTimeoutMilliseconds = 30_000
const ordinaryWorkerCount = 4
// V8 instrumentation and process-custody tests compete for CPU and memory. Two
// workers keep individual 30-second test budgets meaningful on the supported
// local/hosted runners without starving bounded Git process reconciliation.
const coverageWorkerCount = 2
const runDeliveryRepeatability = processEnvironment["DALPH_RUN_DELIVERY_REPEATABILITY"] === "1"
const runIntegrationCapstone = processEnvironment["DALPH_RUN_INTEGRATION_CAPSTONE"] === "1"
const runHistoricalChronology = processEnvironment["DALPH_RUN_HISTORICAL_CHRONOLOGY"] === "1"
const runQualificationTests = processEnvironment["DALPH_RUN_QUALIFICATION_TESTS"] === "1"
const runPublicationIntegration = processEnvironment["DALPH_RUN_PUBLICATION_INTEGRATION"] === "1"
const ordinaryTestIncludes = [
  "src/**/*.test.ts",
  "packages/**/*.test.ts",
  "scripts/**/*.test.ts",
  "scripts/run-delivery-repeatability.test.mjs",
  "test/**/*.test.ts"
]
// These pre-#413 composed cassettes pin an activation's exact scheduler turn.
// Keep them callable while their chronological assertions are reconciled with
// the accepted causal publication boundary.
const historicalChronologyTestPatterns = [
  "packages/dalph/test/cassettes/delivery-predecessor-cleanup.test.ts",
  "packages/dalph/test/cassettes/ds14-final-activation-chronology.test.ts",
  "packages/dalph/test/cassettes/authored-runner-process-lifecycle.test.ts"
]
const selectedTestExcludes = (mode: string) => [
  "**/node_modules/**",
  "**/dist/**",
  ...(mode === "mbt" ? [] : [mbtTestPattern]),
  ...(runPublicationIntegration ? [] : [publicationIntegrationTestPattern]),
  ...(runQualificationTests ? [] : [liveLaunchPreflightIntegrationTestPattern]),
  ...(runQualificationTests || runDeliveryRepeatability
    ? []
    : [deliveryRepeatabilityTestPattern, capabilityRegistrationTestPattern]),
  ...(runQualificationTests || runDeliveryRepeatability || runIntegrationCapstone
    ? []
    : [recordedCatalogCoverageTestPattern]),
  ...(runHistoricalChronology ? [] : historicalChronologyTestPatterns),
  ...(mode === "coverage" ? [performanceTestPattern, publicRecoveryProcessBoundaryTestPattern] : [])
]
// Inline projects do not inherit root Vite aliases. Every test interpretation
// must keep package imports and relative source imports in one implementation.
const currentSourceResolution = {
  alias: {
    "@dalph/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
    "@dalph/dalph": fileURLToPath(new URL("./packages/dalph/src/index.ts", import.meta.url)),
    "@dalph/orchestrator": fileURLToPath(new URL("./packages/orchestrator/src/index.ts", import.meta.url))
  }
}

export default defineConfig(({ mode }) => ({
  resolve: currentSourceResolution,
  test: {
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/*.spec.ts", "test/**"],
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      provider: "v8",
      reportsDirectory: processEnvironment["DALPH_COVERAGE_DIRECTORY"] ?? "coverage",
      reporter: ["text", "json", "html"]
    },
    environment: "node",
    exclude: selectedTestExcludes(mode),
    include: mode === "mbt" ? [mbtTestPattern] : ordinaryTestIncludes,
    maxWorkers: mode === "coverage" ? coverageWorkerCount : ordinaryWorkerCount,
    experimental: {
      // Persist transformed ordinary modules so fresh focused Vitest
      // processes in a bootstrapped worktree do not repeat cold transforms.
      // Full-gate setup removes this generated cache before candidate
      // observation, so it never becomes qualification evidence.
      fsModuleCache: true
    },
    ...(mode === "coverage"
      ? {
          projects: [
            {
              resolve: currentSourceResolution,
              test: {
                exclude: [...selectedTestExcludes(mode), ...resourceSensitiveCoverageTestPatterns],
                include: ordinaryTestIncludes,
                maxWorkers: coverageWorkerCount,
                name: "coverage",
                sequence: { groupOrder: 0 },
                testTimeout: coverageTestTimeoutMilliseconds
              }
            },
            {
              resolve: currentSourceResolution,
              test: {
                exclude: selectedTestExcludes(mode),
                include: lateCoverageTestPatterns,
                maxWorkers: coverageWorkerCount,
                name: "coverage-late",
                sequence: { groupOrder: 1 },
                testTimeout: coverageTestTimeoutMilliseconds
              }
            },
            {
              resolve: currentSourceResolution,
              test: {
                exclude: selectedTestExcludes(mode),
                fileParallelism: false,
                include: serialCoverageTestPatterns,
                maxWorkers: 1,
                name: "coverage-serial",
                sequence: { groupOrder: 2 },
                testTimeout: coverageTestTimeoutMilliseconds
              }
            }
          ]
        }
      : {}),
    ...(mode === "mbt"
      ? {
          // Running the accepted-result model beside the other MBTs can starve
          // their shorter deadlines. Finish the four-worker group first, then
          // give that model one worker without weakening either trace budget.
          projects: [
            {
              resolve: currentSourceResolution,
              test: {
                exclude: [acceptedResultIntegrationMbtTestPattern],
                include: [mbtTestPattern],
                maxWorkers: ordinaryWorkerCount,
                name: "mbt",
                sequence: { groupOrder: 0 }
              }
            },
            {
              resolve: currentSourceResolution,
              test: {
                fileParallelism: false,
                include: [acceptedResultIntegrationMbtTestPattern],
                maxWorkers: 1,
                name: "accepted-result-integration-mbt",
                sequence: { groupOrder: 1 }
              }
            }
          ]
        }
      : {}),
    testTimeout: mode === "coverage" ? coverageTestTimeoutMilliseconds : ordinaryTestTimeoutMilliseconds
  }
}))
