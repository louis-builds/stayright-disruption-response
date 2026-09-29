import { useState } from "react";
import { useAuth } from "../auth";
import { BadCasesPanel } from "../coordinator/BadCasesPanel";
import { KnowledgeBasePanel } from "../coordinator/KnowledgeBasePanel";
import { SystemAdminPanel } from "../coordinator/SystemAdminPanel";
import "../coordinator/CoordinatorHomePage.css";
import { AdminDashboardShell } from "./AdminDashboardShell";
import { RecordingAuditPage } from "./RecordingAuditPage";
import type { AdminTab } from "./types";

export function AdminHomePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<AdminTab>("recordings");
  const [searchQuery, setSearchQuery] = useState("");

  if (!user) return null;

  return (
    <AdminDashboardShell active={tab} onNavigate={setTab} onSearch={setSearchQuery}>
      {tab === "recordings" && <RecordingAuditPage searchQuery={searchQuery} />}
      {tab === "users" && (
        <div className="audit-page coord-home">
          <div className="coord-panel">
            <SystemAdminPanel />
          </div>
        </div>
      )}
      {tab === "kb" && (
        <div className="audit-page coord-home">
          <div className="coord-panel">
            <KnowledgeBasePanel />
          </div>
        </div>
      )}
      {tab === "bad_cases" && (
        <div className="audit-page coord-home">
          <div className="coord-panel">
            <BadCasesPanel />
          </div>
        </div>
      )}
    </AdminDashboardShell>
  );
}
