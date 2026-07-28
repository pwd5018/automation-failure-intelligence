import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function MigrationShell() {
  return (
    <main className="migration-shell">
      <span className="migration-eyebrow">Phase 7 frontend foundation</span>
      <h1>Automation Failure Intelligence</h1>
      <p>
        The React/Vite workspace is ready for the incremental dashboard migration.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MigrationShell />
  </StrictMode>
);
