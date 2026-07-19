import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { test, before, after } from "node:test";
import path from "node:path";

const port = 43127;
const baseUrl = `http://127.0.0.1:${port}`;
let server: ChildProcess;
const fixture = (name: string) => path.join(process.cwd(), "test", "fixtures", name);

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await fetch(`${baseUrl}/api/failure-groups`); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error("Test server did not start");
}

async function upload(name: string, endpoint = "/api/test-runs") {
  const form = new FormData();
  form.append("file", new Blob([await readFile(fixture(name))], { type: "application/xml" }), name);
  form.append("build", `test-${name}`);
  form.append("environment", "test");
  return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
}

async function uploadXml(xml: string, fields: Record<string, string>, endpoint = "/api/test-runs") {
  const form = new FormData();
  form.append("file", new Blob([xml], { type: "application/xml" }), "inline.xml");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
}

const pairXml = (secondStatus: "passed" | "failed") => `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder">${secondStatus === "passed" ? "" : "<failure message=\"checkout failed\">stack at checkout.ts:1</failure>"}</testcase></testsuite></testsuites>`;

before(async () => {
  server = spawn(process.execPath, [path.join(process.cwd(), "dist", "src", "server.js")], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "pipe" });
  await waitForServer();
});

after(async () => { server.kill(); await once(server, "exit").catch(() => undefined); });

test("preview exposes one logical test, two attempts, and a recovered retry", async () => {
  const response = await upload("retry-recovered.xml", "/api/test-runs/preview");
  assert.equal(response.status, 200);
  const result = await response.json() as any;
  assert.equal(result.rawTestcases, 2);
  assert.equal(result.estimatedLogicalTests, 1);
  assert.equal(result.summary.physicalAttempts, 2);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.flaky, 1);
  assert.equal(result.possibleRetries[0].recovered, true);
});

test("parameterized executions remain separate logical tests", async () => {
  const response = await upload("parameterized.xml");
  assert.equal(response.status, 201);
  const result = await response.json() as any;
  assert.equal(result.preview.estimatedLogicalTests, 2);
  assert.equal(result.preview.rawTestcases, 2);
});

test("duplicate uploads are marked and do not create another run", async () => {
  const first = await upload("retry-recovered.xml");
  assert.equal(first.status, 201);
  const second = await upload("retry-recovered.xml");
  assert.equal(second.status, 201);
  const result = await second.json() as any;
  assert.equal(result.run.duplicate, true);
  const runs = await (await fetch(`${baseUrl}/api/test-runs`)).json() as any[];
  assert.equal(runs.filter(run => run.id === result.run.id).length, 1);
});

test("malformed XML is rejected", async () => {
  const response = await upload("malformed.xml");
  assert.equal(response.status, 400);
});

test("demo seed loads valid XML and produces failure groups", async () => {
  const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST" });
  assert.equal(response.status, 200);
  const groups = await (await fetch(`${baseUrl}/api/failure-groups`)).json() as any[];
  assert.ok(groups.length > 0);
});

test("demo scenarios can be loaded with retry configuration presets", async () => {
  const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "skipped-pass", projectId: "demo-presets", retryAnalyzerEnabled: true, maxRetries: 1, retryReportingProfile: "SKIPPED_THEN_TERMINAL_IS_RETRY" }) });
  const result = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(result.scenario, "skipped-pass");
  assert.equal(result.preview.retryAnalyzerEnabled, true);
  assert.equal(result.preview.summary.flaky, 1);

  const ambiguous = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "ambiguous-three-records", projectId: "demo-presets", retryAnalyzerEnabled: true, maxRetries: 1, retryReportingProfile: "SKIPPED_THEN_TERMINAL_IS_RETRY" }) });
  const ambiguousResult = await ambiguous.json() as any;
  assert.equal(ambiguousResult.preview.unresolvedGroups, 1);
  assert.ok(ambiguousResult.run.unresolvedGroups[0].candidateInterpretations.includes("TREAT_FIRST_RETRY_THEN_SEPARATE"));
});

test("configured skipped-pass sequence is one recovered flaky invocation and preserves raw status", async () => {
  const response = await uploadXml(pairXml("passed"), { retryReportingProfile: "SKIPPED_THEN_TERMINAL_IS_RETRY", externalRunId: "known-pass-1" });
  const result = await response.json() as any;
  assert.equal(result.preview.unresolvedGroups, 0);
  assert.deepEqual(result.preview.summary, { rawTestcaseRecords: 2, resolvedLogicalInvocations: 1, unresolvedGroups: 0, unresolvedRawRecords: 0, passed: 1, failed: 0, skipped: 0, flaky: 1, retryCount: 1, recoveredAfterRetry: 1, physicalAttempts: 2 });
  assert.equal(result.run.logicalInvocations[0].attempts[0].rawStatus, "SKIPPED");
  assert.equal(result.run.logicalInvocations[0].attempts[0].semanticRole, "RETRY_TRIGGERED_FAILURE");
  assert.equal(result.run.processingStatus, "COMPLETE");
  assert.equal(result.run.resultStatus, "PASSED");
});

test("configured skipped-failed sequence counts only the terminal failure", async () => {
  const response = await uploadXml(pairXml("failed"), { retryReportingProfile: "SKIPPED_THEN_TERMINAL_IS_RETRY", externalRunId: "known-fail-1" });
  const result = await response.json() as any;
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.skipped, 0);
  assert.equal(result.preview.summary.retryCount, 1);
  assert.equal(result.run.logicalInvocations[0].recoveredAfterRetry, false);
  assert.equal((await (await fetch(`${baseUrl}/api/failure-groups`)).json() as any[]).some(g => g.message === "checkout failed"), true);
});

test("normal skipped semantics does not guess that a skipped-pass pair is a retry", async () => {
  const response = await uploadXml(pairXml("passed"), { retryReportingProfile: "NORMAL_SKIPPED_SEMANTICS", externalRunId: "normal-skipped-1" });
  const result = await response.json() as any;
  assert.equal(result.preview.unresolvedGroups, 1);
  assert.equal(result.preview.estimatedLogicalTests, 0);
  assert.equal(result.run.processingStatus, "NEEDS_REVIEW");
  assert.equal(result.run.resultStatus, "UNKNOWN");
});

test("parameterized skipped-terminal pairs remain separate invocations", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"/><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><failure message="row 2 failed">row 2 failed</failure></testcase></testsuite></testsuites>`;
  const response = await uploadXml(xml, { retryReportingProfile: "SKIPPED_THEN_TERMINAL_IS_RETRY", externalRunId: "parameterized-1" });
  const result = await response.json() as any;
  assert.equal(result.preview.unresolvedGroups, 0);
  assert.equal(result.preview.summary.resolvedLogicalInvocations, 2);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.retryCount, 2);
});

test("unidentifiable multiple data-provider sequences are unresolved and excluded", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"/><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"><failure message="row failed">row failed</failure></testcase></testsuite></testsuites>`;
  const response = await uploadXml(xml, { retryReportingProfile: "SKIPPED_THEN_TERMINAL_IS_RETRY", externalRunId: "ambiguous-1" });
  const result = await response.json() as any;
  assert.equal(result.preview.unresolvedGroups, 1);
  assert.equal(result.preview.unresolvedRawRecords, 4);
  assert.equal(result.preview.estimatedLogicalTests, 0);
  assert.equal(result.preview.summary.failed, 0);
  assert.equal(result.run.processingStatus, "NEEDS_REVIEW");
  assert.equal(result.run.resultStatus, "UNKNOWN");
});

test("an unresolved group can be resolved as separate invocations and recalculated", async () => {
  const response = await uploadXml(pairXml("passed"), { retryReportingProfile: "NORMAL_SKIPPED_SEMANTICS", externalRunId: "resolve-separate-1" });
  const initial = await response.json() as any;
  const group = initial.run.unresolvedGroups[0];
  const resolvedResponse = await fetch(`${baseUrl}/api/test-runs/${initial.run.id}/unresolved-groups/${group.id}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "TREAT_AS_SEPARATE_INVOCATIONS", resolver: "test" }) });
  const resolved = await resolvedResponse.json() as any;
  assert.equal(resolved.preview.unresolvedGroups, 0);
  assert.equal(resolved.preview.summary.resolvedLogicalInvocations, 2);
  assert.equal(resolved.preview.summary.skipped, 1);
  assert.equal(resolved.preview.summary.passed, 1);
  assert.equal(resolved.run.processingStatus, "COMPLETE");
  assert.equal(resolved.run.resolutionAudit[0].type, "TREAT_AS_SEPARATE_INVOCATIONS");
});

test("stored project configuration controls skipped interpretation", async () => {
  const projectId = "config-project-1";
  const disabled = await fetch(`${baseUrl}/api/retry-config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, retryAnalyzerEnabled: false, maxRetries: 0 }) });
  assert.equal((await disabled.json() as any).retryAnalyzerEnabled, false);
  const withoutRetry = await uploadXml(pairXml("passed"), { projectId, externalRunId: "config-disabled-run" });
  const withoutRetryResult = await withoutRetry.json() as any;
  assert.equal(withoutRetryResult.preview.retryAnalyzerEnabled, false);
  assert.equal(withoutRetryResult.preview.unresolvedGroups, 1);

  const enabled = await fetch(`${baseUrl}/api/retry-config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, retryAnalyzerEnabled: true, maxRetries: 1 }) });
  assert.equal((await enabled.json() as any).retryAnalyzerEnabled, true);
  const withRetry = await uploadXml(pairXml("passed"), { projectId, externalRunId: "config-enabled-run" });
  const withRetryResult = await withRetry.json() as any;
  assert.equal(withRetryResult.preview.retryAnalyzerEnabled, true);
  assert.equal(withRetryResult.preview.maxRetries, 1);
  assert.equal(withRetryResult.preview.unresolvedGroups, 0);
  assert.equal(withRetryResult.preview.summary.flaky, 1);
});

test("a sequence longer than the configured retry budget remains unresolved", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"><failure message="first attempt failed">first attempt failed</failure></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`;
  const response = await uploadXml(xml, { retryAnalyzerEnabled: "true", maxRetries: "1", externalRunId: "retry-budget-1" });
  const result = await response.json() as any;
  assert.equal(result.preview.maxRetries, 1);
  assert.equal(result.preview.unresolvedGroups, 1);
  assert.equal(result.preview.estimatedLogicalTests, 0);
});

test("ambiguous retry plus new invocation can be resolved as failed then passed", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"><failure message="first invocation failed">first invocation failed</failure></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`;
  const response = await uploadXml(xml, { retryAnalyzerEnabled: "true", maxRetries: "1", externalRunId: "retry-then-new-invocation-1" });
  const initial = await response.json() as any;
  const group = initial.run.unresolvedGroups[0];
  const resolvedResponse = await fetch(`${baseUrl}/api/test-runs/${initial.run.id}/unresolved-groups/${group.id}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "TREAT_FIRST_RETRY_THEN_SEPARATE", resolver: "test" }) });
  const resolved = await resolvedResponse.json() as any;
  assert.equal(resolved.preview.summary.resolvedLogicalInvocations, 2);
  assert.equal(resolved.preview.summary.failed, 1);
  assert.equal(resolved.preview.summary.passed, 1);
  assert.equal(resolved.preview.summary.retryCount, 1);
  assert.equal(resolved.run.processingStatus, "COMPLETE");
});

