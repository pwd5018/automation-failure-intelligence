import express from "express";
import multer from "multer";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import crypto from "node:crypto";
import path from "node:path";

type RawStatus = "PASSED" | "FAILED" | "SKIPPED" | "ERROR" | "UNKNOWN";
type Status = "passed" | "failed" | "skipped" | "error" | "unknown";
type SemanticRole = "NORMAL_RESULT" | "RETRY_TRIGGERED_FAILURE" | "RETRY_TERMINAL_RESULT" | "UNRESOLVED" | "IGNORED";
type RetryProfile = "NORMAL_SKIPPED_SEMANTICS" | "SKIPPED_THEN_TERMINAL_IS_RETRY";
type SkippedPolicy = "COUNT_AS_SKIPPED" | "EXCLUDE_FROM_LOGICAL_TOTALS";
type ResolutionType = "TREAT_AS_RETRIES" | "TREAT_AS_SEPARATE_INVOCATIONS" | "TREAT_FIRST_RETRY_THEN_SEPARATE" | "IGNORE_RECORDS";
type Classification = "product-defect" | "test-defect" | "environment-issue" | "test-data-issue" | "known-failure" | "duplicate" | "unknown";
type AmbiguousPolicy = "REQUIRE_REVIEW";
type RetryConfig = { projectId: string; retryAnalyzerEnabled: boolean; maxRetries: number; skippedSequencePolicy: RetryProfile; ordinarySkippedPolicy: SkippedPolicy; ambiguousDuplicatePolicy: AmbiguousPolicy; version: string };

type RawRecord = { id: string; order: number; suite: string; className: string; testName: string; identity: string; parameters?: string; rawStatus: RawStatus; semanticRole: SemanticRole; message?: string; stackTrace?: string; duration?: string; timestamp: string; sourceFile?: string; properties?: Record<string, string>; retryMarker?: boolean };
type Attempt = RawRecord & { attemptNumber: number; status: Status };
type LogicalInvocation = { id: string; definition: string; identity: string; name: string; suite: string; className: string; parameters?: string; attempts: Attempt[]; finalStatus: Status; retryCount: number; attemptCount: number; flaky: boolean; recoveredAfterRetry: boolean };
type UnresolvedGroup = { id: string; identity: string; records: RawRecord[]; reason: string; candidateInterpretations: string[]; resolution?: { type: ResolutionType; scope: "THIS_GROUP"; resolver?: string; resolvedAt: string } };
type Summary = { rawTestcaseRecords: number; resolvedLogicalInvocations: number; unresolvedGroups: number; unresolvedRawRecords: number; passed: number; failed: number; skipped: number; flaky: number; retryCount: number; recoveredAfterRetry: number; physicalAttempts: number };
type TestRun = { id: string; externalRunId?: string; projectId: string; adapter: string; adapterVersion: string; configurationVersion: string; build: string; environment: string; retryAnalyzerEnabled: boolean; maxRetries: number; retryReportingProfile: RetryProfile; skippedLogicalTestPolicy: SkippedPolicy; ambiguousDuplicatePolicy: AmbiguousPolicy; ingestedAt: string; rawReport: string; warnings: string[]; rawRecords: RawRecord[]; logicalInvocations: LogicalInvocation[]; unresolvedGroups: UnresolvedGroup[]; summary: Summary; resultStatus: "PASSED" | "FAILED" | "PARTIAL" | "UNKNOWN"; processingStatus: "COMPLETE" | "NEEDS_REVIEW" | "REJECTED"; physicalAttempts: number; duplicate?: boolean; resolutionAudit: Array<{ groupId: string; type: ResolutionType; scope: "THIS_GROUP"; resolvedAt: string; resolver?: string }> };
type FailureGroup = { id: string; signature: string; summary: string; message: string; stackTrace: string; tests: string[]; suites: string[]; environments: string[]; builds: string[]; occurrences: number; firstSeen: string; lastSeen: string; classification: Classification; notes: string; recoveredAttempts: number; jiraIssue?: { key: string; url?: string } };

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const groups = new Map<string, FailureGroup>();
const runs = new Map<string, TestRun>();
const retryConfigs = new Map<string, RetryConfig>();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

function normalize(value: string): string { return value.replace(/https?:\/\/[^\s"']+/gi, "<URL>").replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.+-]+\b/g, "<TIMESTAMP>").replace(/\b(session|request|trace|run|execution)[-_ ]?id[:= ]+[a-z0-9-]+\b/gi, "$1-id:<ID>").replace(/\b[0-9a-f]{8,}\b/gi, "<ID>").replace(/:\d+\b/g, ":<LINE>").replace(/\s+/g, " ").trim().toLowerCase(); }
function asArray<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function text(value: unknown): string { return typeof value === "string" ? value : value == null ? "" : String(value); }
function signature(message: string, stack: string): string { return crypto.createHash("sha256").update([normalize(message), normalize(stack).split(" at ")[0]].join("|")).digest("hex").slice(0, 16); }
function statusOf(test: any): RawStatus { if (test.failure !== undefined) return "FAILED"; if (test.error !== undefined) return "ERROR"; if (test.skipped !== undefined) return "SKIPPED"; return "PASSED"; }
function statusValue(status: RawStatus): Status { return status.toLowerCase() as Status; }
function failureOf(test: any): { message: string; stack: string } | undefined { const failure = test.failure ?? test.error; if (!failure) return undefined; const message = text(failure["@_message"] || failure["#text"] || "Automated test failure"); return { message, stack: text(failure["#text"] || message) }; }
function cleanTestName(name: string): string { return name.replace(/\s*\(?retry\s*\d+\)?\s*$/i, "").replace(/\s+#\d+\s*$/, "").trim(); }
function profile(value: unknown): RetryProfile { return value === "SKIPPED_THEN_TERMINAL_IS_RETRY" ? value : "NORMAL_SKIPPED_SEMANTICS"; }
function skippedPolicy(value: unknown): SkippedPolicy { return value === "EXCLUDE_FROM_LOGICAL_TOTALS" ? value : "COUNT_AS_SKIPPED"; }
function bool(value: unknown): boolean { return value === true || value === "true" || value === "1"; }
function retryConfig(metadata: Record<string, string>): RetryConfig {
  const projectId = text(metadata.projectId || "default"); const stored = retryConfigs.get(projectId);
  const explicitProfile = metadata.retryReportingProfile === "SKIPPED_THEN_TERMINAL_IS_RETRY";
  const enabled = metadata.retryAnalyzerEnabled !== undefined ? bool(metadata.retryAnalyzerEnabled) : stored?.retryAnalyzerEnabled ?? explicitProfile;
  const selectedProfile = metadata.retryReportingProfile ? profile(metadata.retryReportingProfile) : stored?.skippedSequencePolicy ?? (enabled ? "SKIPPED_THEN_TERMINAL_IS_RETRY" : "NORMAL_SKIPPED_SEMANTICS");
  const maxRetries = Math.max(0, Math.min(10, Number(metadata.maxRetries ?? stored?.maxRetries ?? (enabled ? 1 : 0)) || 0));
  return { projectId, retryAnalyzerEnabled: enabled, maxRetries, skippedSequencePolicy: enabled ? selectedProfile : "NORMAL_SKIPPED_SEMANTICS", ordinarySkippedPolicy: metadata.skippedLogicalTestPolicy ? skippedPolicy(metadata.skippedLogicalTestPolicy) : stored?.ordinarySkippedPolicy ?? "COUNT_AS_SKIPPED", ambiguousDuplicatePolicy: "REQUIRE_REVIEW", version: stored?.version ?? "retry-config-v1" };
}

function makeAttempt(record: RawRecord, attemptNumber: number, role: SemanticRole): Attempt { return { ...record, semanticRole: role, attemptNumber, status: statusValue(record.rawStatus) }; }
function invocation(records: RawRecord[], retry: boolean, skipped: SkippedPolicy): LogicalInvocation | undefined {
  if (!records.length) return undefined;
  const attempts = records.map((r, i) => makeAttempt(r, i + 1, retry && i === 0 ? "RETRY_TRIGGERED_FAILURE" : retry ? "RETRY_TERMINAL_RESULT" : "NORMAL_RESULT"));
  const final = attempts[attempts.length - 1];
  if (final.rawStatus === "SKIPPED" && skipped === "EXCLUDE_FROM_LOGICAL_TOTALS") return undefined;
  const flaky = retry && attempts.length > 1 && final.rawStatus === "PASSED";
  return { id: `inv_${crypto.createHash("sha1").update(records.map(r => r.id).join("|")).digest("hex").slice(0, 12)}`, definition: `${records[0].className}.${records[0].testName}`, identity: records[0].identity, name: records[0].testName, suite: records[0].suite, className: records[0].className, parameters: records[0].parameters, attempts, finalStatus: final.status, retryCount: retry ? attempts.length - 1 : 0, attemptCount: attempts.length, flaky, recoveredAfterRetry: flaky };
}

function summarize(run: Pick<TestRun, "rawRecords" | "logicalInvocations" | "unresolvedGroups" | "physicalAttempts">): Summary {
  const logical = run.logicalInvocations;
  return { rawTestcaseRecords: run.rawRecords.length, resolvedLogicalInvocations: logical.length, unresolvedGroups: run.unresolvedGroups.length, unresolvedRawRecords: run.unresolvedGroups.reduce((n, g) => n + g.records.length, 0), passed: logical.filter(x => x.finalStatus === "passed").length, failed: logical.filter(x => x.finalStatus === "failed" || x.finalStatus === "error").length, skipped: logical.filter(x => x.finalStatus === "skipped").length, flaky: logical.filter(x => x.flaky).length, retryCount: logical.reduce((n, x) => n + x.retryCount, 0), recoveredAfterRetry: logical.filter(x => x.recoveredAfterRetry).length, physicalAttempts: run.physicalAttempts };
}
function recalculate(run: TestRun) {
  run.summary = summarize(run);
  run.resultStatus = run.summary.unresolvedGroups ? (run.summary.resolvedLogicalInvocations ? run.summary.failed ? "FAILED" : "PARTIAL" : "UNKNOWN") : run.summary.failed ? "FAILED" : "PASSED";
  run.processingStatus = run.summary.unresolvedGroups ? "NEEDS_REVIEW" : "COMPLETE";
}

function parseJUnit(xml: string, metadata: Record<string, string>): TestRun {
  const validation = XMLValidator.validate(xml); if (validation !== true) throw new Error(`Malformed XML: ${validation.err.msg}`);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", isArray: (_name, jpath) => String(jpath).endsWith("testcase") }).parse(xml);
  const suites = parsed.testsuites?.testsuite ? asArray(parsed.testsuites.testsuite) : parsed.testsuite ? asArray(parsed.testsuite) : [];
  const config = retryConfig(metadata); const skipped = config.ordinarySkippedPolicy; const rawRecords: RawRecord[] = []; const byIdentity = new Map<string, RawRecord[]>(); let order = 0;
  for (const suite of suites) for (const test of asArray(suite.testcase)) {
    const rawName = text(test["@_name"] || "Unnamed test"); const name = cleanTestName(rawName); const suiteName = text(suite["@_name"] || "Unnamed suite"); const className = text(test["@_classname"] || suite["@_classname"] || "");
    const parameters = text(test["@_parameters"] || test["@_param"] || test["@_parameterId"] || test["@_dataProviderRowId"] || "");
    const discriminator = parameters || text(test["@_invocationId"] || test["@_browser"] || test["@_device"] || test["@_region"] || test["@_datasetId"] || "");
    const identity = [suiteName, className, name, discriminator].map(normalize).join("|"); const failure = failureOf(test); const rawStatus = statusOf(test);
    const record: RawRecord = { id: `raw_${++order}`, order, suite: suiteName, className, testName: name, identity, parameters: discriminator || undefined, rawStatus, semanticRole: "NORMAL_RESULT", message: failure?.message, stackTrace: failure?.stack, duration: text(test["@_time"]) || undefined, timestamp: new Date().toISOString(), properties: {}, retryMarker: rawName !== name };
    rawRecords.push(record); const list = byIdentity.get(identity) ?? []; list.push(record); byIdentity.set(identity, list);
  }
  const logicalInvocations: LogicalInvocation[] = []; const unresolvedGroups: UnresolvedGroup[] = []; const warnings: string[] = [];
  for (const [identity, records] of byIdentity) {
    const hasDiscriminator = Boolean(records[0].parameters);
    const isKnownRetry = config.retryAnalyzerEnabled && records.length === 2 && records[0].rawStatus === "SKIPPED" && (records[1].rawStatus === "PASSED" || records[1].rawStatus === "FAILED") && records.length <= config.maxRetries + 1;
    const legacyRetry = !config.retryAnalyzerEnabled && records.length === 2 && records[0].rawStatus !== "SKIPPED" && records[1].rawStatus !== "SKIPPED" && records.some(record => record.retryMarker === true);
    if (isKnownRetry || legacyRetry) { const inv = invocation(records, true, skipped); if (inv) logicalInvocations.push(inv); continue; }
    if (records.length === 1) {
      if (config.retryAnalyzerEnabled && records[0].rawStatus === "SKIPPED") { records[0].semanticRole = "UNRESOLVED"; unresolvedGroups.push({ id: `ug_${crypto.randomUUID()}`, identity, records, reason: "Incomplete skipped-terminal retry sequence; terminal record is missing", candidateInterpretations: ["genuine skipped invocation", "incomplete retry sequence", "interrupted run"] }); warnings.push(`Unresolved incomplete retry sequence for ${records[0].testName}.`); }
      else { const inv = invocation(records, false, skipped); if (inv) logicalInvocations.push(inv); }
      continue;
    }
    if (hasDiscriminator && records.length <= config.maxRetries + 1) { const inv = invocation(records, false, skipped); if (inv) logicalInvocations.push(inv); continue; }
    records.forEach(record => { record.semanticRole = "UNRESOLVED"; }); unresolvedGroups.push({ id: `ug_${crypto.randomUUID()}`, identity, records, reason: records.length > 2 ? "Multiple skipped-terminal pairings are possible for a data-provider test" : "Repeated testcase identity without retry, parameter, or invocation discriminator", candidateInterpretations: records.length > 2 ? ["TREAT_FIRST_RETRY_THEN_SEPARATE", "TREAT_AS_RETRIES", "TREAT_AS_SEPARATE_INVOCATIONS", "IGNORE_RECORDS"] : ["TREAT_AS_RETRIES", "TREAT_AS_SEPARATE_INVOCATIONS", "IGNORE_RECORDS"] });
    warnings.push(`Unresolved repeated identity for ${records[0].testName}; excluded from resolved totals.`);
  }
  const id = metadata.externalRunId ? `run_${crypto.createHash("sha256").update(metadata.externalRunId).digest("hex").slice(0, 16)}` : `run_${crypto.createHash("sha256").update(xml).digest("hex").slice(0, 16)}`;
  const run: TestRun = { id, externalRunId: metadata.externalRunId || undefined, projectId: config.projectId, adapter: "junit-generic", adapterVersion: "0.3.0", configurationVersion: config.version, build: metadata.build || "local", environment: metadata.environment || "default", retryAnalyzerEnabled: config.retryAnalyzerEnabled, maxRetries: config.maxRetries, retryReportingProfile: config.skippedSequencePolicy, skippedLogicalTestPolicy: config.ordinarySkippedPolicy, ambiguousDuplicatePolicy: config.ambiguousDuplicatePolicy, ingestedAt: new Date().toISOString(), rawReport: xml, warnings, rawRecords, logicalInvocations, unresolvedGroups, summary: {} as Summary, resultStatus: "UNKNOWN", processingStatus: "COMPLETE", physicalAttempts: rawRecords.length, resolutionAudit: [] };
  recalculate(run); if (!run.rawRecords.length) run.warnings.push("No testcase records were found in the report."); return run;
}

function failureOccurrences(run: TestRun) { return run.logicalInvocations.filter(t => t.finalStatus === "failed" || t.finalStatus === "error").map(test => ({ test, attempt: test.attempts[test.attempts.length - 1] })); }
function addFailureGroup(run: TestRun, test: LogicalInvocation, attempt: Attempt) { const message = attempt.message || "Automated test failure"; const stack = attempt.stackTrace || message; const sig = signature(message, stack); const now = attempt.timestamp; const existingGroup = groups.get(sig); if (!existingGroup) groups.set(sig, { id: `fg_${sig}`, signature: sig, summary: message.slice(0, 120), message, stackTrace: stack, tests: [test.name], suites: [test.suite], environments: [run.environment], builds: [run.build], occurrences: 1, firstSeen: now, lastSeen: now, classification: "unknown", notes: "", recoveredAttempts: 0 }); else { existingGroup.occurrences++; existingGroup.lastSeen = now; existingGroup.tests = [...new Set([...existingGroup.tests, test.name])]; existingGroup.suites = [...new Set([...existingGroup.suites, test.suite])]; existingGroup.environments = [...new Set([...existingGroup.environments, run.environment])]; existingGroup.builds = [...new Set([...existingGroup.builds, run.build])]; } }
function ingest(run: TestRun) { const existing = runs.get(run.id); if (existing) { existing.duplicate = true; return existing; } runs.set(run.id, run); for (const { test, attempt } of failureOccurrences(run)) addFailureGroup(run, test, attempt); return run; }
function preview(run: TestRun) { return { runId: run.id, projectId: run.projectId, adapter: run.adapter, appliedIdentityRule: "suite + class + normalized test name + parameter/invocation discriminator", retryAnalyzerEnabled: run.retryAnalyzerEnabled, maxRetries: run.maxRetries, retryReportingProfile: run.retryReportingProfile, skippedLogicalTestPolicy: run.skippedLogicalTestPolicy, ambiguousDuplicatePolicy: run.ambiguousDuplicatePolicy, rawTestcases: run.summary.rawTestcaseRecords, estimatedLogicalTests: run.summary.resolvedLogicalInvocations, unresolvedGroups: run.summary.unresolvedGroups, unresolvedRawRecords: run.summary.unresolvedRawRecords, possibleRetries: run.logicalInvocations.filter(t => t.retryCount > 0).map(t => ({ test: t.name, attempts: t.attemptCount, finalStatus: t.finalStatus, recovered: t.recoveredAfterRetry })), warnings: run.warnings, summary: run.summary, resultStatus: run.resultStatus, processingStatus: run.processingStatus }; }
function publicRun(run: TestRun) { const { rawReport: _raw, ...safe } = run; return safe; }

app.get("/api/failure-groups", (_req, res) => res.json([...groups.values()].sort((a, b) => b.occurrences - a.occurrences)));
app.get("/api/failure-groups/:id", (req, res) => { const group = groups.get(req.params.id); group ? res.json(group) : res.status(404).json({ error: "Failure group not found" }); });
app.get("/api/retry-config", (req, res) => { const projectId = text(req.query.projectId || "default"); const config = retryConfigs.get(projectId) ?? retryConfig({ projectId }); res.json(config); });
app.put("/api/retry-config", (req, res) => { const projectId = text(req.body.projectId || "default"); const enabled = bool(req.body.retryAnalyzerEnabled); const config: RetryConfig = { projectId, retryAnalyzerEnabled: enabled, maxRetries: Math.max(0, Math.min(10, Number(req.body.maxRetries ?? (enabled ? 1 : 0)) || 0)), skippedSequencePolicy: enabled ? profile(req.body.skippedSequencePolicy || "SKIPPED_THEN_TERMINAL_IS_RETRY") : "NORMAL_SKIPPED_SEMANTICS", ordinarySkippedPolicy: skippedPolicy(req.body.ordinarySkippedPolicy), ambiguousDuplicatePolicy: "REQUIRE_REVIEW", version: `retry-config-${Date.now()}` }; retryConfigs.set(projectId, config); res.json(config); });
app.get("/api/test-runs", (_req, res) => res.json([...runs.values()].map(publicRun)));
app.get("/api/test-runs/:id", (req, res) => { const run = runs.get(req.params.id); run ? res.json(publicRun(run)) : res.status(404).json({ error: "Test run not found" }); });
app.post("/api/test-runs/preview", upload.single("file"), (req, res) => { if (!req.file) return res.status(400).json({ error: "Attach a JUnit XML file using the 'file' field." }); try { res.json(preview(parseJUnit(req.file.buffer.toString("utf8"), req.body))); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Invalid JUnit XML" }); } });
app.post("/api/test-runs", upload.single("file"), (req, res) => { if (!req.file) return res.status(400).json({ error: "Attach a JUnit XML file using the 'file' field." }); try { const run = ingest(parseJUnit(req.file.buffer.toString("utf8"), req.body)); res.status(201).json({ run: publicRun(run), preview: preview(run) }); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Invalid JUnit XML" }); } });
app.post("/api/test-runs/:runId/unresolved-groups/:groupId/resolve", (req, res) => { const run = runs.get(req.params.runId); const group = run?.unresolvedGroups.find(g => g.id === req.params.groupId); const type = req.body.type as ResolutionType; if (!run || !group) return res.status(404).json({ error: "Unresolved group not found" }); if (!["TREAT_AS_RETRIES", "TREAT_AS_SEPARATE_INVOCATIONS", "TREAT_FIRST_RETRY_THEN_SEPARATE", "IGNORE_RECORDS"].includes(type)) return res.status(400).json({ error: "type must be TREAT_AS_RETRIES, TREAT_AS_SEPARATE_INVOCATIONS, TREAT_FIRST_RETRY_THEN_SEPARATE, or IGNORE_RECORDS" });
  group.records.forEach(r => { r.semanticRole = type === "IGNORE_RECORDS" ? "IGNORED" : "NORMAL_RESULT"; }); if (type === "TREAT_AS_RETRIES") { const inv = invocation(group.records, true, run.skippedLogicalTestPolicy); if (inv) run.logicalInvocations.push(inv); } else if (type === "TREAT_FIRST_RETRY_THEN_SEPARATE") { const first = invocation(group.records.slice(0, 2), true, run.skippedLogicalTestPolicy); if (first) run.logicalInvocations.push(first); for (const record of group.records.slice(2)) { const inv = invocation([record], false, run.skippedLogicalTestPolicy); if (inv) run.logicalInvocations.push(inv); } } else if (type === "TREAT_AS_SEPARATE_INVOCATIONS") { for (const record of group.records) { const inv = invocation([record], false, run.skippedLogicalTestPolicy); if (inv) run.logicalInvocations.push(inv); } }
  run.unresolvedGroups = run.unresolvedGroups.filter(g => g.id !== group.id); const audit = { groupId: group.id, type, scope: "THIS_GROUP" as const, resolvedAt: new Date().toISOString(), resolver: req.body.resolver ? text(req.body.resolver) : undefined }; group.resolution = audit; run.resolutionAudit.push(audit); const groupRecordIds = new Set(group.records.map(record => record.id)); for (const resolved of run.logicalInvocations.filter(inv => inv.attempts.some(attempt => groupRecordIds.has(attempt.id)))) { if (resolved.finalStatus === "failed" || resolved.finalStatus === "error") addFailureGroup(run, resolved, resolved.attempts[resolved.attempts.length - 1]); } recalculate(run); res.json({ run: publicRun(run), preview: preview(run) }); });
app.patch("/api/failure-groups/:id", (req, res) => { const group = groups.get(req.params.id); if (!group) return res.status(404).json({ error: "Failure group not found" }); if (req.body.classification) group.classification = req.body.classification; if (typeof req.body.notes === "string") group.notes = req.body.notes; if (req.body.jiraIssue) group.jiraIssue = req.body.jiraIssue; res.json(group); });
app.post("/api/demo/seed", (req, res) => { const body = req.body || {}; const scenario = text(body.scenario || "skipped-pass"); const examples: Record<string, string> = {
  "skipped-pass": `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`,
  "skipped-failed": `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"><failure message="checkout failed">checkout failed at checkout.ts:1</failure></testcase></testsuite></testsuites>`,
  "ambiguous-three-records": `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"><failure message="first invocation failed">first invocation failed</failure></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`,
  "parameterized": `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"/><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><failure message="premium row failed">premium row failed</failure></testcase></testsuite></testsuites>`
}; const xml = examples[scenario] || examples["skipped-pass"]; const metadata = { ...body, build: `demo-${scenario}`, environment: "demo", externalRunId: `demo-${scenario}-${Date.now()}` }; const run = ingest(parseJUnit(xml, metadata)); res.json({ ok: true, scenario, run: publicRun(run), preview: preview(run) }); });

app.listen(Number(process.env.PORT) || 3000, () => console.log("Automation Failure Intelligence running on http://localhost:3000"));

