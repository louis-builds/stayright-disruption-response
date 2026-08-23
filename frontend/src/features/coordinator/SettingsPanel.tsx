import { useEffect, useState } from "react";
import * as api from "./api";
import type { SystemSettings } from "./types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    void api.fetchSystemSettings().then((res) => {
      if (res.code === 0) setSettings(res.data);
      setLoading(false);
    });
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    const res = await api.updateSystemSettings(settings);
    if (res.code === 0) {
      setSettings(res.data);
      setSavedAt(new Date());
    }
    setSaving(false);
  }

  if (loading || !settings) {
    return (
      <p className="coord-empty">
        <span className="coord-search-spinner coord-loading-spinner-dark" aria-hidden="true" /> Loading…
      </p>
    );
  }

  return (
    <div className="coord-table">
      <div className="coord-row">
        <div className="coord-row-main" style={{ maxWidth: 460 }}>
          <label className="coord-field">
            <span>Unresolved-turn escalation threshold</span>
            <input
              type="number"
              min={1}
              value={settings.unresolvedTurnThreshold}
              onChange={(e) =>
                setSettings({ ...settings, unresolvedTurnThreshold: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <p className="coord-row-meta">
            After this many guest messages in one still-open case without resolution, the AI hands off to a
            coordinator automatically.
          </p>

          <label className="coord-field" style={{ marginTop: "1rem", flexDirection: "row", alignItems: "center", gap: "0.6rem" }}>
            <input
              type="checkbox"
              checked={settings.lowConfidenceEscalationEnabled}
              onChange={(e) => setSettings({ ...settings, lowConfidenceEscalationEnabled: e.target.checked })}
            />
            <span>Escalate when the AI reports low confidence</span>
          </label>
          <p className="coord-row-meta">
            The AI self-reports HIGH/LOW confidence per reply — there's no numeric score to tune, only whether a
            LOW self-report triggers a hand-off.
          </p>
        </div>
        <div className="coord-row-actions">
          <button type="button" className="coord-btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </button>
          {savedAt && (
            <span className="coord-row-meta">Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
      </div>
    </div>
  );
}
