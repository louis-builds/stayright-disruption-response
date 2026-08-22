import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import * as api from "./api";
import type { CaseActionPreview } from "./api";
import "./CaseActionConfirmPage.css";

type Status = "loading" | "ready" | "confirming" | "done" | "error";

export function CaseActionConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<Status>("loading");
  const [preview, setPreview] = useState<CaseActionPreview | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("This link is missing its confirmation token.");
      setStatus("error");
      return;
    }
    api.verifyCaseAction(token).then((res) => {
      if (res.code !== 0) {
        setError(res.message || "This link has expired or is no longer valid.");
        setStatus("error");
        return;
      }
      setPreview(res.data);
      setStatus("ready");
    });
  }, [token]);

  async function confirm() {
    setStatus("confirming");
    const res = await api.executeCaseAction(token);
    if (res.code !== 0) {
      setError(res.message || "This link has expired or is no longer valid.");
      setStatus("error");
      return;
    }
    setCaseId(res.data.caseId);
    setStatus("done");
  }

  return (
    <div className="case-action-page">
      <div className="case-action-card">
        <p className="case-action-brand">Travel Disruption Agent</p>

        {status === "loading" && <p className="case-action-loading">Checking your link…</p>}

        {status === "error" && (
          <>
            <h1>This link isn't valid anymore</h1>
            <p className="case-action-body">{error}</p>
            <Link className="case-action-secondary" to="/login">
              Sign in instead
            </Link>
          </>
        )}

        {(status === "ready" || status === "confirming") && preview && (
          <>
            <h1>Confirm your option</h1>
            <p className="case-action-body">
              <strong>{preview.hotelName}</strong> can offer:
            </p>
            <p className="case-action-option">{preview.optionTitle}</p>
            {preview.checkIn && preview.checkOut && (
              <p className="case-action-dates">
                {preview.checkIn} → {preview.checkOut}
              </p>
            )}
            <button className="case-action-confirm" onClick={confirm} disabled={status === "confirming"}>
              {status === "confirming" ? "Confirming…" : "Confirm this option"}
            </button>
          </>
        )}

        {status === "done" && (
          <>
            <h1>Confirmed</h1>
            <p className="case-action-body">This option is now selected on your case.</p>
            <Link className="case-action-secondary" to={`/cases/${caseId}`}>
              Go to my case →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
