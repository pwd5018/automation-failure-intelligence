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
async function uploadXml(xml: string, fields: Record<string, string> = {}, endpoint = "/api/test-runs") { const form = new FormData(); form.append("file", new Blob([xml], { type: "application/xml" }), "inline.xml"); for (const [key, value] of Object.entries(fields)) form.append(key, value); return fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form }); }

before(async () => { server = spawn(process.execPath, [path.join(process.cwd(), "dist", "src", "server.js")], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: "pipe" }); await waitForServer(); });
after(async () => { server.kill(); await once(server, "exit").catch(() => undefined); });

test("raw results are counted exactly as reported", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="LoginTest" name="validLogin"/><testcase classname="CheckoutTest" name="submitOrder"><failure message="checkout failed">checkout failed</failure></testcase><testcase classname="ProfileTest" name="loadProfile"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { retryAnalyzerEnabled: "true" })).json() as any;
  assert.equal(result.preview.summary.rawTestcaseRecords, 4);
  assert.equal(result.preview.summary.logicalTests, 4);
  assert.equal(result.preview.summary.passed, 2);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.retryCount, 0);
  assert.equal(result.run.logicalTests[1].attempts.length, 1);
  assert.match(result.run.warnings[0], /Repeated test identities/);
});

test("repeated names remain separate without retry inference", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { retryAnalyzerEnabled: "true" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.flaky, 0);
  assert.deepEqual(result.run.logicalTests.map((test: any) => test.attempts.map((attempt: any) => attempt.rawStatus)), [["SKIPPED"], ["PASSED"]]);
});

test("parameter identifiers remain visible and separate", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=1"/><testcase classname="CheckoutTest" name="submitOrder" parameters="dataRow=2"><skipped/></testcase></testsuite></testsuites>`;
  const result = await (await uploadXml(xml)).json() as any;
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.deepEqual(result.run.logicalTests.map((test: any) => test.parameters), ["dataRow=1", "dataRow=2"]);
});

test("mixed demo report contains passed failed error skipped and parameterized results", async () => {
  const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  const result = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(result.scenario, "mixed-report");
  assert.equal(result.preview.summary.logicalTests, 8);
  assert.equal(result.preview.summary.passed, 4);
  assert.equal(result.preview.summary.failed, 2);
  assert.equal(result.preview.summary.skipped, 2);
  assert.equal(result.preview.summary.retryCount, 0);
  assert.deepEqual(result.run.logicalTests.slice(-2).map((test: any) => test.parameters), ["dataRow=1", "dataRow=2"]);
});

test("duplicate uploads remain idempotent", async () => {
  const xml = await readFile(fixture("parameterized.xml"), "utf8");
  const first = await uploadXml(xml, { build: "duplicate-test" });
  assert.equal(first.status, 201);
  const second = await uploadXml(xml, { build: "duplicate-test" });
  const result = await second.json() as any;
  assert.equal(second.status, 201);
  assert.equal(result.run.duplicate, true);
});

test("malformed XML is rejected", async () => {
  const response = await uploadXml(await readFile(fixture("malformed.xml"), "utf8"));
  assert.equal(response.status, 400);
});

