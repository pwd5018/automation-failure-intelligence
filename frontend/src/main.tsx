import * as React from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function clickLegacy(id: string) {
  document.getElementById(id)?.click();
}

function readText(id: string, fallback = "") {
  return document.getElementById(id)?.textContent?.trim() || fallback;
}

function readCount(id: string) {
  const count = Number(readText(id, "0"));
  return Number.isFinite(count) ? count : 0;
}

type SummaryState = {
  title: string;
  logical: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  retries: number;
  review: number;
  status: string;
  processing: string;
};

function readSummary(): SummaryState {
  const badges = readText("summaryBadges");
  return {
    title: readText("summaryTitle", "No report loaded"),
    logical: readCount("logicalCount"),
    passed: readCount("passedCount"),
    failed: readCount("failedCount"),
    errors: readCount("errorCount"),
    skipped: readCount("skippedCount"),
    retries: readCount("retryCount"),
    review: readCount("needsReviewCount"),
    status: badges.split(/\s+/)[0] || "",
    processing: badges.split(/\s+/)[1] || ""
  };
}

function useLegacySummary(): SummaryState {
  const [summary, setSummary] = React.useState(readSummary);

  React.useEffect(() => {
    const target = document.querySelector(".legacy-summary-seam");
    if (!target) return;
    const observer = new MutationObserver(() => setSummary(readSummary()));
    observer.observe(target, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return summary;
}

function HeaderIsland() {
  return (
    <header className="react-header">
      <div>
        <span className="react-eyebrow">FailureIntel</span>
        <h1>Test triage, without the guesswork.</h1>
      </div>
      <div className="react-header-actions">
        <button type="button" className="react-button react-button-primary" onClick={() => clickLegacy("ingestionToggle")}>+ Ingest</button>
        <button type="button" className="react-button" onClick={() => clickLegacy("demo")}>Load demo</button>
        <a className="react-icon-link" href="/developer.html" target="_blank" rel="noopener" aria-label="Open developer checks">DC</a>
      </div>
    </header>
  );
}

function StatusBar({ summary }: { summary: SummaryState }) {
  const total = Math.max(summary.logical, summary.passed + summary.failed + summary.errors + summary.skipped + summary.review);
  const segments = [
    ["passed", summary.passed],
    ["failed", summary.failed],
    ["errors", summary.errors],
    ["skipped", summary.skipped],
    ["review", Math.max(0, total - summary.passed - summary.failed - summary.errors - summary.skipped)]
  ] as const;
  return <div className="react-status-bar" aria-label={`${total} logical tests by status`} role="img">
    {segments.filter(([, count]) => count > 0).map(([name, count]) => <span key={name} className={`react-status-segment ${name}`} style={{ width: `${(count / Math.max(total, 1)) * 100}%` }} title={`${count} ${name}`} />)}
  </div>;
}

function SummaryIsland() {
  const summary = useLegacySummary();
  const metrics = [
    ["Passed", summary.passed, "passed"],
    ["Failed", summary.failed, "failed"],
    ["Errors", summary.errors, "errors"],
    ["Skipped", summary.skipped, "skipped"],
    ["Needs review", summary.review, "review"]
  ] as const;
  return <div className="react-summary" aria-live="polite">
    <div className="react-summary-heading">
      <div>
        <span className="react-kicker">Latest report</span>
        <h2>{summary.title}</h2>
      </div>
      <div className="react-summary-badges"><span className={`react-status-pill ${summary.status.toLowerCase()}`}>{summary.status || "READY"}</span><span className="react-processing-pill">{summary.processing || "Awaiting report"}</span></div>
    </div>
    <StatusBar summary={summary} />
    <div className="react-metrics">
      {metrics.map(([label, value, tone]) => <button key={label} type="button" className={`react-metric ${tone === "review" ? "react-metric-button" : ""}`} onClick={tone === "review" ? () => clickLegacy("needsReviewMetric") : undefined}>
        <span>{label}</span><b>{value}</b>
      </button>)}
    </div>
    <div className="react-summary-foot"><span>{summary.logical} logical tests</span><span>{summary.retries} retries</span><span>{summary.review ? "Review required" : "Source statuses preserved"}</span></div>
  </div>;
}

type RunOption = { id: string; label: string; date?: string };

function readRunOptions(): RunOption[] {
  return Array.from(document.querySelectorAll<HTMLSelectElement>("#runHistory option")).filter(option => option.value).map(option => {
    const match = option.textContent?.match(/(\d{4}-\d{2}-\d{2}T[^ ]+)$/);
    return { id: option.value, label: option.textContent?.replace(/ - \d{4}-\d{2}-\d{2}T[^ ]+$/, "") || option.value, date: match?.[1] };
  });
}

function relativeTime(value?: string) {
  if (!value) return "Awaiting ingestion";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return value;
  const minutes = Math.max(1, Math.round(elapsed / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function dispatchLegacy(id: string, eventName: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  element?.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function useLegacyRuns() {
  const [state, setState] = React.useState({ options: readRunOptions(), selected: (document.getElementById("runHistory") as HTMLSelectElement | null)?.value || "", status: readText("storageStatus", "Checking status"), info: readText("runInfo") });
  React.useEffect(() => {
    const target = document.querySelector(".legacy-run-seam");
    if (!target) return;
    const observer = new MutationObserver(() => setState({ options: readRunOptions(), selected: (document.getElementById("runHistory") as HTMLSelectElement | null)?.value || "", status: readText("storageStatus", "Checking status"), info: readText("runInfo") }));
    observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, []);
  return state;
}

function RunWorkspaceIsland() {
  const state = useLegacyRuns();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("");
  const selected = state.options.find(option => option.id === state.selected) || state.options[0];
  const visibleOptions = state.options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()));
  const selectRun = (id: string) => {
    const legacy = document.getElementById("runHistory") as HTMLSelectElement | null;
    if (!legacy) return;
    legacy.value = id;
    dispatchLegacy("runHistory", "change");
  };
  const selectStatus = (value: string) => {
    setStatus(value);
    const legacy = document.getElementById("runStatus") as HTMLSelectElement | null;
    if (!legacy) return;
    legacy.value = value;
    dispatchLegacy("runStatus", "input");
  };
  const searchRuns = (value: string) => {
    setQuery(value);
    const legacy = document.getElementById("runSearch") as HTMLInputElement | null;
    if (!legacy) return;
    legacy.value = value;
    dispatchLegacy("runSearch", "input");
  };
  return <div className="react-run-workspace">
    <div className="react-run-heading"><div><span className="react-kicker">Run navigation</span><h2>Run workspace</h2></div><span className={`react-storage-dot ${state.status.toLowerCase().includes("postgres") ? "connected" : ""}`}><i />{state.status.replace(" connected", "")}</span></div>
    <label className="react-run-label" htmlFor="reactRunSearch">Search or select a stored run</label>
    <input id="reactRunSearch" className="react-run-search" value={query} onChange={event => searchRuns(event.target.value)} placeholder="Search builds, status, or environment" />
    <div className="react-run-options" role="listbox" aria-label="Stored runs">
      {visibleOptions.length ? visibleOptions.map(option => <button key={option.id} type="button" role="option" aria-selected={option.id === state.selected} className={`react-run-option ${option.id === state.selected ? "selected" : ""}`} onClick={() => selectRun(option.id)}><span>{option.label}</span><time>{relativeTime(option.date)}</time></button>) : <p className="react-run-empty">No matching stored runs</p>}
    </div>
    <div className="react-run-tools"><select aria-label="Filter stored runs" value={status} onChange={event => selectStatus(event.target.value)}><option value="">All stored runs</option><option value="PASSED">Runs containing passed results</option><option value="FAILED">Runs containing failed results</option><option value="ERROR">Runs containing errors</option><option value="SKIPPED">Runs containing skipped results</option></select></div>
    <div className="react-run-meta"><span>{selected?.label || "No report selected"}</span><span>•</span><span>{selected ? relativeTime(selected.date) : "Awaiting report"}</span></div>
    <div className="react-run-info"><p>{state.info || "Report metadata and test results will appear here."}</p></div>
    <p className="react-run-hint">Source XML remains the authority for every reported result.</p>
  </div>;
}

const headerRoot = document.getElementById("reactHeaderRoot");
const summaryRoot = document.getElementById("reactSummaryRoot");
const runRoot = document.getElementById("reactRunWorkspaceRoot");
if (headerRoot) createRoot(headerRoot).render(<StrictMode><HeaderIsland /></StrictMode>);
if (summaryRoot) createRoot(summaryRoot).render(<StrictMode><SummaryIsland /></StrictMode>);
if (runRoot) createRoot(runRoot).render(<StrictMode><RunWorkspaceIsland /></StrictMode>);
