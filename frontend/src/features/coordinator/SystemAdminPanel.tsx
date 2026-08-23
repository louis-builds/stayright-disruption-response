import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { Pagination, usePagination } from "../../shared/components/Pagination";
import { useAuth } from "../auth";
import type { AdminUser } from "./types";

function DisableModal({ user, onCancel, onConfirm }: { user: AdminUser; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Disable {user.nickname}</h3>
        <label className="coord-field">
          <span>Reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Confirm disable
          </button>
        </div>
      </div>
    </div>
  );
}

export function SystemAdminPanel() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [disableTarget, setDisableTarget] = useState<AdminUser | null>(null);
  const [tempPasswordFor, setTempPasswordFor] = useState<{ userId: string; password: string } | null>(null);
  const [query, setQuery] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  // refresh()(挂载时+每次禁用/启用/重置密码后调用)和 30 秒轮询打的是同一个接口、互相之间没有
  // 任何先后顺序保证——亲测复现过:协调员点了 Disable,refresh() 很快把这行更新成 disabled,但
  // 紧接着一个更早发出、这时才姗姗来迟的轮询响应(里面还是禁用前的旧数据)落地，会把这行悄悄改回
  // active，协调员看到的账号状态跟数据库里的真实状态完全对不上。发起这两处请求前都领一个新序号，
  // 落地时只有序号还是当前最新的那个才允许真的写 state。
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const res = await api.fetchAdminUsers();
    if (requestId === latestRequestIdRef.current && res.code === 0) {
      setUsers(res.data);
      setSyncedAt(new Date());
    }
    if (requestId === latestRequestIdRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 别的协调员新增/禁用账号不会自己冒出来，静默轮询，不摸 loading。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      void api.fetchAdminUsers().then((res) => {
        if (requestId === latestRequestIdRef.current && res.code === 0) {
          setUsers(res.data);
          setSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const byRole = new Map<string, number>();
    let active = 0;
    for (const u of users) {
      byRole.set(u.role, (byRole.get(u.role) ?? 0) + 1);
      if (u.status === "active") active++;
    }
    return {
      total: users.length,
      active,
      disabled: users.length - active,
      byRole: [...byRole.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => [u.nickname, u.email, u.role, u.hotelName].some((f) => f?.toLowerCase().includes(q)));
  }, [users, query]);

  async function disable(reason: string) {
    if (!disableTarget) return;
    await api.disableUser(disableTarget.id, reason);
    setDisableTarget(null);
    await refresh();
  }

  async function enable(userId: string) {
    await api.enableUser(userId);
    await refresh();
  }

  async function resetPassword(userId: string) {
    const res = await api.resetUserPassword(userId);
    if (res.code === 0) setTempPasswordFor({ userId, password: res.data.temporaryPassword });
    await refresh();
  }

  const { paged, page, setPage, totalPages } = usePagination(filtered);

  if (loading && users.length === 0) {
    return (
      <p className="coord-empty">
        <span className="coord-search-spinner coord-loading-spinner-dark" aria-hidden="true" /> Loading…
      </p>
    );
  }

  return (
    <>
    <div className="coord-queue-stats">
      <div className="coord-stat-card">
        <span className="coord-stat-label">Total users</span>
        <span className="coord-stat-value">{stats.total}</span>
      </div>
      <div className="coord-stat-card">
        <span className="coord-stat-label">Active</span>
        <span className="coord-stat-value">{stats.active}</span>
      </div>
      <div className="coord-stat-card coord-stat-card-warn">
        <span className="coord-stat-label">Disabled</span>
        <span className="coord-stat-value">{stats.disabled}</span>
      </div>
      <div className="coord-stat-card coord-stat-card-wide coord-queue-reason-card">
        <span className="coord-stat-label">By role</span>
        <div className="coord-queue-reason-bars">
          {stats.byRole.map(([role, count]) => (
            <div key={role} className="coord-queue-reason-row">
              <span className="coord-queue-reason-label">{role}</span>
              <div className="coord-queue-reason-track">
                <div className="coord-queue-reason-fill" style={{ width: `${(count / stats.total) * 100}%` }} />
              </div>
              <span className="coord-queue-reason-count">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="coord-toolbar">
      <input
        className="coord-search-input"
        placeholder="Search by nickname / email / role / hotel"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      {syncedAt && (
        <p className="coord-sync-indicator coord-queue-sync">
          <span className="coord-sync-dot" aria-hidden="true" />
          Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
        </p>
      )}
    </div>

    <div className="coord-table">
      {paged.map((u) => (
        <div key={u.id} className="coord-row admin-user-row">
          <div className="coord-row-main">
            <div className="coord-row-title">
              <span className="coord-row-conf">{u.nickname}</span>
              <span className={`tag tag-status-${u.status === "active" ? "normal" : "overdue"}`}>{u.status}</span>
              {u.mustChangePassword && <span className="tag tag-status-warn">must change password</span>}
            </div>
            <p className="coord-row-sub">{u.email} · {u.role}</p>
            {tempPasswordFor?.userId === u.id && (
              <p className="escalation-refund-confirmed">Temporary password: {tempPasswordFor.password} (share with the user securely)</p>
            )}
            <div className="admin-user-details-wrap">
              <div className="admin-user-details">
                <p className="coord-row-meta">Phone: {u.phone || "—"}</p>
                <p className="coord-row-meta">Gender: {u.gender}</p>
                <p className="coord-row-meta">Language: {u.language}</p>
                <p className="coord-row-meta">Joined: {new Date(u.createdAt).toLocaleDateString()}</p>
                {u.hotelName && <p className="coord-row-meta">Hotel: {u.hotelName}</p>}
              </div>
            </div>
          </div>
          <div className="coord-row-actions admin-user-actions">
            {u.id === currentUser?.id ? (
              <span className="coord-row-meta">This is your account</span>
            ) : (
              <>
                {u.status === "active" ? (
                  <button type="button" className="coord-btn-link coord-btn-danger" onClick={() => setDisableTarget(u)}>
                    Disable
                  </button>
                ) : (
                  <button type="button" className="coord-btn-link" onClick={() => void enable(u.id)}>
                    Enable
                  </button>
                )}
                <button type="button" className="coord-btn-link" onClick={() => void resetPassword(u.id)}>
                  Reset password
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {disableTarget && (
        <DisableModal user={disableTarget} onCancel={() => setDisableTarget(null)} onConfirm={(r) => void disable(r)} />
      )}
    </div>
    <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </>
  );
}
