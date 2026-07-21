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
type Summary = {
  rawTestcaseRecords: number;
  logicalTests: number;
  physicalAttempts: number;
  passed: number;
  failed: number;
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
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
function cleanName(value: string): string { return value.replace(/\s*\(?retry\s*\d+\)?\s*$/i, "").replace(/\s+#\d+\s*$/, "").trim(); }
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
    failed: logicalTests.filter(test => test.finalStatus === "failed" || test.finalStatus === "error").length,
    skipped: logicalTests.filter(test => test.finalStatus === "skipped").length,
    flaky: logicalTests.filter(test => test.flaky).length,
    retryCount: logicalTests.reduce((count, test) => count + test.retryCount, 0),
    recoveredAfterRetry: logicalTests.filter(test => test.recoveredAfterRetry).length
  };
}

function parseJUnit(xml: string, metadata: Record<string, any>): TestRun {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Malformed XML: ${validation.err.msg}`);
  const config = getConfig(metadata);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", isArray: (_name, jpath) => String(jpath).endsWith("testcase") }).parse(xml);
  const suites = parsed.testsuites?.testsuite ? asArray(parsed.testsuites.testsuite) : parsed.testsuite ? asArray(parsed.testsuite) : [];
  const rawRecords: RawRecord[] = [];
  let order = 0;
  for (const suite of suites) for (const test of asArray(suite.testcase)) {
    const rawName = text(test["@_name"] || "Unnamed test");
    const testName = cleanName(rawName);
    const suiteName = text(suite["@_name"] || "Unnamed suite");
    const className = text(test["@_classname"] || suite["@_classname"] || "");
    const parameters = text(test["@_parameters"] || test["@_param"] || test["@_parameterId"] || test["@_dataProviderRowId"] || test["@_invocationId"] || test["@_browser"] || test["@_device"] || test["@_region"] || test["@_datasetId"] || "");
    const failure = failureOf(test);
    rawRecords.push({ id: `raw_${++order}`, order, suite: suiteName, className, testName, identity: [suiteName, className, testName, parameters].map(normalize).join("|"), parameters: parameters || undefined, rawStatus: statusOf(test), message: failure?.message, stackTrace: failure?.stack, duration: text(test["@_time"]) || undefined, timestamp: new Date().toISOString() });
  }

  const logicalTests: LogicalTest[] = [];
  const warnings: string[] = [];
  for (const current of rawRecords) {
    const logical = makeLogical([current], false, "COUNT_AS_SKIPPED");
    if (logical) logicalTests.push(logical);
  }
  const summary = summarize(logicalTests, rawRecords);
  if (rawRecords.length === 0) warnings.push("No testcase records were found in the report.");
  if (rawRecords.some((record, index) => rawRecords.slice(0, index).some(previous => previous.identity === record.identity))) warnings.push("Repeated test identities are shown as separate reported results; no retry inference is applied.");
  const id = `run_${crypto.createHash("sha256").update(`${metadata.externalRunId || ""}|${xml}`).digest("hex").slice(0, 16)}`;
  return { id, projectId: config.projectId, build: text(metadata.build || "local"), environment: text(metadata.environment || "default"), adapter: "junit-generic", adapterVersion: "0.4.0", configurationVersion: config.version, retryAnalyzerEnabled: config.retryAnalyzerEnabled, maxRetries: config.maxRetries, retryReportingProfile: config.skippedSequencePolicy, skippedLogicalTestPolicy: config.ordinarySkippedPolicy, ingestedAt: new Date().toISOString(), rawReport: xml, warnings, rawRecords, logicalTests, summary, resultStatus: summary.failed ? "FAILED" : rawRecords.length ? "PASSED" : "UNKNOWN", processingStatus: warnings.length ? "WARNING" : "COMPLETE" };
}

function addFailureGroup(run: TestRun, test: LogicalTest): void {
  const attempt = test.attempts[test.attempts.length - 1];
  const message = attempt.message || "Automated test failure";
  const stack = attempt.stackTrace || message;
  const sig = signature(message, stack);
  const existing = groups.get(sig);
  if (!existing) {
    groups.set(sig, { id: `fg_${sig}`, signature: sig, summary: message.slice(0, 120), message, stackTrace: stack, tests: [test.name], suites: [test.suite], environments: [run.environment], builds: [run.build], occurrences: 1, firstSeen: attempt.timestamp, lastSeen: attempt.timestamp, classification: "unknown", notes: "", recoveredAttempts: 0 });
  } else {
    existing.occurrences += 1;
    existing.lastSeen = attempt.timestamp;
    existing.tests = [...new Set([...existing.tests, test.name])];
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
  await storage.saveRun(publicRun(run));
  for (const group of groups.values()) await storage.saveGroup(group);
  return run;
}
function publicRun(run: TestRun): Omit<TestRun, "rawReport"> { const { rawReport: _rawReport, ...safe } = run; return safe; }
function preview(run: TestRun) { return { runId: run.id, projectId: run.projectId, build: run.build, environment: run.environment, retryAnalyzerEnabled: run.retryAnalyzerEnabled, maxRetries: run.maxRetries, retryReportingProfile: run.retryReportingProfile, warnings: run.warnings, summary: run.summary, resultStatus: run.resultStatus, processingStatus: run.processingStatus, logicalTests: run.logicalTests.map(test => ({ name: test.name, suite: test.suite, className: test.className, parameters: test.parameters, finalStatus: test.finalStatus, attempts: test.attempts.map(attempt => ({ attemptNumber: attempt.attemptNumber, rawStatus: attempt.rawStatus, status: attempt.status })), retryCount: test.retryCount, flaky: test.flaky, recoveredAfterRetry: test.recoveredAfterRetry })) }; }

app.get("/api/retry-config", (req, res) => { const projectId = text(req.query.projectId || "default"); res.json(retryConfigs.get(projectId) ?? getConfig({ projectId })); });
app.get("/api/health", (_req, res) => res.json({ ok: true, storage: storage.persistent ? "postgres" : "memory" }));
app.put("/api/retry-config", (req, res) => { const projectId = text(req.body.projectId || "default"); const config: RetryConfig = { projectId, retryAnalyzerEnabled: false, maxRetries: 0, skippedSequencePolicy: "NORMAL_SKIPPED_SEMANTICS", ordinarySkippedPolicy: "COUNT_AS_SKIPPED", version: "raw-results-v1" }; retryConfigs.set(projectId, config); res.json(config); });
app.get("/api/test-runs", (_req, res) => res.json([...runs.values()].map(publicRun)));
app.get("/api/test-runs/:id", (req, res) => { const run = runs.get(req.params.id); run ? res.json(publicRun(run)) : res.status(404).json({ error: "Test run not found" }); });
app.post("/api/test-runs/preview", upload.single("file"), (req, res) => { if (!req.file) return res.status(400).json({ error: "Attach a JUnit XML file using the 'file' field." }); try { res.json(preview(parseJUnit(req.file.buffer.toString("utf8"), req.body))); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JUnit XML" }); } });
app.post("/api/test-runs", upload.single("file"), async (req, res) => { if (!req.file) return res.status(400).json({ error: "Attach a JUnit XML file using the 'file' field." }); try { const run = await ingest(parseJUnit(req.file.buffer.toString("utf8"), req.body)); res.status(201).json({ run: publicRun(run), preview: preview(run) }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JUnit XML" }); } });
app.get("/api/failure-groups", (_req, res) => res.json([...groups.values()].sort((a, b) => b.occurrences - a.occurrences)));
app.get("/api/failure-groups/:id", (req, res) => { const group = groups.get(req.params.id); group ? res.json(group) : res.status(404).json({ error: "Failure group not found" }); });
app.patch("/api/failure-groups/:id", async (req, res) => { const group = groups.get(req.params.id); if (!group) return res.status(404).json({ error: "Failure group not found" }); if (req.body.classification) group.classification = req.body.classification; if (typeof req.body.notes === "string") group.notes = req.body.notes; if (req.body.jiraIssue) group.jiraIssue = req.body.jiraIssue; await storage.saveGroup(group); res.json(group); });
app.post("/api/demo/seed", async (req, res) => {
  const body = req.body || {};
  const demoXml = `<?xml version="1.0"?><testsuites><testsuite name="Demo checkout"><testcase classname="LoginTest" name="validLogin"/><testcase classname="CheckoutTest" name="submitOrder"><failure message="checkout failed">checkout failed at checkout.ts:1</failure></testcase><testcase classname="ProfileTest" name="loadProfile"><skipped/></testcase><testcase classname="SearchTest" name="searchProducts"/><testcase classname="CartTest" name="addItem"><error message="cart setup error">cart setup error at cart.ts:4</error></testcase><testcase classname="InventoryTest" name="checkStock"/><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"/><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><skipped/></testcase></testsuite></testsuites>`;
  const run = await ingest(parseJUnit(demoXml, { projectId: body.projectId || "default", build: "demo-mixed-report", environment: "demo", externalRunId: `demo-mixed-report-${Date.now()}` }));
  res.json({ ok: true, scenario: "mixed-report", run: publicRun(run), preview: preview(run) });
});
createStorage().then(async configuredStorage => {
  storage = configuredStorage;
  const state = await storage.load();
  state.runs.forEach(run => runs.set(run.id, run));
  state.groups.forEach(group => groups.set(group.id, group));
  app.listen(Number(process.env.PORT) || 3000, () => console.log(`Automation Failure Intelligence running on http://localhost:${Number(process.env.PORT) || 3000}`));
}).catch(error => { console.error("Storage startup failed; using in-memory storage:", error); storage = { persistent: false, load: async () => ({ runs: [], groups: [] }), saveRun: async () => undefined, saveGroup: async () => undefined }; app.listen(Number(process.env.PORT) || 3000, () => console.log("Automation Failure Intelligence running without persistent storage.")); });



