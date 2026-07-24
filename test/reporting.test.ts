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

test("health endpoint reports active storage mode", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const result = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.storage, "memory");
  assert.equal(result.storageVariable, null);
});

test("raw results are counted exactly as reported", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="Checkout"><testcase classname="LoginTest" name="validLogin"/><testcase classname="CheckoutTest" name="submitOrder"><failure message="checkout failed">checkout failed</failure></testcase><testcase classname="ProfileTest" name="loadProfile"><skipped/></testcase><testcase classname="CheckoutTest" name="submitOrder"/></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { retryAnalyzerEnabled: "true" })).json() as any;
  assert.equal(result.preview.summary.rawTestcaseRecords, 4);
  assert.equal(result.preview.summary.logicalTests, 4);
  assert.equal(result.preview.summary.passed, 2);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.errors, 0);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.retryCount, 0);
  assert.equal(result.run.logicalTests[1].attempts.length, 1);
  assert.match(result.run.warnings[0], /Repeated test identities/);
});

test("demo pack provides distinct reusable real-world runs", async () => {
  const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  const result = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(result.scenario, "demo-pack");
  assert.equal(result.runs.length, 4);
  assert.equal(result.preview.summary.logicalTests, 8);
  assert.equal(result.preview.summary.passed, 5);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.errors, 1);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.retryCount, 0);
  assert.equal(new Set(result.run.logicalTests.map((test: any) => test.name)).size, 8);
  const groups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${result.run.id}`)).json() as any[];
  assert.equal(groups.length, 0);
  const sharedRun = result.runs.find((run: any) => run.build === "demo-shared-failure");
  const sharedGroups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${sharedRun.id}`)).json() as any[];
  assert.equal(sharedGroups.length, 1);
  assert.equal(sharedGroups[0].selectedRunOccurrences, 2);
  const searchedGroups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${result.run.id}&q=checkout`)).json() as any[];
  assert.equal(searchedGroups.length, 0);
});

test("failure groups appear only for multiple matching failures in one run", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="SharedFailureSuite"><testcase classname="CheckoutTest" name="submitOrder"><failure message="shared failure">same stack</failure></testcase><testcase classname="PaymentTest" name="chargeCard"><failure message="shared failure">same stack</failure></testcase></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { externalRunId: "shared-failure-run" })).json() as any;
  const groups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${result.run.id}`)).json() as any[];
  assert.equal(groups.length, 1);
  assert.equal(groups[0].selectedRunOccurrences, 2);
  assert.deepEqual(groups[0].selectedRunTests.sort(), ["chargeCard", "submitOrder"]);
});

test("run list supports status and text filters", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="FilterSuite"><testcase classname="FilterTest" name="uniqueError"><error message="filter error">filter error</error></testcase></testsuite></testsuites>`;
  await uploadXml(xml, { build: "filter-build-unique", externalRunId: "filter-run-unique" });
  const errorRuns = await (await fetch(`${baseUrl}/api/test-runs?status=ERROR`)).json() as any[];
  assert.ok(errorRuns.some(run => run.build === "filter-build-unique"));
  const searchedRuns = await (await fetch(`${baseUrl}/api/test-runs?q=uniqueError`)).json() as any[];
  assert.equal(searchedRuns.length, 1);
  assert.equal(searchedRuns[0].build, "filter-build-unique");
  assert.equal((await fetch(`${baseUrl}/api/test-runs?status=NOT_A_STATUS`)).status, 400);
});

test("failure groups retain exact run and test evidence", async () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="EvidenceSuite"><testcase classname="EvidenceTest" name="uniqueFailure"><failure message="unique evidence failure">unique evidence failure</failure></testcase></testsuite></testsuites>`;
  const result = await (await uploadXml(xml, { build: "evidence-build", externalRunId: "evidence-run" })).json() as any;
  const groups = await (await fetch(`${baseUrl}/api/failure-groups`)).json() as any[];
  const group = groups.find(item => item.summary === "unique evidence failure");
  assert.ok(group);
  assert.ok(group.runs.includes(result.run.id));
  assert.ok(group.testIds.includes(result.run.logicalTests[0].id));
  assert.deepEqual(group.outcomes, ["FAILED"]);
  const second = await (await uploadXml(xml, { build: "evidence-build-2", externalRunId: "evidence-run-2" })).json() as any;
  const selectedGroups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${second.run.id}`)).json() as any[];
  assert.equal(selectedGroups.length, 0);
  const allGroups = await (await fetch(`${baseUrl}/api/failure-groups`)).json() as any[];
  const historicalGroup = allGroups.find(item => item.summary === "unique evidence failure");
  assert.equal(historicalGroup.occurrences, 2);
});

test("failure group annotations validate, save, and clear Jira links", async () => {
  const groups = await (await fetch(`${baseUrl}/api/failure-groups?q=unique evidence failure`)).json() as any[];
  const group = groups[0];
  assert.ok(group);
  const saved = await fetch(`${baseUrl}/api/failure-groups/${group.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ classification: "product-defect", notes: "Needs investigation", jiraIssue: { key: "QA-123" } }) });
  const savedGroup = await saved.json() as any;
  assert.equal(saved.status, 200);
  assert.equal(savedGroup.classification, "product-defect");
  assert.equal(savedGroup.notes, "Needs investigation");
  assert.equal(savedGroup.jiraIssue.key, "QA-123");
  const cleared = await fetch(`${baseUrl}/api/failure-groups/${group.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ jiraIssue: null }) });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json() as any).jiraIssue, undefined);
  assert.equal((await fetch(`${baseUrl}/api/failure-groups/${group.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ classification: "not-valid" }) })).status, 400);
});

test("duplicate uploads remain idempotent", async () => {
  const xml = await readFile(fixture("basic-outcomes.xml"), "utf8");
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

test("storage supports the Vercel Postgres variable names", async () => {
  const storageSource = await readFile(path.join(process.cwd(), "src", "storage.ts"), "utf8");
  assert.match(storageSource, /POSTGRES_URL/);
  assert.match(storageSource, /POSTGRES_PRISMA_URL/);
  assert.match(storageSource, /POSTGRES_URL_NON_POOLING/);
  assert.match(storageSource, /rejectUnauthorized: false/);
});

test("Phase 4 storage schema preserves normalized source-record seams", async () => {
  const storageSource = await readFile(path.join(process.cwd(), "src", "storage.ts"), "utf8");
  assert.match(storageSource, /afi_test_results/);
  assert.match(storageSource, /source_order/);
  assert.match(storageSource, /raw_report/);
  assert.match(storageSource, /BEGIN/);
  assert.match(storageSource, /COMMIT/);
  assert.match(storageSource, /ROLLBACK/);
  assert.match(storageSource, /\\$\\{run\\.id\\}:\\$\\{record\\.id\\}/);
});

test("mock report pack covers the main raw JUnit shapes", async () => {
  const cases = [
    ["basic-outcomes.xml", 5, 2, 1, 1, 1],
    ["parameterized.xml", 2, 0, 2, 0, 0],
    ["parameterized-rows.xml", 3, 1, 1, 1, 0]
  ] as const;
  for (const [name, total, passed, failed, skipped, errors] of cases) {
    const result = await (await uploadXml(await readFile(fixture(name), "utf8"))).json() as any;
    assert.equal(result.preview.summary.logicalTests, total, name);
    assert.equal(result.preview.summary.passed, passed, name);
    assert.equal(result.preview.summary.failed, failed, name);
    assert.equal(result.preview.summary.errors, errors, name);
    assert.equal(result.preview.summary.skipped, skipped, name);
    assert.equal(result.preview.summary.retryCount, 0, name);
  }
});

test("nested suites and report metadata are preserved without retry inference", async () => {
  const result = await (await uploadXml(await readFile(fixture("nested-metadata.xml"), "utf8"))).json() as any;
  assert.equal(result.preview.summary.rawTestcaseRecords, 2);
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.reportMetadata.name, "Nightly browser suite");
  assert.deepEqual(result.preview.reportMetadata.properties, { framework: "example-junit", commit: "abc123" });
  assert.equal(result.run.logicalTests[0].suite, "Checkout");
  assert.equal(result.run.logicalTests[1].suite, "Checkout / Chrome");
  assert.equal(result.run.logicalTests[1].name, "submits order retry 1");
  assert.equal(result.run.logicalTests[1].retryCount, 0);
  assert.equal(result.run.logicalTests[1].flaky, false);
});

test("valid empty reports are accepted with an explicit warning", async () => {
  const result = await (await uploadXml("<?xml version=\"1.0\"?><testsuites name=\"Empty report\" tests=\"0\"/>", { externalRunId: "empty-report" })).json() as any;
  assert.equal(result.preview.summary.rawTestcaseRecords, 0);
  assert.equal(result.preview.summary.logicalTests, 0);
  assert.equal(result.preview.resultStatus, "UNKNOWN");
  assert.match(result.preview.warnings[0], /No testcase records/);
  assert.equal(result.preview.reportMetadata.name, "Empty report");
});

test("known framework metadata selects an explicit adapter without changing statuses", async () => {
  const pytest = await (await uploadXml(await readFile(fixture("pytest-explicit.xml"), "utf8"))).json() as any;
  assert.equal(pytest.preview.adapter, "pytest");
  assert.equal(pytest.preview.summary.passed, 2);
  assert.equal(pytest.preview.summary.retryCount, 0);
  assert.equal(pytest.preview.warnings.length, 0);

  const surefire = await (await uploadXml(await readFile(fixture("surefire-explicit.xml"), "utf8"))).json() as any;
  assert.equal(surefire.preview.adapter, "maven-surefire");
  assert.equal(surefire.preview.summary.failed, 1);
  assert.equal(surefire.preview.reportMetadata.properties.framework, "maven-surefire");
  assert.equal(surefire.preview.summary.retryCount, 0);
});

test("all registered adapters require explicit metadata and preserve generic result semantics", async () => {
  const cases = [
    ["nunit-explicit.xml", "nunit"],
    ["xunit-explicit.xml", "xunit"],
    ["jest-explicit.xml", "jest"],
    ["playwright-explicit.xml", "playwright"],
    ["cypress-explicit.xml", "cypress"]
  ] as const;
  for (const [name, adapter] of cases) {
    const result = await (await uploadXml(await readFile(fixture(name), "utf8"), { externalRunId: adapter })).json() as any;
    assert.equal(result.preview.adapter, adapter, name);
    assert.equal(result.preview.summary.logicalTests, 1, name);
    assert.equal(result.preview.summary.passed, 1, name);
    assert.equal(result.preview.summary.retryCount, 0, name);
    assert.equal(result.preview.warnings.length, 0, name);
  }
});

test("root framework metadata takes precedence over a conflicting property", async () => {
  const xml = "<?xml version=\"1.0\"?><testsuites framework=\"pytest\"><properties><property name=\"framework\" value=\"jest\"/></properties><testsuite name=\"Conflict\"><testcase name=\"one\"/></testsuite></testsuites>";
  const result = await (await uploadXml(xml, { externalRunId: "framework-precedence" })).json() as any;
  assert.equal(result.preview.adapter, "pytest");
  assert.equal(result.preview.reportMetadata.framework, "pytest");
  assert.equal(result.preview.reportMetadata.properties.framework, "jest");
});

test("unknown explicit framework metadata stays generic and explains the fallback", async () => {
  const xml = "<?xml version=\"1.0\"?><testsuites framework=\"custom-runner\"><testsuite name=\"Custom\"><testcase name=\"one\"/></testsuite></testsuites>";
  const result = await (await uploadXml(xml, { externalRunId: "unknown-framework" })).json() as any;
  assert.equal(result.preview.adapter, "junit-generic");
  assert.match(result.preview.warnings[0], /Explicit framework metadata 'custom-runner'/);
  assert.equal(result.preview.summary.passed, 1);
});

test("larger reports retain every record, order, and source outcome", async () => {
  const result = await (await uploadXml(await readFile(fixture("large-report.xml"), "utf8"), { externalRunId: "large-report" })).json() as any;
  assert.equal(result.preview.summary.rawTestcaseRecords, 34);
  assert.equal(result.preview.summary.logicalTests, 34);
  assert.equal(result.preview.summary.passed, 30);
  assert.equal(result.preview.summary.failed, 2);
  assert.equal(result.preview.summary.errors, 1);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.run.rawRecords.length, 34);
  assert.equal(result.run.rawRecords[0].order, 1);
  assert.equal(result.run.rawRecords[33].order, 34);
  assert.equal(result.run.rawRecords[30].rawStatus, "FAILED");
  assert.equal(result.run.rawRecords[31].rawStatus, "ERROR");
  assert.match(result.preview.warnings[0], /Repeated test identities/);
  assert.equal(result.preview.summary.retryCount, 0);
});

test("dashboard source renders adapter and report metadata fields", async () => {
  const dashboard = await readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
  assert.match(dashboard, /reportMetadata/);
  assert.match(dashboard, /metadata-label/);
  assert.match(dashboard, /Adapter/);
  assert.match(dashboard, /Properties/);
  assert.match(dashboard, /run\.warnings/);
});
