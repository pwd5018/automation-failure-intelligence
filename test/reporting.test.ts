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

test("demo pack provides basic, collapsible, and review TestNG JUnit runs", async () => {
  const response = await fetch(`${baseUrl}/api/demo/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  const result = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(result.scenario, "demo-pack");
  assert.equal(result.runs.length, 3);
  const basic = result.runs.find((run: any) => run.build === "demo-testng-basic");
  assert.equal(basic.summary.rawTestcaseRecords, 7);
  assert.equal(basic.summary.logicalTests, 5);
  assert.equal(basic.summary.passed, 2);
  assert.equal(basic.summary.failed, 2);
  assert.equal(basic.summary.errors, 0);
  assert.equal(basic.summary.skipped, 1);
  assert.equal(basic.summary.flaky, 1);
  assert.equal(basic.summary.retryCount, 2);
  assert.equal(basic.provenance.sourceType, "demo");
  assert.equal(basic.provenance.sourceName, "demo-testng-basic");
  assert.equal(basic.adapter, "testng");
  assert.equal(new Set(basic.logicalTests.map((test: any) => test.name)).size, 5);
  const recovered = basic.logicalTests.find((test: any) => test.name === "retrySkipThenPass");
  assert.equal(recovered.attempts.length, 2);
  assert.equal(recovered.attempts[0].rawStatus, "SKIPPED");
  assert.equal(recovered.finalStatus, "passed");
  assert.equal(recovered.flaky, true);
  const exhausted = basic.logicalTests.find((test: any) => test.name === "retrySkipExhausted");
  assert.equal(exhausted.finalStatus, "failed");
  assert.equal(exhausted.attempts[1].rawStatus, "SKIPPED");
  const groups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${basic.id}`)).json() as any[];
  assert.equal(groups.length, 0);
  const searchedGroups = await (await fetch(`${baseUrl}/api/failure-groups?runId=${basic.id}&q=checkout`)).json() as any[];
  assert.equal(searchedGroups.length, 0);
  const collapse = result.runs.find((run: any) => run.build === "demo-testng-dataprovider-collapse");
  assert.equal(collapse.summary.logicalTests, 3);
  assert.equal(collapse.summary.passed, 2);
  assert.equal(collapse.summary.skipped, 1);
  assert.equal(collapse.summary.retryCount, 1);
  assert.equal(collapse.summary.needsReview, 0);
  const review = result.runs.find((run: any) => run.build === "demo-testng-dataprovider-review");
  assert.equal(review.summary.logicalTests, 2);
  assert.equal(review.summary.needsReview, 1);
  assert.equal(review.logicalTests.find((test: any) => test.needsReview).observed.passed, 1);
  assert.equal(review.logicalTests.find((test: any) => test.needsReview).observed.skipped, 1);
});

test("TestNG distinguishes true skips from retry skips and counts logical tests", async () => {
  const result = await (await uploadXml(await readFile(fixture("testng-retry-skips.xml"), "utf8"), { sourceType: "testng-junit" })).json() as any;
  assert.equal(result.preview.provenance.sourceType, "testng-junit");
  assert.equal(result.preview.adapter, "testng");
  assert.equal(result.preview.summary.rawTestcaseRecords, 5);
  assert.equal(result.preview.summary.physicalAttempts, 5);
  assert.equal(result.preview.summary.logicalTests, 3);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.failed, 1);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.retryCount, 2);
  assert.equal(result.preview.summary.flaky, 1);
  const recovered = result.run.logicalTests.find((test: any) => test.name === "testUserLogin");
  assert.equal(recovered.attempts.length, 2);
  assert.equal(recovered.attempts[0].rawStatus, "SKIPPED");
  assert.equal(recovered.finalStatus, "passed");
  assert.equal(recovered.recoveredAfterRetry, true);
  const trueSkip = result.run.logicalTests.find((test: any) => test.name === "testLockedAccount");
  assert.equal(trueSkip.attempts.length, 1);
  assert.equal(trueSkip.finalStatus, "skipped");
  const exhausted = result.run.logicalTests.find((test: any) => test.name === "testExhaustedRetry");
  assert.equal(exhausted.attempts.length, 2);
  assert.equal(exhausted.finalStatus, "failed");
  assert.equal(exhausted.flaky, false);
});

test("TestNG parameters keep retry groups separate", async () => {
  const result = await (await uploadXml(await readFile(fixture("testng-parameter-retry.xml"), "utf8"), { sourceType: "testng-junit" })).json() as any;
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.passed, 1);
  assert.equal(result.preview.summary.skipped, 1);
  assert.equal(result.preview.summary.retryCount, 1);
  const blue = result.run.logicalTests.find((test: any) => test.parameters === "blue");
  const green = result.run.logicalTests.find((test: any) => test.parameters === "green");
  assert.equal(blue.attempts.length, 2);
  assert.equal(blue.finalStatus, "passed");
  assert.equal(green.attempts.length, 1);
  assert.equal(green.finalStatus, "skipped");
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
  assert.match(storageSource, /\$\{run\.id\}:\$\{record\.id\}/);
  assert.match(storageSource, /hydrateRunFromNormalizedRows/);
  assert.match(storageSource, /afi_result_dispositions/);
  assert.match(storageSource, /saveDisposition/);
  assert.match(storageSource, /SELECT id, run_id, source_order/);
  assert.match(storageSource, /jsonValue\(run\)/);
  assert.match(storageSource, /jsonValue\(record\)/);
  assert.match(storageSource, /groupPayload\(group\)/);
  assert.match(storageSource, /afi_failure_group_occurrences/);
  assert.match(storageSource, /afi_retry_configs/);
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
  const frontend = await readFile(path.join(process.cwd(), "frontend", "src", "main.tsx"), "utf8");
  assert.match(dashboard, /reportMetadata/);
  assert.match(dashboard, /metadata-label/);
  assert.match(dashboard, /Adapter/);
  assert.match(dashboard, /Properties/);
  assert.match(dashboard, /run\.warnings/);
  assert.match(dashboard, /Result definitions/);
  assert.match(dashboard, /needsReviewMetric/);
  assert.match(dashboard, /needs-review/);
  assert.match(dashboard, /Observed records/);
  assert.match(dashboard, /NEEDS REVIEW/);
  assert.match(dashboard, /openTestDetail/);
  assert.match(dashboard, /detailGroupKey/);
  assert.match(dashboard, /Failure disposition/);
  assert.match(dashboard, /Previous matching dispositions/);
  assert.match(dashboard, /saveResultDisposition/);
  assert.match(dashboard, /Iterations and attempts/);
  assert.match(dashboard, /Back to results/);
  assert.match(dashboard, /retry attempts are retained inside the result history/);
  assert.match(dashboard, /Attempt history/);
  assert.match(dashboard, /id="testTab"/);
  assert.match(dashboard, /id="groupTab"/);
  assert.match(dashboard, /id="reactInspectorRoot"/);
  assert.match(dashboard, /aria-label="JUnit XML report file"/);
  assert.match(dashboard, /afi:result-detail/);
  assert.match(frontend, /Execution trace/);
  assert.match(frontend, /Save disposition/);
  assert.match(frontend, /role="combobox"/);
  assert.match(frontend, /ArrowDown/);
  assert.match(frontend, /react-run-command/);
  assert.match(dashboard, /aria-controls="testPanel"/);
  assert.match(dashboard, /aria-controls="groupPanel"/);
  assert.match(dashboard, /function setCenterTab/);
  assert.match(dashboard, /id="ingestionToggle"/);
  assert.match(dashboard, /aria-controls="ingestionDrawer"/);
  assert.match(dashboard, /function setIngestionOpen/);
  assert.match(dashboard, /copyInspectorText/);
  assert.match(dashboard, /aria-live="polite"/);
  assert.match(dashboard, /role="button" tabindex="0" aria-label="Open failure group/);
  assert.match(dashboard, /class="project-rail"/);
  assert.match(dashboard, /aria-label="Project navigation"/);
  assert.match(dashboard, /id="runWorkspace"/);
  assert.match(dashboard, /id="reactHeaderRoot"/);
  assert.match(dashboard, /id="reactSummaryRoot"/);
  assert.match(dashboard, /id="reactRunWorkspaceRoot"/);
  assert.match(dashboard, /class="legacy-run-seam"/);
  assert.match(dashboard, /id="reactTriageRoot"/);
  assert.match(dashboard, /class="legacy-test-seam"/);
  assert.match(dashboard, /type="module" src="\/app\/assets\/index\.js"/);
  assert.match(dashboard, /href="\/app\/assets\/index\.css"/);
  assert.match(dashboard, /developer\.html/);
  assert.doesNotMatch(dashboard, /async function devAll\(\)/);
});

test("persistent reads and dashboard bootstrap avoid stale instance state", async () => {
  const serverSource = await readFile(path.join(process.cwd(), "src", "server.ts"), "utf8");
  const dashboard = await readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
  assert.match(serverSource, /refreshPersistentState/);
  assert.match(serverSource, /await refreshPersistentState\(\)/);
  assert.match(dashboard, /async function boot\(\)/);
  assert.match(dashboard, /const all = await refreshRuns\(\);/);
  assert.match(dashboard, /if \(all\.length\)/);
  assert.doesNotMatch(dashboard, /async function boot\(\)[\s\S]*?await demo\(\);/);
  assert.match(dashboard, /await refreshRuns\(\);\s*await refreshGroups\(\)/);
});

test("report quality exposes declared-count warnings without changing source results", async () => {
  const response = await uploadXml(await readFile(fixture("quality-mismatch.xml"), "utf8"), { externalRunId: "quality-mismatch" });
  const result = await response.json() as any;
  assert.equal(response.status, 201);
  assert.equal(result.preview.quality.status, "ACCEPTED_WITH_WARNINGS");
  assert.ok(result.preview.quality.issues.some((issue: any) => issue.code === "DECLARED_TESTS_MISMATCH"));
  assert.equal(result.preview.summary.logicalTests, 2);
  assert.equal(result.preview.summary.passed, 2);
  assert.equal(result.run.rawRecords.length, 2);
});

test("contract-breaking report quality issues are quarantined before ingestion", async () => {
  const xml = "<?xml version=\"1.0\"?><testsuites><testsuite name=\"Quality\"><testcase classname=\"QualityTest\"/></testsuite></testsuites>";
  const response = await uploadXml(xml, { externalRunId: "quality-missing-name" });
  const result = await response.json() as any;
  assert.equal(response.status, 422);
  assert.equal(result.error, "Report was quarantined and was not ingested.");
  assert.equal(result.quality.status, "QUARANTINED");
  assert.ok(result.quality.issues.some((issue: any) => issue.code === "MISSING_TESTCASE_NAME"));
  assert.equal(result.preview.summary.logicalTests, 1);
});

test("ingested runs expose stable source provenance", async () => {
  const xml = "<?xml version=\"1.0\"?><testsuites><testsuite name=\"Provenance\"><testcase classname=\"ProvenanceTest\" name=\"source\"/></testsuite></testsuites>";
  const response = await uploadXml(xml, { projectId: "project-provenance", build: "build-provenance", environment: "staging", externalRunId: "external-provenance" });
  const result = await response.json() as any;
  assert.equal(response.status, 201);
  assert.equal(result.preview.provenance.sourceType, "manual-upload");
  assert.equal(result.preview.provenance.sourceName, "inline.xml");
  assert.equal(result.preview.provenance.externalRunId, "external-provenance");
  assert.equal(result.preview.provenance.projectId, "project-provenance");
  assert.equal(result.preview.provenance.build, "build-provenance");
  assert.equal(result.preview.provenance.environment, "staging");
  assert.match(result.preview.provenance.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.run.provenance.contentHash, result.preview.provenance.contentHash);
  assert.equal(result.run.provenance.ingestedAt, result.run.ingestedAt);
});

test("retry configuration accepts validated values and returns the stored project policy", async () => {
  const projectId = "retry-config-regression";
  const update = await fetch(`${baseUrl}/api/retry-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, retryAnalyzerEnabled: true, maxRetries: 3, skippedSequencePolicy: "SKIPPED_THEN_TERMINAL_IS_RETRY", ordinarySkippedPolicy: "COUNT_AS_SKIPPED", version: "policy-v2" })
  });
  const updated = await update.json() as any;
  assert.equal(update.status, 200);
  assert.equal(updated.projectId, projectId);
  assert.equal(updated.retryAnalyzerEnabled, true);
  assert.equal(updated.maxRetries, 3);
  assert.equal(updated.skippedSequencePolicy, "SKIPPED_THEN_TERMINAL_IS_RETRY");
  assert.equal(updated.version, "policy-v2");

  const read = await fetch(`${baseUrl}/api/retry-config?projectId=${projectId}`);
  assert.deepEqual(await read.json(), updated);
  assert.equal((await fetch(`${baseUrl}/api/retry-config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, maxRetries: 101 }) })).status, 400);
});

test("result detail returns the exact reported testcase and run provenance", async () => {
  const xml = "<?xml version=\"1.0\"?><testsuites name=\"Detail report\"><testsuite name=\"Checkout / Chrome\"><testcase classname=\"CheckoutTest\" name=\"submitOrder\" parameters=\"region=us-east\" time=\"1.25\"><failure message=\"checkout failed\">stack line 1\nstack line 2</failure></testcase></testsuite></testsuites>";
  const response = await uploadXml(xml, { projectId: "detail-project", build: "detail-build", environment: "staging", externalRunId: "detail-run" });
  const ingested = await response.json() as any;
  assert.equal(response.status, 201);
  const testId = ingested.run.logicalTests[0].id;

  const detailResponse = await fetch(`${baseUrl}/api/test-runs/${ingested.run.id}/results/${testId}`);
  const detail = await detailResponse.json() as any;
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(detail.run.provenance, ingested.run.provenance);
  assert.equal(detail.run.build, "detail-build");
  assert.equal(detail.result.id, testId);
  assert.equal(detail.result.name, "submitOrder");
  assert.equal(detail.result.suite, "Checkout / Chrome");
  assert.equal(detail.result.className, "CheckoutTest");
  assert.equal(detail.result.parameters, "region=us-east");
  assert.equal(detail.result.finalStatus, "failed");
  assert.equal(detail.result.attempts[0].order, 1);
  assert.equal(detail.result.attempts[0].rawStatus, "FAILED");
  assert.equal(detail.result.attempts[0].duration, "1.25");
  assert.equal(detail.result.attempts[0].message, "checkout failed");
  assert.equal(detail.result.attempts[0].stackTrace, "stack line 1\nstack line 2");
  assert.equal(detail.result.attempts[0].attemptNumber, 1);
  assert.equal(detail.result.retryCount, 0);
  assert.equal(detail.result.flaky, false);
  assert.equal("rawReport" in detail, false);
});

test("result detail distinguishes missing runs and missing results", async () => {
  const missingRun = await fetch(`${baseUrl}/api/test-runs/missing-run/results/missing-test`);
  assert.equal(missingRun.status, 404);
  assert.equal((await missingRun.json()).error, "Test run not found");

  const xml = "<?xml version=\"1.0\"?><testsuites><testsuite name=\"Missing detail\"><testcase name=\"present\"/></testsuite></testsuites>";
  const ingested = await (await uploadXml(xml, { externalRunId: "missing-result-run" })).json() as any;
  const missingResult = await fetch(`${baseUrl}/api/test-runs/${ingested.run.id}/results/missing-test`);
  assert.equal(missingResult.status, 404);
  assert.equal((await missingResult.json()).error, "Test result not found");
});

test("result detail exposes data-provider iteration and review evidence", async () => {
  const collapsed = await (await uploadXml(await readFile(fixture("testng-dataprovider-collapse.xml"), "utf8"), { sourceType: "testng-junit" })).json() as any;
  const collapsedTest = collapsed.run.logicalTests.find((test: any) => test.parameters === "user=alice");
  const collapsedDetail = await (await fetch(`${baseUrl}/api/test-runs/${collapsed.run.id}/results/${collapsedTest.id}`)).json() as any;
  assert.equal(collapsedDetail.result.dataProvider, true);
  assert.equal(collapsedDetail.result.attempts.length, 2);
  assert.equal(collapsedDetail.result.flaky, true);

  const review = await (await uploadXml(await readFile(fixture("testng-dataprovider-review.xml"), "utf8"), { sourceType: "testng-junit" })).json() as any;
  const reviewTest = review.run.logicalTests.find((test: any) => test.needsReview);
  const reviewDetail = await (await fetch(`${baseUrl}/api/test-runs/${review.run.id}/results/${reviewTest.id}`)).json() as any;
  assert.equal(reviewDetail.result.needsReview, true);
  assert.equal(reviewDetail.result.observed.passed, 1);
  assert.equal(reviewDetail.result.observed.skipped, 1);
  assert.equal(reviewDetail.result.attempts.length, 2);
});

test("result dispositions provide matching prior suggestions", async () => {
  const xml = "<?xml version=\"1.0\"?><testsuites><testsuite name=\"Disposition\"><testcase classname=\"CheckoutTest\" name=\"submitOrder\"><failure message=\"known checkout defect\">java.lang.AssertionError: known checkout defect</failure></testcase></testsuite></testsuites>";
  const first = await (await uploadXml(xml, { externalRunId: "disposition-first", build: "build-1" })).json() as any;
  const firstTest = first.run.logicalTests[0];
  const saved = await fetch(`${baseUrl}/api/test-runs/${first.run.id}/results/${firstTest.id}/disposition`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ classification: "known-failure", notes: "Tracked defect", jiraIssue: { key: "QA-321" } }) });
  assert.equal(saved.status, 200);
  const second = await (await uploadXml(xml, { externalRunId: "disposition-second", build: "build-2" })).json() as any;
  const secondTest = second.run.logicalTests[0];
  const detail = await (await fetch(`${baseUrl}/api/test-runs/${second.run.id}/results/${secondTest.id}`)).json() as any;
  assert.equal(detail.disposition, undefined);
  assert.equal(detail.suggestions.length, 1);
  assert.equal(detail.suggestions[0].classification, "known-failure");
  assert.equal(detail.suggestions[0].jiraIssue.key, "QA-321");
  const applied = await fetch(`${baseUrl}/api/test-runs/${second.run.id}/results/${secondTest.id}/disposition`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ classification: "known-failure", notes: "Confirmed still tracked", jiraIssue: { key: "QA-321" } }) });
  const appliedDetail = await applied.json() as any;
  assert.equal(appliedDetail.disposition.classification, "known-failure");
  assert.equal(appliedDetail.disposition.notes, "Confirmed still tracked");
});

test("normalized storage schema includes provenance columns", async () => {
  const storageSource = await readFile(path.join(process.cwd(), "src", "storage.ts"), "utf8");
  assert.match(storageSource, /source_type/);
  assert.match(storageSource, /source_name/);
  assert.match(storageSource, /external_run_id/);
  assert.match(storageSource, /content_hash/);
  assert.match(storageSource, /provenance/);
});

test("developer checks live in a separate mobile workspace", async () => {
  const developerDashboard = await readFile(path.join(process.cwd(), "public", "developer.html"), "utf8");
  assert.match(developerDashboard, /Phase 5 checks/);
  assert.match(developerDashboard, /Developer workspace/);
  assert.match(developerDashboard, /async function devAll\(\)/);
  assert.match(developerDashboard, /sourceType\s*===\s*['"]manual-upload['"]/);
  assert.match(developerDashboard, /id="devAll"/);
});
