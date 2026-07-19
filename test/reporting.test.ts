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

async function waitForServer() { for (let attempt = 0; attempt < 30; attempt++) { try { await fetch(`${baseUrl}/api/failure-groups`); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } } throw new Error("Test server did not start"); }
async function upload(name: string, endpoint = "/api/test-runs") { const form = new FormData(); form.append("file", new Blob([await readFile(fixture(name))], { type: "application/xml" }), name); form.append("build", `test-${name}`); form.append("environment", "test"); return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form }); }
async function uploadXml(xml: string, fields: Record<string, string>, endpoint = "/api/test-runs") { const form = new FormData(); form.append("file", new Blob([xml], { type: "application/xml" }), "inline.xml"); for (const [key, value] of Object.entries(fields)) form.append(key, value); return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form }); }
const pairXml = (second: "passed" | "failed") => `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder">${second === "passed" ? "" : "<failure message=\"checkout failed\">checkout failed</failure>"}</testcase></testsuite></testsuites>`;

before(async () => { server = spawn(process.execPath, [path.join(process.cwd(), "dist", "src", "server.js")], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "pipe" }); await waitForServer(); });
after(async () => { server.kill(); await once(server, "exit").catch(() => undefined); });

test("default mode counts raw records independently", async () => {
  const result = await (await upload("retry-recovered.xml", "/api/test-runs/preview")).json() as any;
  assert.equal(result.summary.rawTestcaseRecords, 2);
  assert.equal(result.summary.logicalTests, 2);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.retryCount, 0);
});

test("retry analyzer collapses only skipped-terminal pairs", async () => {
  const result = await (await uploadXml(pairXml("passed"), { retryAnalyzerEnabled: "true", maxRetries: "1", externalRunId: "simple-pass" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 1);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.skipped, 0);
  assert.equal(result.preview.summary.flaky, 1);
  assert.equal(result.run.logicalTests[0].attempts[0].rawStatus, "SKIPPED");
});

test("retry analyzer turns skipped-failed into one failed result", async () => {
  const result = await (await uploadXml(pairXml("failed"), { retryAnalyzerEnabled: "true", maxRetries: "1", externalRunId: "simple-fail" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 1);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.skipped, 0);
  assert.equal(result.preview.summary.retryCount, 1);
});

test("three records become failed retry followed by separate pass", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"><failure message="first invocation failed">first invocation failed</failure></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { retryAnalyzerEnabled: "true", maxRetries: "1", externalRunId: "simple-three" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.retryCount, 1);
  assert.equal(result.run.processingStatus, "WARNING");
});

test("retry disabled treats skipped as an ordinary skipped result", async () => {
  const result = await (await uploadXml(pairXml("passed"), { retryAnalyzerEnabled: "false", externalRunId: "simple-disabled" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.retryCount, 0);
});

test("parameter identifiers stay separate while retry pairs collapse within each row", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"/><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><failure message="row 2 failed">row 2 failed</failure></testcase></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { retryAnalyzerEnabled: "true", maxRetries: "1", externalRunId: "simple-params" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.retryCount, 2);
});

test("project configuration controls later uploads", async () => {
  const projectId = "simple-project";
  await fetch(`${baseUrl}/api/retry-config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, retryAnalyzerEnabled: true }) });
  const result = await (await uploadXml(pairXml("passed"), { projectId, externalRunId: "saved-config" })).json() as any;
  assert.equal(result.preview.retryAnalyzerEnabled, true);
  assert.equal(result.preview.summary.logicalTests, 1);
});

test("duplicate uploads remain idempotent", async () => {
  const first = await upload("parameterized.xml");
  assert.equal(first.status, 201);
  const second = await upload("parameterized.xml");
  const result = await second.json() as any;
  assert.equal(second.status, 201);
  assert.equal(result.run.duplicate, true);
});

test("demo scenarios load successfully", async () => {
  const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "ambiguous-three-records", retryAnalyzerEnabled: true, maxRetries: 1 }) });
  const result = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(result.preview.summary.logicalTests, 6);
  assert.equal(result.preview.summary.failed, 1);
});

test("each demo scenario contains at least five raw test examples", async () => {
  for (const scenario of ["skipped-pass", "skipped-failed", "ambiguous-three-records", "parameterized"]) {
    const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario, retryAnalyzerEnabled: true, maxRetries: 1, externalRunId: `five-${scenario}` }) });
    const result = await response.json() as any;
    assert.equal(response.status, 200);
    assert.ok(result.preview.summary.rawTestcaseRecords >= 5, `${scenario} should have at least five raw records`);
  }
});

test("malformed XML is rejected", async () => { assert.equal((await upload("malformed.xml")).status, 400); });