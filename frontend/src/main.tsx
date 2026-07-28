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
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const selected = state.options.find(option => option.id === state.selected) || state.options[0];
  const visibleOptions = state.options.filter(option => option.label.toLowerCase().includes(query.toLowerCase()) || relativeTime(option.date).toLowerCase().includes(query.toLowerCase()));
  const selectRun = (id: string) => {
    const legacy = document.getElementById("runHistory") as HTMLSelectElement | null;
    if (!legacy) return;
    legacy.value = id;
    dispatchLegacy("runHistory", "change");
    const legacySearch = document.getElementById("runSearch") as HTMLInputElement | null;
    if (legacySearch) { legacySearch.value = ""; dispatchLegacy("runSearch", "input"); }
    setOpen(false);
    setQuery("");
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
    setHighlighted(0);
    const legacy = document.getElementById("runSearch") as HTMLInputElement | null;
    if (!legacy) return;
    legacy.value = value;
    dispatchLegacy("runSearch", "input");
  };
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHighlighted(index => Math.min(index + 1, Math.max(visibleOptions.length - 1, 0))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setHighlighted(index => Math.max(index - 1, 0)); }
    if (event.key === "Enter") { event.preventDefault(); const option = visibleOptions[highlighted]; if (option) selectRun(option.id); }
    if (event.key === "Escape") { setOpen(false); searchRef.current?.blur(); }
  };
  return <div className="react-run-workspace">
    <div className="react-run-heading"><div><span className="react-kicker">Run navigation</span><h2>Run workspace</h2></div><span className={`react-storage-dot ${state.status.toLowerCase().includes("postgres") ? "connected" : ""}`}><i />{state.status.replace(" connected", "")}</span></div>
    <label className="react-run-label" htmlFor="reactRunSearch">Search or select a stored run</label>
    <div className={`react-run-command ${open ? "open" : ""}`}>
      <div className="react-run-command-row"><input ref={searchRef} id="reactRunSearch" className="react-run-search" role="combobox" aria-expanded={open} aria-controls="reactRunOptions" aria-autocomplete="list" value={query} onFocus={() => setOpen(true)} onChange={event => searchRuns(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Search builds, status, or environment" /><button type="button" className="react-run-command-toggle" aria-label={open ? "Close run selector" : "Open run selector"} onClick={() => { setOpen(value => !value); searchRef.current?.focus(); }}>⌄</button></div>
      {open && <div id="reactRunOptions" className="react-run-options" role="listbox" aria-label="Stored runs">
        {visibleOptions.length ? visibleOptions.map((option, index) => <button key={option.id} type="button" role="option" aria-selected={option.id === state.selected} className={`react-run-option ${option.id === state.selected ? "selected" : ""} ${index === highlighted ? "highlighted" : ""}`} onMouseEnter={() => setHighlighted(index)} onClick={() => selectRun(option.id)}><span><b>{option.label}</b><small>Stored report</small></span><time>{relativeTime(option.date)}</time></button>) : <p className="react-run-empty">No matching stored runs</p>}
      </div>}
    </div>
    <div className="react-run-tools"><select aria-label="Filter stored runs" value={status} onChange={event => selectStatus(event.target.value)}><option value="">All stored runs</option><option value="PASSED">Runs containing passed results</option><option value="FAILED">Runs containing failed results</option><option value="ERROR">Runs containing errors</option><option value="SKIPPED">Runs containing skipped results</option></select></div>
    <div className="react-run-meta"><span>{selected?.label || "No report selected"}</span><span>•</span><span>{selected ? relativeTime(selected.date) : "Awaiting report"}</span></div>
    <div className="react-run-info"><p>{state.info || "Report metadata and test results will appear here."}</p></div>
    <p className="react-run-hint">Source XML remains the authority for every reported result.</p>
  </div>;
}

type TriageAttempt = { label: string; tone: string; warning?: string };
type TriageCard = { id: string; name: string; meta: string; status: string; tone: string; evidence: string; attempts: TriageAttempt[]; review: string };

function readTriageCards(): TriageCard[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.legacy-test-seam .test-row')).map(row => {
    const status = row.querySelector<HTMLElement>('.test-history > span')?.textContent?.trim() || 'UNKNOWN';
    const attempts = Array.from(row.querySelectorAll<HTMLElement>('.attempt-history .attempt')).map(attempt => ({
      label: attempt.textContent?.trim() || '',
      tone: Array.from(attempt.classList).find(value => ['passed', 'failed', 'error', 'skipped'].includes(value)) || 'unknown',
      warning: attempt.getAttribute('title') || undefined
    }));
    const metas = Array.from(row.querySelectorAll<HTMLElement>('.test-meta')).map(item => item.textContent?.trim() || '').filter(Boolean);
    return {
      id: row.id.replace(/^test-/, ''),
      name: row.querySelector<HTMLElement>('.test-name')?.textContent?.trim() || 'Unnamed test',
      meta: row.querySelector<HTMLElement>('.test-name + .test-meta')?.textContent?.trim() || '',
      status,
      tone: status.toLowerCase().replace(/\s+/g, '-'),
      evidence: metas.filter(value => value !== row.querySelector<HTMLElement>('.test-name + .test-meta')?.textContent?.trim()).slice(-1)[0] || '',
      attempts,
      review: status === 'NEEDS REVIEW' ? metas.filter(value => !value.startsWith('Observed records:')).slice(-1)[0] || 'Sequence needs review' : ''
    };
  });
}

function useLegacyTriage() {
  const [cards, setCards] = React.useState(readTriageCards);
  React.useEffect(() => {
    const target = document.querySelector('.legacy-test-seam');
    if (!target) return;
    const observer = new MutationObserver(() => setCards(readTriageCards()));
    observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, []);
  return cards;
}

function TriageCardView({ card, onOpen }: { card: TriageCard; onOpen: () => void }) {
  return <button type="button" className={`react-triage-card ${card.tone}`} onClick={onOpen} aria-label={`Open ${card.name} result details`}>
    <span className="react-triage-card-main">
      <span className="react-triage-card-heading"><strong>{card.name}</strong><span className={`react-triage-status ${card.tone}`}>{card.status}</span></span>
      <span className="react-triage-card-meta">{card.meta}</span>
      {card.evidence && <span className="react-triage-evidence">{card.evidence}</span>}
      {card.attempts.length > 0 && <span className="react-attempt-chain" aria-label="Attempt history">{card.attempts.map((attempt, index) => <React.Fragment key={`${attempt.label}-${index}`}><span className={`react-attempt-pill ${attempt.tone}`} title={attempt.warning}>{attempt.label}</span>{index < card.attempts.length - 1 && <span className="react-attempt-arrow" aria-hidden="true">→</span>}</React.Fragment>)}</span>}
      {card.review && <details className="react-triage-warning" onClick={event => event.stopPropagation()}><summary>Retry metadata needs review</summary><span>{card.review}</span></details>}
    </span>
    <span className="react-triage-open" aria-hidden="true">›</span>
  </button>;
}

function TriageIsland() {
  const cards = useLegacyTriage();
  const [status, setStatus] = React.useState((document.getElementById('testStatus') as HTMLSelectElement | null)?.value || '');
  const [query, setQuery] = React.useState((document.getElementById('testSearch') as HTMLInputElement | null)?.value || '');
  const filtered = cards.filter(card => {
    const statusMatch = !status || (status === 'needs-review' ? card.status === 'NEEDS REVIEW' : card.status.toLowerCase() === status);
    const queryMatch = !query || `${card.name} ${card.meta} ${card.evidence}`.toLowerCase().includes(query.toLowerCase());
    return statusMatch && queryMatch;
  });
  const filterCards = (value: string) => {
    setStatus(value);
    const legacy = document.getElementById('testStatus') as HTMLSelectElement | null;
    if (legacy) { legacy.value = value; dispatchLegacy('testStatus', 'input'); }
  };
  const searchCards = (value: string) => {
    setQuery(value);
    const legacy = document.getElementById('testSearch') as HTMLInputElement | null;
    if (legacy) { legacy.value = value; dispatchLegacy('testSearch', 'input'); }
  };
  const openCard = (id: string) => document.getElementById(`test-${id}`)?.click();
  return <div className="react-triage">
    <div className="react-triage-heading"><div><span className="react-kicker">Test results</span><h3>Investigation queue</h3></div><span className="react-triage-count">{filtered.length} of {cards.length}</span></div>
    <p className="react-triage-subtitle">Open a result to inspect source evidence and attempt history.</p>
    <div className="react-triage-filters"><select aria-label="Filter test results" value={status} onChange={event => filterCards(event.target.value)}><option value="">All test results</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="error">Error</option><option value="skipped">Skipped</option><option value="needs-review">Needs review</option></select><input aria-label="Search test results" placeholder="Search tests or classes" value={query} onChange={event => searchCards(event.target.value)} /></div>
    <div className="react-triage-list">{filtered.length ? filtered.map(card => <TriageCardView key={card.id} card={card} onOpen={() => openCard(card.id)} />) : <p className="react-triage-empty">No matching test results.</p>}</div>
  </div>;
}

type InspectorPayload = any;

function resultStatus(result: any) {
  return result.needsReview ? "NEEDS REVIEW" : String(result.finalStatus || "unknown").toUpperCase();
}

function InspectorIsland() {
  const [view, setView] = React.useState<{kind: "empty" | "result" | "group"; payload: InspectorPayload}>({kind: "empty", payload: null});
  const [classification, setClassification] = React.useState("unknown");
  const [jira, setJira] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [copyStatus, setCopyStatus] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const onResult = (event: Event) => {
      const payload = (event as CustomEvent).detail;
      setView({kind: "result", payload});
      setClassification(payload.disposition?.classification || "unknown");
      setJira(payload.disposition?.jiraIssue?.key || "");
      setNotes(payload.disposition?.notes || "");
      setCopyStatus("");
    };
    const onGroup = (event: Event) => { setView({kind: "group", payload: (event as CustomEvent).detail}); setCopyStatus(""); };
    const onClose = () => setView({kind: "empty", payload: null});
    window.addEventListener("afi:result-detail", onResult);
    window.addEventListener("afi:group-detail", onGroup);
    window.addEventListener("afi:close-result-detail", onClose);
    return () => {
      window.removeEventListener("afi:result-detail", onResult);
      window.removeEventListener("afi:group-detail", onGroup);
      window.removeEventListener("afi:close-result-detail", onClose);
    };
  }, []);

  const copy = async (text: string) => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch { const area = document.createElement("textarea"); area.value = text; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove(); }
    setCopyStatus("Copied to clipboard.");
    window.setTimeout(() => setCopyStatus(""), 1800);
  };
  const back = () => (window as any).closeTestDetail?.();
  const saveResult = async () => {
    const payload = view.payload;
    setSaving(true);
    const response = await fetch(`/api/test-runs/${payload.run.id}/results/${payload.result.id}/disposition`, {method: "PATCH", headers: {"content-type": "application/json"}, body: JSON.stringify({classification, notes, jiraIssue: jira.trim() ? {key: jira.trim()} : null})});
    setSaving(false);
    if (!response.ok) { setCopyStatus("Unable to save disposition."); return; }
    const next = await response.json();
    setView({kind: "result", payload: next});
    setClassification(next.disposition?.classification || "unknown");
    setJira(next.disposition?.jiraIssue?.key || "");
    setNotes(next.disposition?.notes || "");
    setCopyStatus("Disposition saved.");
  };
  const saveGroup = async () => {
    const group = view.payload;
    setSaving(true);
    const response = await fetch(`/api/failure-groups/${group.id}`, {method: "PATCH", headers: {"content-type": "application/json"}, body: JSON.stringify({classification, notes, jiraIssue: jira.trim() ? {key: jira.trim()} : null})});
    setSaving(false);
    if (response.ok) { setView({kind: "group", payload: await response.json()}); setCopyStatus("Disposition saved."); }
    else setCopyStatus("Unable to save disposition.");
  };
  if (view.kind === "empty") return <div className="react-inspector-empty"><span className="react-kicker">Inspector</span><p>Select a result or failure group to inspect its evidence.</p></div>;
  if (view.kind === "group") {
    const group = view.payload;
    const occurrences = group.selectedRunOccurrences ?? group.occurrences;
    return <div className="react-inspector">
      <InspectorToolbar title="Failure inspector" onBack={back} onCopy={() => copy([group.summary, (group.outcomes || []).join(" / ") || "FAILURE", `${occurrences} occurrence(s) in this run`].join(" | "))} copyLabel="Copy summary" />
      {copyStatus && <div className="react-copy-status" aria-live="polite">{copyStatus}</div>}
      <h2>{group.summary}</h2><p className="react-inspector-muted">{occurrences} occurrence(s) in this run · {group.occurrences} overall · {(group.outcomes || []).join(" / ") || "FAILURE"}</p>
      <DispositionPanel classification={classification} jira={jira} notes={notes} onClassification={setClassification} onJira={setJira} onNotes={setNotes} onSave={saveGroup} saving={saving} />
      <h3>Evidence by reported result</h3>
      <div className="react-evidence-list">{(group.evidence || []).map((item: any) => <button key={`${item.runId}-${item.testId}`} type="button" onClick={() => (window as any).openEvidence?.(item.runId, item.testId)}>{item.outcome} · {item.testName} · {item.build}</button>)}</div>
      <pre>{group.stackTrace || "No stack trace reported."}</pre>
    </div>;
  }
  const payload = view.payload;
  const result = payload.result;
  const iterations = Array.isArray(payload.iterations) && payload.iterations.length ? payload.iterations : [result];
  const attempts = (result.attempts || []);
  const evidence = attempts.map((attempt: any, index: number) => `Attempt ${attempt.attemptNumber || index + 1} [${String(attempt.rawStatus || attempt.status || "UNKNOWN").toUpperCase()}]\n${attempt.message || ""}${attempt.stackTrace ? `\n${attempt.stackTrace}` : ""}`).join("\n\n");
  const canClassify = result.needsReview || ["failed", "error"].includes(result.finalStatus) || attempts.some((attempt: any) => ["FAILED", "ERROR"].includes(attempt.rawStatus));
  return <div className="react-inspector">
    <InspectorToolbar title="Result inspector" onBack={back} onCopy={() => copy([result.name, result.className || result.suite || "", result.suite || "", result.parameters || "", resultStatus(result)].filter(Boolean).join(" | "))} onCopyEvidence={() => copy(evidence)} />
    {copyStatus && <div className="react-copy-status" aria-live="polite">{copyStatus}</div>}
    <div className="react-inspector-title"><div><h2>{result.name}</h2><p>{result.className || result.suite || ""}</p></div><span className={`react-inspector-status ${result.needsReview ? "review" : result.finalStatus}`}>{resultStatus(result)}</span></div>
    <p className="react-inspector-muted">{payload.run.build || payload.run.id} · {payload.run.environment || "default"}</p>
    <div className="react-inspector-pills"><span>{iterations.length} Iteration{iterations.length === 1 ? "" : "s"}</span><span>{attempts.length} Attempt{attempts.length === 1 ? "" : "s"}</span><span>{result.needsReview ? "Needs review" : resultStatus(result)}</span></div>
    {canClassify && <DispositionPanel classification={classification} jira={jira} notes={notes} suggestions={payload.suggestions || []} onClassification={setClassification} onJira={setJira} onNotes={setNotes} onSave={saveResult} saving={saving} />}
    <h3>Execution trace</h3>
    <div className="react-trace">{attempts.length ? attempts.map((attempt: any, index: number) => <div className="react-trace-step" key={`${attempt.attemptNumber || index}-${attempt.rawStatus}`}><i className={String(attempt.rawStatus || attempt.status || "").toLowerCase()} /><div><div className="react-trace-heading"><strong>Attempt {attempt.attemptNumber || index + 1} · {String(attempt.rawStatus || attempt.status || "UNKNOWN").toUpperCase()}</strong><span>{attempt.duration ? `${attempt.duration}s` : ""}</span></div><p>{attempt.message || attempt.stackTrace || "No additional evidence reported."}</p></div></div>) : <p className="react-inspector-muted">No attempt evidence reported.</p>}</div>
  </div>;
}

function InspectorToolbar({title, onBack, onCopy, onCopyEvidence, copyLabel = "Copy summary"}: {title: string; onBack: () => void; onCopy: () => void; onCopyEvidence?: () => void; copyLabel?: string}) {
  return <div className="react-inspector-toolbar"><div><span className="react-kicker">{title}</span></div><div className="react-inspector-actions"><button type="button" onClick={onBack}>← Back</button><button type="button" onClick={onCopy}>▣ {copyLabel}</button>{onCopyEvidence && <button type="button" onClick={onCopyEvidence}>▤ Evidence</button>}</div></div>;
}

function DispositionPanel({classification, jira, notes, suggestions = [], onClassification, onJira, onNotes, onSave, saving}: {classification: string; jira: string; notes: string; suggestions?: any[]; onClassification: (value: string) => void; onJira: (value: string) => void; onNotes: (value: string) => void; onSave: () => void; saving: boolean}) {
  return <section className="react-disposition"><div className="react-disposition-heading"><div><span className="react-kicker">Disposition</span><h3>Classify this result</h3></div><span>Manual only</span></div>{suggestions.length > 0 && <div className="react-suggestions"><small>Previous matching decisions</small>{suggestions.map((item: any) => <button key={`${item.classification}-${item.build || ""}`} type="button" onClick={() => { onClassification(item.classification); onJira(item.jiraIssue?.key || ""); onNotes(item.notes || ""); }}>{item.classification}{item.jiraIssue?.key ? ` · ${item.jiraIssue.key}` : ""}</button>)}</div>}<div className="react-disposition-grid"><label>Classification<select value={classification} onChange={event => onClassification(event.target.value)}><option value="unknown">Unknown</option><option value="product-defect">Product defect</option><option value="test-defect">Automation issue</option><option value="environment-issue">Environment issue</option><option value="test-data-issue">Test data issue</option><option value="known-failure">Known Jira issue</option><option value="duplicate">Duplicate</option></select></label><label>Jira issue<input value={jira} onChange={event => onJira(event.target.value)} placeholder="QA-123" /></label></div><label>Notes<textarea value={notes} onChange={event => onNotes(event.target.value)} placeholder="Why this classification applies" /></label><button type="button" className="react-button react-button-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save disposition"}</button></section>;
}

const headerRoot = document.getElementById("reactHeaderRoot");
const summaryRoot = document.getElementById("reactSummaryRoot");
const runRoot = document.getElementById("reactRunWorkspaceRoot");
const triageRoot = document.getElementById("reactTriageRoot");
const inspectorRoot = document.getElementById("reactInspectorRoot");
if (headerRoot) createRoot(headerRoot).render(<StrictMode><HeaderIsland /></StrictMode>);
if (summaryRoot) createRoot(summaryRoot).render(<StrictMode><SummaryIsland /></StrictMode>);
if (runRoot) createRoot(runRoot).render(<StrictMode><RunWorkspaceIsland /></StrictMode>);
if (triageRoot) createRoot(triageRoot).render(<StrictMode><TriageIsland /></StrictMode>);
if (inspectorRoot) createRoot(inspectorRoot).render(<StrictMode><InspectorIsland /></StrictMode>);
