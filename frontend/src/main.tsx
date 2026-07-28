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

const headerRoot = document.getElementById("reactHeaderRoot");
const summaryRoot = document.getElementById("reactSummaryRoot");
if (headerRoot) createRoot(headerRoot).render(<StrictMode><HeaderIsland /></StrictMode>);
if (summaryRoot) createRoot(summaryRoot).render(<StrictMode><SummaryIsland /></StrictMode>);
