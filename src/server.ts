import express from "express";
import multer from "multer";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import crypto from "node:crypto";
import path from "node:path";
import { createStorage, type Storage } from "./storage.js";

type RawStatus = "PASSED" | "FAILED" | "SKIPPED" | "ERROR" | "UNKNOWN";
type Status = "passed" | "failed" | "skipped" | "error" | "unknown";
type RetryProfile = "NORMAL_SKIPPED_SEMANTICS" | "SKIPPED_THEN_TERMINAL_IS_RETRY";
type SkippedPolicy = "COUNT_AS_SKIPPED" | "EXCLUDE_FROM_LOGICAL_TOTALS";
type Classification = "product-defect" | "test-defect" | "environment-issue" | "test-data-issue" | "known-failure" | "duplicate" | "unknown";

type RetryConfig = {
  projectId: string;
  retryAnalyzerEnabled: boolean;
  maxRetries: number;
  skippedSequencePolicy: RetryProfile;
  ordinarySkippedPolicy: SkippedPolicy;
  version: string;
};
type RawRecord = {
  id: string;
  order: number;
  suite: string;
  className: string;
  testName: string;
  identity: string;
  parameters?: string;
  rawStatus: RawStatus;
  message?: string;
  stackTrace?: string;
  duration?: string;
  timestamp: string;
};
type Attempt = RawRecord & { attemptNumber: number; status: Status };
type LogicalTest = {
  id: string;
  identity: string;
  name: string;
  suite: string;
  className: string;
  parameters?: string;
  attempts: Attempt[];
  finalStatus: Status;
  retryCount: number;
  flaky: boolean;
  recoveredAfterRetry: boolean;
};
type ReportMetadata = {
  framework?: string;
  name?: string;
  tests?: string;
  failures?: string;
  errors?: string;
  skipped?: string;
  time?: string;
  properties: Record<string, string>;
};
type Summary = {
  rawTestcaseRecords: number;
  logicalTests: number;
  physicalAttempts: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  flaky: number;
  retryCount: number;
  recoveredAfterRetry: number;
};
type TestRun = {
  id: string;
  projectId: string;
  build: string;
  environment: string;
  adapter: string;
  adapterVersion: string;
  configurationVersion: string;
  retryAnalyzerEnabled: boolean;
  maxRetries: number;
  retryReportingProfile: RetryProfile;
  skippedLogicalTestPolicy: SkippedPolicy;
  ingestedAt: string;
  rawReport: string;
  reportMetadata: ReportMetadata;
  warnings: string[];
  rawRecords: RawRecord[];
  logicalTests: LogicalTest[];
  summary: Summary;
  resultStatus: "PASSED" | "FAILED" | "UNKNOWN";
  processingStatus: "COMPLETE" | "WARNING";
  duplicate?: boolean;
};
type FailureGroup = {
  id: string;
  signature: string;
  summary: string;
  message: string;
  stackTrace: string;
  tests: string[];
  testIds: string[];
  runs: string[];
  outcomes: Array<"FAILED" | "ERROR">;
  evidence: Array<{ runId: string; testId: string; testName: string; outcome: "FAILED" | "ERROR"; build: string; environment: string }>;
  suites: string[];
  environments: string[];
  builds: string[];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  classification: Classification;
  notes: string;
  recoveredAttempts: number;
  jiraIssue?: { key: string; url?: string };
};

const app = express();
const maxReportBytes = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxReportBytes } });
const runs = new Map<string, TestRun>();
const groups = new Map<string, FailureGroup>();
const retryConfigs = new Map<string, RetryConfig>();
let storage: Storage;

app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

function text(value: unknown): string { return typeof value === "string" ? value : value == null ? "" : String(value); }
function asArray<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function normalize(value: string): string { return value.replace(/https?:\/\/[^\s"']+/gi, "<URL>").replace(/\s+/g, " ").trim().toLowerCase(); }
function bool(value: unknown): boolean { return value === true || value === "true" || value === "1"; }
function statusOf(test: any): RawStatus { if (test.failure !== undefined) return "FAILED"; if (test.error !== undefined) return "ERROR"; if (test.skipped !== undefined) return "SKIPPED"; return "PASSED"; }
function statusValue(status: RawStatus): Status { return status.toLowerCase() as Status; }
function profile(value: unknown): RetryProfile { return value === "SKIPPED_THEN_TERMINAL_IS_RETRY" ? value : "NORMAL_SKIPPED_SEMANTICS"; }
function skippedPolicy(value: unknown): SkippedPolicy { return value === "EXCLUDE_FROM_LOGICAL_TOTALS" ? value : "COUNT_AS_SKIPPED"; }
function failureOf(test: any): { message: string; stack: string } | undefined { const failure = test.failure ?? test.error; if (failure === undefined) return undefined; const message = text(failure["@_message"] || failure["#text"] || "Automated test failure"); return { message, stack: text(failure["#text"] || message) }; }
function signature(message: string, stack: string): string { return crypto.createHash("sha256").update(`${normalize(message)}|${normalize(stack).split(" at ")[0]}`).digest("hex").slice(0, 16); }

function getConfig(metadata: Record<string, any>): RetryConfig {
  const projectId = text(metadata.projectId || "default");
  return {
    projectId,
    retryAnalyzerEnabled: false,
    maxRetries: 0,
    skippedSequencePolicy: "NORMAL_SKIPPED_SEMANTICS",
    ordinarySkippedPolicy: "COUNT_AS_SKIPPED",
    version: "raw-results-v1"
  };
}

function makeLogical(records: RawRecord[], isRetry: boolean, skippedPolicyValue: SkippedPolicy): LogicalTest | undefined {
  const attempts = records.map((record, index) => ({ ...record, attemptNumber: index + 1, status: statusValue(record.rawStatus) }));
  const final = attempts[attempts.length - 1];
  if (final.rawStatus === "SKIPPED" && skippedPolicyValue === "EXCLUDE_FROM_LOGICAL_TOTALS") return undefined;
  const recovered = isRetry && final.rawStatus === "PASSED";
  return {
    id: `test_${crypto.createHash("sha1").update(records.map(record => record.id).join("|")).digest("hex").slice(0, 12)}`,
    identity: records[0].identity,
    name: records[0].testName,
    suite: records[0].suite,
    className: records[0].className,
    parameters: records[0].parameters,
    attempts,
    finalStatus: final.status,
    retryCount: isRetry ? 1 : 0,
    flaky: recovered,
    recoveredAfterRetry: recovered
  };
}

function summarize(logicalTests: LogicalTest[], rawRecords: RawRecord[]): Summary {
  return {
    rawTestcaseRecords: rawRecords.length,
    logicalTests: logicalTests.length,
    physicalAttempts: rawRecords.length,
    passed: logicalTests.filter(test => test.finalStatus === "passed").length,
    failed: logicalTests.filter(test => test.finalStatus === "failed").length,
    errors: logicalTests.filter(test => test.finalStatus === "error").length,
    skipped: logicalTests.filter(test => test.finalStatus === "skipped").length,
    flaky: logicalTests.filter(test => test.flaky).length,
    retryCount: logicalTests.reduce((count, test) => count + test.retryCount, 0),
    recoveredAfterRetry: logicalTests.filter(test => test.recoveredAfterRetry).length
  };
}

function reportMetadataOf(root: any): ReportMetadata {
  const properties: Record<string, string> = {};
  for (const property of asArray(root?.properties?.property)) {
    const name = text(property?.["@_name"]);
    if (name) properties[name] = text(property?.["@_value"] || property?.["#text"]);
  }
  return {
    ...((root?.["@_framework"] || root?.["@_frameworkName"] || root?.["@_producer"] || root?.["@_generator"]) ? { framework: text(root["@_framework"] || root["@_frameworkName"] || root["@_producer"] || root["@_generator"]) } : {}),
    ...(root?.["@_name"] ? { name: text(root["@_name"]) } : {}),
    ...(root?.["@_tests"] ? { tests: text(root["@_tests"]) } : {}),
    ...(root?.["@_failures"] ? { failures: text(root["@_failures"]) } : {}),
    ...(root?.["@_errors"] ? { errors: text(root["@_errors"]) } : {}),
    ...(root?.["@_skipped"] ? { skipped: text(root["@_skipped"]) } : {}),
    ...(root?.["@_time"] ? { time: text(root["@_time"]) } : {}),
    properties
  };
}

type AdapterId = "junit-generic" | "pytest" | "maven-surefire" | "nunit" | "xunit" | "jest" | "playwright" | "cypress";
const explicitFrameworkPropertyNames = new Set(["framework", "framework.name", "test.framework", "reporter", "generator", "producer"]);

function adapterFor(reportMetadata: ReportMetadata): { id: AdapterId; warning?: string } {
  const explicit = reportMetadata.framework || Object.entries(reportMetadata.properties).find(([name]) => explicitFrameworkPropertyNames.has(name.toLowerCase()))?.[1];
  if (!explicit) return { id: "junit-generic" };
  const value = explicit.toLowerCase();
  const known: Array<[string, AdapterId]> = [
    ["surefire", "maven-surefire"],
    ["pytest", "pytest"],
    ["nunit", "nunit"],
    ["xunit", "xunit"],
    ["jest", "jest"],
    ["playwright", "playwright"],
    ["cypress", "cypress"]
  ];
  const match = known.find(([marker]) => value.includes(marker));
  if (match) return { id: match[1] };
  return { id: "junit-generic", warning: `Explicit framework metadata '${explicit}' was reported, but no specialized adapter is registered; generic JUnit semantics were used.` };
}

function parseJUnit(xml: string, metadata: Record<string, any>): TestRun {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Malformed XML: ${validation.err.msg}`);
  const config = getConfig(metadata);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", isArray: (_name, jpath) => String(jpath).endsWith("testcase") }).parse(xml);
  const root = parsed.testsuites || parsed.testsuite || {};
  const suites = parsed.testsuites?.testsuite ? asArray(parsed.testsuites.testsuite) : parsed.testsuite ? [parsed.testsuite] : [];
  const rawRecords: RawRecord[] = [];
  let order = 0;
  const visitSuite = (suite: any, parentPath: string[] = []): void => {
    const suiteName = text(suite?.["@_name"] || "Unnamed suite");
    const suitePath = [...parentPath, suiteName];
    for (const test of asArray(suite?.testcase)) {
    const rawName = text(test["@_name"] || "Unnamed test");
    const testName = rawName;
    const className = text(test["@_classname"] || suite["@_classname"] || "");
    const parameters = text(test["@_parameters"] || test["@_param"] || test["@_parameterId"] || test["@_dataProviderRowId"] || test["@_invocationId"] || test["@_browser"] || test["@_device"] || test["@_region"] || test["@_datasetId"] || "");
    const failure = failureOf(test);
    rawRecords.push({ id: `raw_${++order}`, order, suite: suitePath.join(" / "), className, testName, identity: [suitePath.join(" / "), className, testName, parameters].map(normalize).join("|"), parameters: parameters || undefined, rawStatus: statusOf(test), message: failure?.message, stackTrace: failure?.stack, duration: text(test["@_time"]) || undefined, timestamp: new Date().toISOString() });
    }
    for (const child of asArray(suite?.testsuite)) visitSuite(child, suitePath);
  };
  for (const suite of suites) visitSuite(suite);
  const reportMetadata = reportMetadataOf(root);
  const adapter = adapterFor(reportMetadata);

  const logicalTests: LogicalTest[] = [];
  const warnings: string[] = [];
  if (adapter.warning) warnings.push(adapter.warning);
  for (const current of rawRecords) {
    const logical = makeLogical([current], false, "COUNT_AS_SKIPPED");
    if (logical) logicalTests.push(logical);
  }
  const summary = summarize(logicalTests, rawRecords);
  if (rawRecords.length === 0) warnings.push("No testcase records were found in the report.");
  const identities = new Set<string>();
  const hasRepeatedIdentity = rawRecords.some(record => {
    if (identities.has(record.identity)) return true;
    identities.add(record.identity);
    return false;
  });
  if (hasRepeatedIdentity) warnings.push("Repeated test identities are shown as separate reported results; no retry inference is applied.");
  const id = `run_${crypto.createHash("sha256").update(`${metadata.externalRunId || ""}|${xml}`).digest("hex").slice(0, 16)}`;
  return { id, projectId: config.projectId, build: text(metadata.build || "local"), environment: text(metadata.environment || "default"), adapter: adapter.id, adapterVersion: "0.6.0", configurationVersion: config.version, retryAnalyzerEnabled: config.retryAnalyzerEnabled, maxRetries: config.maxRetries, retryReportingProfile: config.skippedSequencePolicy, skippedLogicalTestPolicy: config.ordinarySkippedPolicy, ingestedAt: new Date().toISOString(), rawReport: xml, reportMetadata, warnings, rawRecords, logicalTests, summary, resultStatus: summary.failed || summary.errors ? "FAILED" : rawRecords.length ? "PASSED" : "UNKNOWN", processingStatus: warnings.length ? "WARNING" : "COMPLETE" };
}

function addFailureGroup(run: TestRun, test: LogicalTest): void {
  const attempt = test.attempts[test.attempts.length - 1];
  const message = attempt.message || "Automated test failure";
  const stack = attempt.stackTrace || message;
  const sig = signature(message, stack);
  const existing = groups.get(sig);
  if (!existing) {
    groups.set(sig, { id: `fg_${sig}`, signature: sig, summary: message.slice(0, 120), message, stackTrace: stack, tests: [test.name], testIds: [test.id], runs: [run.id], outcomes: [test.finalStatus === "error" ? "ERROR" : "FAILED"], evidence: [{ runId: run.id, testId: test.id, testName: test.name, outcome: test.finalStatus === "error" ? "ERROR" : "FAILED", build: run.build, environment: run.environment }], suites: [test.suite], environments: [run.environment], builds: [run.build], occurrences: 1, firstSeen: attempt.timestamp, lastSeen: attempt.timestamp, classification: "unknown", notes: "", recoveredAttempts: 0 });
  } else {
    existing.occurrences += 1;
    existing.lastSeen = attempt.timestamp;
    existing.tests = [...new Set([...existing.tests, test.name])];
    existing.testIds = [...new Set([...(existing.testIds || []), test.id])];
    existing.runs = [...new Set([...(existing.runs || []), run.id])];
    existing.outcomes = [...new Set<"FAILED" | "ERROR">([...(existing.outcomes || []), test.finalStatus === "error" ? "ERROR" : "FAILED"])];
    const outcome: "FAILED" | "ERROR" = test.finalStatus === "error" ? "ERROR" : "FAILED";
    existing.evidence = [...(existing.evidence || []), { runId: run.id, testId: test.id, testName: test.name, outcome, build: run.build, environment: run.environment }].filter((item, index, items) => items.findIndex(other => other.runId === item.runId && other.testId === item.testId) === index);
    existing.suites = [...new Set([...existing.suites, test.suite])];
    existing.environments = [...new Set([...existing.environments, run.environment])];
    existing.builds = [...new Set([...existing.builds, run.build])];
  }
}

async function ingest(run: TestRun): Promise<TestRun> {
  const existing = runs.get(run.id);
  if (existing) { existing.duplicate = true; return existing; }
  runs.set(run.id, run);
  run.logicalTests.filter(test => test.finalStatus === "failed" || test.finalStatus === "error").forEach(test => addFailureGroup(run, test));
  await storage.saveRun(run);
  for (const group of groups.values()) await storage.saveGroup(group);
  return run;
}
function publicRun(run: TestRun): Omit<TestRun, "rawReport"> { const { rawReport: _rawReport, ...safe } = run; return safe; }
function preview(run: TestRun) { return { runId: run.id, projectId: run.projectId, build: run.build, environment: run.environment, adapter: run.adapter, adapterVersion: run.adapterVersion, reportMetadata: run.reportMetadata, retryAnalyzerEnabled: run.retryAnalyzerEnabled, maxRetries: run.maxRetries, retryReportingProfile: run.retryReportingProfile, warnings: run.warnings, summary: run.summary, resultStatus: run.resultStatus, processingStatus: run.processingStatus, logicalTests: run.logicalTests.map(test => ({ name: test.name, suite: test.suite, className: test.className, parameters: test.parameters, finalStatus: test.finalStatus, attempts: test.attempts.map(attempt => ({ attemptNumber: attempt.attemptNumber, rawStatus: attempt.rawStatus, status: attempt.status })), retryCount: test.retryCount, flaky: test.flaky, recoveredAfterRetry: test.recoveredAfterRetry })) }; }

app.get("/api/retry-config", (req, res) => { const projectId = text(req.query.projectId || "default"); res.json(retryConfigs.get(projectId) ?? getConfig({ projectId })); });
app.get("/api/health", (_req, res) => res.json({ ok: true, storage: storage.persistent ? "postgres" : "memory", storageVariable: storage.variable || null, storageError: storage.error || null }));
app.put("/api/retry-config", (req, res) => { const projectId = text(req.body.projectId || "default"); const config: RetryConfig = { projectId, retryAnalyzerEnabled: false, maxRetries: 0, skippedSequencePolicy: "NORMAL_SKIPPED_SEMANTICS", ordinarySkippedPolicy: "COUNT_AS_SKIPPED", version: "raw-results-v1" }; retryConfigs.set(projectId, config); res.json(config); });
app.get("/api/test-runs", (req, res) => {
  const requestedStatus = text(req.query.status).trim().toUpperCase();
  const allowedStatuses = new Set(["PASSED", "FAILED", "ERROR", "SKIPPED"]);
  if (requestedStatus && !allowedStatuses.has(requestedStatus)) return res.status(400).json({ error: "status must be PASSED, FAILED, ERROR, or SKIPPED." });
  const query = normalize(text(req.query.q));
  const result = [...runs.values()].filter(run => {
    const statusMatch = !requestedStatus || run.logicalTests.some(test => test.finalStatus.toUpperCase() === requestedStatus);
    const searchText = normalize([run.build, run.environment, ...run.logicalTests.flatMap(test => [test.name, test.className, test.suite, test.parameters || ""])].join(" "));
    return statusMatch && (!query || searchText.includes(query));
  }).map(publicRun);
  res.json(result);
});
app.get("/api/test-runs/:id", (req, res) => { const run = runs.get(req.params.id); run ? res.json(publicRun(run)) : res.status(404).json({ error: "Test run not found" }); });
app.post("/api/test-runs/preview", upload.single("file"), (req, res) => { if (!req.file) return res.status(400).json({ error: "Attach a JUnit XML file using the 'file' field." }); try { res.json(preview(parseJUnit(req.file.buffer.toString("utf8"), req.body))); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JUnit XML" }); } });
app.post("/api/test-runs", upload.single("file"), async (req, res) => { if (!req.file) return res.status(400).json({ error: "Attach a JUnit XML file using the 'file' field." }); try { const run = await ingest(parseJUnit(req.file.buffer.toString("utf8"), req.body)); res.status(201).json({ run: publicRun(run), preview: preview(run) }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JUnit XML" }); } });
app.get("/api/failure-groups", (req, res) => {
  const runId = text(req.query.runId).trim();
  const outcome = text(req.query.outcome).trim().toUpperCase();
  const classification = text(req.query.classification).trim().toLowerCase();
  const query = normalize(text(req.query.q));
  if (outcome && outcome !== "FAILED" && outcome !== "ERROR") return res.status(400).json({ error: "outcome must be FAILED or ERROR." });
  const result = [...groups.values()].filter(group => {
    const runMatch = !runId || (group.runs || []).includes(runId);
    const outcomeMatch = !outcome || (group.outcomes || []).includes(outcome as "FAILED" | "ERROR");
    const classificationMatch = !classification || group.classification === classification;
    const searchText = normalize([group.summary, group.message, ...(group.tests || [])].join(" "));
    return runMatch && outcomeMatch && classificationMatch && (!query || searchText.includes(query));
  }).map(group => {
    if (!runId) return group;
    const evidence = (group.evidence || []).filter(item => item.runId === runId);
    return {
      ...group,
      selectedRunOccurrences: evidence.length || ((group.runs || []).includes(runId) ? 1 : 0),
      selectedRunTests: [...new Set(evidence.map(item => item.testName))],
      selectedRunRuns: [runId]
    };
  }).filter(group => !runId || (group as any).selectedRunOccurrences >= 2)
    .sort((a, b) => (((b as any).selectedRunOccurrences ?? b.occurrences) - ((a as any).selectedRunOccurrences ?? a.occurrences)));
  res.json(result);
});
app.get("/api/failure-groups/:id", (req, res) => { const group = [...groups.values()].find(item => item.id === req.params.id); group ? res.json(group) : res.status(404).json({ error: "Failure group not found" }); });
app.patch("/api/failure-groups/:id", async (req, res) => {
  const group = [...groups.values()].find(item => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Failure group not found" });
  const classifications: Classification[] = ["product-defect", "test-defect", "environment-issue", "test-data-issue", "known-failure", "duplicate", "unknown"];
  if (req.body.classification !== undefined) {
    if (!classifications.includes(req.body.classification)) return res.status(400).json({ error: "Invalid classification." });
    group.classification = req.body.classification;
  }
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== "string") return res.status(400).json({ error: "notes must be a string." });
    group.notes = req.body.notes;
  }
  if (req.body.jiraIssue === null) delete group.jiraIssue;
  else if (req.body.jiraIssue !== undefined) {
    if (!req.body.jiraIssue || typeof req.body.jiraIssue.key !== "string") return res.status(400).json({ error: "jiraIssue.key must be a string." });
    group.jiraIssue = { key: req.body.jiraIssue.key, ...(typeof req.body.jiraIssue.url === "string" ? { url: req.body.jiraIssue.url } : {}) };
  }
  await storage.saveGroup(group);
  res.json(group);
});
async function clearLegacyDemoData(): Promise<void> {
  const legacyIds = [...runs.values()].filter(run => run.build === "demo-mixed-report").map(run => run.id);
  if (!legacyIds.length) return;
  for (const id of legacyIds) { runs.delete(id); await storage.deleteRun(id); }
  for (const [key, group] of groups.entries()) {
    const remainingRuns = (group.runs || []).filter(runId => !legacyIds.includes(runId));
    if (remainingRuns.length === 0 && (group.runs || []).some(runId => legacyIds.includes(runId))) {
      groups.delete(key);
      await storage.deleteGroup(group.id);
      continue;
    }
    if (remainingRuns.length !== (group.runs || []).length) {
      group.runs = remainingRuns;
      group.evidence = (group.evidence || []).filter(item => !legacyIds.includes(item.runId));
      group.occurrences = group.evidence.length || remainingRuns.length;
      await storage.saveGroup(group);
    }
  }
}

app.post("/api/demo/seed", async (req, res) => {
  const body = req.body || {};
  await clearLegacyDemoData();
  const reports = [
    { id: "demo-baseline", build: "demo-baseline", xml: `<?xml version="1.0"?><testsuites><testsuite name="Baseline checkout"><testcase classname="LoginTest" name="validLogin"/><testcase classname="CheckoutTest" name="submitOrder"><failure message="checkout failed">checkout failed at checkout.ts:1</failure></testcase><testcase classname="ProfileTest" name="loadProfile"><skipped/></testcase><testcase classname="SearchTest" name="searchProducts"/><testcase classname="CartTest" name="addItem"><error message="cart setup error">cart setup error at cart.ts:4</error></testcase><testcase classname="InventoryTest" name="checkStock"/></testsuite></testsuites>` },
    { id: "demo-clean-pass", build: "demo-clean-pass", xml: `<?xml version="1.0"?><testsuites><testsuite name="Clean checkout"><testcase classname="LoginTest" name="validLogin"/><testcase classname="CheckoutTest" name="submitOrder"/><testcase classname="ProfileTest" name="loadProfile"/><testcase classname="SearchTest" name="searchProducts"/><testcase classname="InventoryTest" name="checkStock"/></testsuite></testsuites>` },
    { id: "demo-shared-failure", build: "demo-shared-failure", xml: `<?xml version="1.0"?><testsuites><testsuite name="Shared failure investigation"><testcase classname="CheckoutTest" name="submitOrder"><failure message="database unavailable">connection refused</failure></testcase><testcase classname="PaymentTest" name="chargeCard"><failure message="database unavailable">connection refused</failure></testcase><testcase classname="LoginTest" name="validLogin"/><testcase classname="ProfileTest" name="loadProfile"/><testcase classname="SearchTest" name="searchProducts"/></testsuite></testsuites>` },
    { id: "demo-expanded", build: "demo-expanded", xml: `<?xml version="1.0"?><testsuites><testsuite name="Expanded checkout"><testcase classname="LoginTest" name="validLogin"/><testcase classname="CheckoutTest" name="submitOrder"><failure message="checkout failed">checkout failed at checkout.ts:1</failure></testcase><testcase classname="ProfileTest" name="loadProfile"><skipped/></testcase><testcase classname="SearchTest" name="searchProducts"/><testcase classname="CartTest" name="addItem"><error message="cart setup error">cart setup error at cart.ts:4</error></testcase><testcase classname="InventoryTest" name="checkStock"/><testcase classname="NotificationTest" name="sendReceipt"/><testcase classname="AuditTest" name="recordOrder"/></testsuite></testsuites>` }
  ];
  const ingested = [];
  for (const report of reports) ingested.push(await ingest(parseJUnit(report.xml, { projectId: body.projectId || "default", build: report.build, environment: "demo", externalRunId: report.id })));
  const selected = ingested[ingested.length - 1];
  res.json({ ok: true, scenario: "demo-pack", runs: ingested.map(publicRun), run: publicRun(selected), preview: preview(selected) });
});
createStorage().then(async configuredStorage => {
  storage = configuredStorage;
  const state = await storage.load();
  state.runs.forEach(run => runs.set(run.id, run));
  // Ingestion indexes groups by signature. Keep the same key after reload so a
  // repeated report updates the existing group instead of creating a duplicate.
  // The first row is newest because storage loads groups by updated_at DESC.
  state.groups.forEach(group => { if (!groups.has(group.signature)) groups.set(group.signature, group); });
  app.listen(Number(process.env.PORT) || 3000, () => console.log(`Automation Failure Intelligence running on http://localhost:${Number(process.env.PORT) || 3000}`));
}).catch(error => { console.error("Storage startup failed; using in-memory storage:", error); storage = { persistent: false, load: async () => ({ runs: [], groups: [] }), saveRun: async () => undefined, saveGroup: async () => undefined, deleteRun: async () => undefined, deleteGroup: async () => undefined }; app.listen(Number(process.env.PORT) || 3000, () => console.log("Automation Failure Intelligence running without persistent storage.")); });


