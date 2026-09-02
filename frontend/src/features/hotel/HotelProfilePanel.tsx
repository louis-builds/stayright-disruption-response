import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPicker } from "../auth/MapPicker";
import * as api from "./api";
import type { HotelPerk, HotelProfile, RoomType, UpsertHotelRefundPolicyRequest } from "./types";

const EMPTY_ROOM_TYPE = { name: "", description: "", amenities: [] as string[], capacity: 2, priceAmount: 0, currency: "NZD", imageUrls: [] as string[] };

/** 头像上传就是这么处理的(ProfilePage.tsx handleAvatarChange)：前端读成 base64 data URL 直接存进
 * 字段里，没有专门的文件上传接口/静态文件服务器。房型多角度图片沿用同一套，不用另起一套上传基建。 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function PhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="coord-modal-backdrop hotel-lightbox-backdrop" onClick={onClose}>
      <img src={url} alt="Room photo full size" className="hotel-lightbox-img" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="hotel-lightbox-close" onClick={onClose} aria-label="Close preview">
        ×
      </button>
    </div>
  );
}

interface PolicyRules {
  freeCancellationHours: number;
  cancellationFeePercent: number;
  cancellationFeeFixed: number;
  currency: string;
}

const DEFAULT_RULES: PolicyRules = {
  freeCancellationHours: 48,
  cancellationFeePercent: 10,
  cancellationFeeFixed: 0,
  currency: "NZD",
};

function parseRules(json?: string): PolicyRules {
  if (!json) return DEFAULT_RULES;
  try {
    const parsed = JSON.parse(json) as Partial<PolicyRules>;
    return {
      freeCancellationHours: Number(parsed.freeCancellationHours ?? DEFAULT_RULES.freeCancellationHours),
      cancellationFeePercent: Number(parsed.cancellationFeePercent ?? DEFAULT_RULES.cancellationFeePercent),
      cancellationFeeFixed: Number(parsed.cancellationFeeFixed ?? DEFAULT_RULES.cancellationFeeFixed),
      currency: parsed.currency || DEFAULT_RULES.currency,
    };
  } catch {
    return DEFAULT_RULES;
  }
}

function buildRules(rules: PolicyRules): string {
  return JSON.stringify(rules);
}

/** datetime-local 的 placeholder 会跟系统语言走（中文系统显示“年/月/日”），改成 text + placeholder 才能稳定英文。 */
function formatDateTimeForInput(iso?: string): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "";
}

function parseDateTimeInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) return null;
  if (isNaN(new Date(normalized).getTime())) return null;
  return normalized;
}

function RefundPolicySection() {
  const [content, setContent] = useState("");
  const [rules, setRules] = useState<PolicyRules>(DEFAULT_RULES);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [extractStatus, setExtractStatus] = useState<"idle" | "extracting" | "done" | "error">("idle");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    api
      .fetchRefundPolicy()
      .then((res) => {
        if (res.code === 0 && res.data) {
          setContent(res.data.content);
          setRules(parseRules(res.data.structuredRulesJson));
          setEffectiveFrom(formatDateTimeForInput(res.data.effectiveFrom));
          setEffectiveUntil(formatDateTimeForInput(res.data.effectiveUntil));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  function updateRules<K extends keyof PolicyRules>(key: K, value: PolicyRules[K]) {
    setRules((prev) => ({ ...prev, [key]: value }));
  }

  async function uploadFile(file: File) {
    const validExts = [".md", ".txt", ".pdf", ".docx"];
    if (!validExts.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setError("Only .pdf, .docx, .md and .txt files are supported.");
      return;
    }

    const parsedFrom = parseDateTimeInput(effectiveFrom);
    if (effectiveFrom.trim() && !parsedFrom) {
      setError("Effective from must be in YYYY-MM-DD HH:mm format.");
      return;
    }
    const parsedUntil = parseDateTimeInput(effectiveUntil);
    if (effectiveUntil.trim() && !parsedUntil) {
      setError("Effective until must be in YYYY-MM-DD HH:mm format.");
      return;
    }

    setSaving(true);
    setError(null);
    setExtractStatus("extracting");
    try {
      const res = await api.uploadRefundPolicyFile(file, {
        structuredRulesJson: buildRules(rules),
        effectiveFrom: parsedFrom || undefined,
        effectiveUntil: parsedUntil || undefined,
        isActive: true,
      });
      if (res.code === 0 && res.data) {
        setContent(res.data.content);
        setRules(parseRules(res.data.structuredRulesJson));
        setEffectiveFrom(formatDateTimeForInput(res.data.effectiveFrom));
        setEffectiveUntil(formatDateTimeForInput(res.data.effectiveUntil));
        setUploadedFileName(file.name);
        setExtractStatus("done");
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
      } else {
        setError(res.message || "Failed to upload policy file.");
        setExtractStatus("error");
      }
    } catch {
      setError("Failed to upload policy file.");
      setExtractStatus("error");
    } finally {
      setSaving(false);
    }
  }

  function handleFileChange(files: FileList | null) {
    if (!files || files.length === 0) return;
    void uploadFile(files[0]);
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadFile(e.dataTransfer.files[0]);
    }
  }

  async function save() {
    setError(null);
    setSuccess(false);

    const parsedFrom = parseDateTimeInput(effectiveFrom);
    if (effectiveFrom.trim() && !parsedFrom) {
      setError("Effective from must be in YYYY-MM-DD HH:mm format.");
      return;
    }
    const parsedUntil = parseDateTimeInput(effectiveUntil);
    if (effectiveUntil.trim() && !parsedUntil) {
      setError("Effective until must be in YYYY-MM-DD HH:mm format.");
      return;
    }

    const body: UpsertHotelRefundPolicyRequest = {
      content,
      structuredRulesJson: buildRules(rules),
      effectiveFrom: parsedFrom || undefined,
      effectiveUntil: parsedUntil || undefined,
      isActive: true,
    };

    setSaving(true);
    const res = await api.updateRefundPolicy(body);
    setSaving(false);

    if (res.code === 0) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } else {
      setError(res.message || "Failed to save policy.");
    }
  }

  if (loading) return <p className="coord-empty">Loading refund policy…</p>;

  return (
    <div className="hotel-profile-card">
      <div className="hotel-profile-card-header">
        <span className="hotel-profile-card-eyebrow">Policy</span>
        <h3>Cancellation & refund policy</h3>
        <p className="hotel-profile-card-caption">
          Upload your policy document or type it below. Guests will see this content when they view your policy.
        </p>
      </div>

      <div className="hotel-policy-upload-wrap">
        <label
          className={`hotel-policy-upload ${dragOver ? "hotel-policy-upload-dragover" : ""} ${extractStatus === "extracting" ? "hotel-policy-upload-busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input type="file" accept=".md,.txt,.pdf,.docx" onChange={(e) => handleFileChange(e.target.files)} disabled={saving} hidden />
          {extractStatus === "extracting" ? (
            <>
              <span className="hotel-policy-upload-icon">⧗</span>
              <span className="hotel-policy-upload-title">Reading your document…</span>
              <span className="hotel-policy-upload-hint">AI is extracting the text from {uploadedFileName ?? "the file"}.</span>
            </>
          ) : uploadedFileName && extractStatus === "done" ? (
            <>
              <span className="hotel-policy-upload-icon hotel-policy-upload-icon-success">✓</span>
              <span className="hotel-policy-upload-title">{uploadedFileName}</span>
              <span className="hotel-policy-upload-hint">AI has read your document. You can edit the text below or drop a new file to replace it.</span>
            </>
          ) : (
            <>
              <span className="hotel-policy-upload-icon">↑</span>
              <span className="hotel-policy-upload-title">Drop your policy file here, or click to browse</span>
              <span className="hotel-policy-upload-hint">Supports PDF, Word (.docx), Markdown and plain text. AI will read the file and fill in the form below.</span>
            </>
          )}
        </label>
      </div>

      <label className="coord-field">
        <span>Policy content (shown to guests)</span>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
      </label>

      <div className="hotel-profile-card-section">
        <h4>Automatic refund calculation</h4>
        <p className="hotel-profile-card-caption">
          These numbers control how the cancel/refund option amount is calculated. You can leave defaults if your policy content explains everything in plain text.
        </p>

        <div className="option-admin-fields">
          <label className="coord-field">
            <span>Free cancellation window (hours before check-in)</span>
            <input
              type="number"
              min={0}
              value={rules.freeCancellationHours}
              onChange={(e) => updateRules("freeCancellationHours", Number(e.target.value))}
            />
          </label>
          <label className="coord-field">
            <span>Cancellation fee (% of total)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={rules.cancellationFeePercent}
              onChange={(e) => updateRules("cancellationFeePercent", Number(e.target.value))}
            />
          </label>
        </div>

        <div className="option-admin-fields">
          <label className="coord-field">
            <span>Fixed cancellation fee ({rules.currency})</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rules.cancellationFeeFixed}
              onChange={(e) => updateRules("cancellationFeeFixed", Number(e.target.value))}
            />
          </label>
          <label className="coord-field">
            <span>Currency</span>
            <input value={rules.currency} onChange={(e) => updateRules("currency", e.target.value)} />
          </label>
        </div>
      </div>

      <div className="hotel-profile-card-section">
        <h4>Effective dates</h4>
        <p className="hotel-profile-card-caption">Use 24-hour English format: YYYY-MM-DD HH:mm, e.g. 2026-09-15 14:30.</p>
        <div className="option-admin-fields">
          <label className="coord-field">
            <span>Effective from</span>
            <input
              type="text"
              placeholder="YYYY-MM-DD HH:mm"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          <label className="coord-field">
            <span>Effective until</span>
            <input
              type="text"
              placeholder="YYYY-MM-DD HH:mm"
              value={effectiveUntil}
              onChange={(e) => setEffectiveUntil(e.target.value)}
            />
          </label>
        </div>
      </div>

      {error && <em className="register-field-error">{error}</em>}
      {success && <p className="escalation-refund-confirmed">Saved.</p>}

      <button type="button" className="coord-btn-primary hotel-policy-save" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save refund policy"}
      </button>
    </div>
  );
}

function RoomTypeCard({ roomType, onSave, onDelete }: {
  roomType: RoomType; onSave: (r: Omit<RoomType, "id">) => Promise<void>; onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(roomType.name);
  const [description, setDescription] = useState(roomType.description);
  const [capacity, setCapacity] = useState(String(roomType.capacity));
  const [price, setPrice] = useState(String(roomType.priceAmount));
  const [imageUrls, setImageUrls] = useState(roomType.imageUrls);
  const [amenities, setAmenities] = useState(roomType.amenities);
  const [amenityInput, setAmenityInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImageError(null);
    const oversized = [...files].some((f) => f.size > 2 * 1024 * 1024);
    if (oversized) {
      setImageError("Each photo must be under 2MB");
      return;
    }
    const urls = await Promise.all([...files].map(readAsDataUrl));
    setImageUrls((prev) => [...prev, ...urls]);
    setDirty(true);
  }

  function removePhoto(index: number) {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addAmenity() {
    const v = amenityInput.trim();
    if (!v || amenities.includes(v)) return;
    setAmenities((prev) => [...prev, v]);
    setAmenityInput("");
    setDirty(true);
  }

  function removeAmenity(v: string) {
    setAmenities((prev) => prev.filter((a) => a !== v));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    await onSave({
      name, description, amenities, capacity: Number(capacity) || 1,
      priceAmount: Number(price) || 0, currency: roomType.currency, imageUrls,
    });
    setSaving(false);
    setDirty(false);
  }

  async function remove() {
    setDeleting(true);
    await onDelete();
  }

  return (
    <div className="hotel-room-type-card">
      <label className="coord-field">
        <span>Name</span>
        <input value={name} onChange={(e) => markDirty(setName)(e.target.value)} />
      </label>
      <label className="coord-field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => markDirty(setDescription)(e.target.value)} rows={2} />
      </label>
      <div className="option-admin-fields">
        <label className="coord-field">
          <span>Capacity</span>
          <input value={capacity} onChange={(e) => markDirty(setCapacity)(e.target.value)} type="number" />
        </label>
        <label className="coord-field">
          <span>Price ({roomType.currency} / night)</span>
          <input value={price} onChange={(e) => markDirty(setPrice)(e.target.value)} type="number" step="0.01" />
        </label>
      </div>
      <div className="coord-field">
        <span>Amenities ({amenities.length})</span>
        {amenities.length > 0 && (
          <div className="hotel-amenity-chips">
            {amenities.map((a) => (
              <span key={a} className="hotel-amenity-chip">
                {a.replace(/_/g, " ")}
                <button type="button" onClick={() => removeAmenity(a)} aria-label={`Remove ${a}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="hotel-perk-add">
          <input
            className="coord-search-input"
            placeholder="e.g. wifi, lake_view"
            value={amenityInput}
            onChange={(e) => setAmenityInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAmenity();
              }
            }}
          />
          <button type="button" className="hotel-btn-secondary" onClick={addAmenity}>
            + Add
          </button>
        </div>
      </div>
      <div className="coord-field">
        <span>Photos ({imageUrls.length})</span>
        {imageUrls.length > 0 ? (
          <div className="room-type-photo-grid">
            {imageUrls.map((url, i) => (
              <div key={i} className="room-type-photo-thumb">
                <img
                  src={url}
                  alt={`${name || "Room"} photo ${i + 1}`}
                  onClick={() => setPreviewUrl(url)}
                  style={{ cursor: "zoom-in" }}
                />
                <button type="button" className="room-type-photo-remove" onClick={() => removePhoto(i)} aria-label="Remove photo">
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="hotel-room-type-empty-photos">No photos yet — guests see a placeholder until you add some.</p>
        )}
        <label className="hotel-room-photo-upload">
          + Add photos (multiple angles)
          <input type="file" accept="image/*" multiple onChange={(e) => void addPhotos(e.target.files)} hidden />
        </label>
        {imageError && <em className="register-field-error">{imageError}</em>}
      </div>
      <div className="hotel-room-type-actions">
        <button type="button" className="hotel-btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save room type"}
        </button>
        <button type="button" className="hotel-btn-danger" disabled={deleting} onClick={() => void remove()}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
      {previewUrl && <PhotoLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}

/** 权益目录：中断发生后，可以挂到"原房延期"这类方案上(免费早餐/饮品)，或者用来配一个全新的自定义
 * 方案(比如免费升房)——具体挂哪个方案是在酒店工作台的待办列表里做的，这里只管维护这份可选名单。 */
function PerksSection({ perks, onAdd, onDelete }: {
  perks: HotelPerk[]; onAdd: (name: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = query.trim()
    ? perks.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : perks;

  async function submit() {
    if (!name.trim()) return;
    setAdding(true);
    await onAdd(name.trim());
    setAdding(false);
    setName("");
  }

  async function remove(id: string) {
    setBusyId(id);
    await onDelete(id);
    setBusyId(null);
  }

  return (
    <div className="hotel-profile-card">
      <div className="hotel-profile-card-header">
        <span className="hotel-profile-card-eyebrow">Perks</span>
        <h3>Perks catalog</h3>
        <p className="hotel-profile-card-caption">
          Extras you can offer guests when a disruption hits — free breakfast, drinks, a room upgrade.
        </p>
      </div>
      {perks.length === 0 ? (
        <p className="coord-empty">No perks yet — add your first one below so it's ready to attach to a rebooking option.</p>
      ) : (
        <>
          {perks.length > 6 && (
            <input
              className="coord-search-input hotel-perks-search"
              placeholder="Search perks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <ul className="hotel-perks-list">
            {visible.map((p) => (
              <li key={p.id}>
                <span>{p.name}</span>
                <button
                  type="button"
                  className="hotel-btn-danger"
                  disabled={busyId === p.id}
                  onClick={() => void remove(p.id)}
                >
                  {busyId === p.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="hotel-perk-add">
        <input
          className="coord-search-input"
          placeholder="e.g. Free breakfast"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button type="button" className="hotel-btn-secondary" disabled={adding} onClick={() => void submit()}>
          {adding ? "Adding…" : "+ Add perk"}
        </button>
      </div>
    </div>
  );
}

function RoomTypeSummaryCard({ roomType, onClick }: { roomType: RoomType; onClick: () => void }) {
  const firstPhoto = roomType.imageUrls[0];
  return (
    <button type="button" className="hotel-room-type-summary" onClick={onClick}>
      <div className="hotel-room-type-summary-photo">
        {firstPhoto ? (
          <img src={firstPhoto} alt={roomType.name} />
        ) : (
          <span className="hotel-room-type-summary-placeholder">No photo</span>
        )}
      </div>
      <div className="hotel-room-type-summary-body">
        <span className="hotel-room-type-summary-name">{roomType.name || "Unnamed room"}</span>
        <span className="hotel-room-type-summary-price">
          {roomType.currency} {roomType.priceAmount}
          <span className="hotel-room-type-summary-unit">/ night</span>
        </span>
        <span className="hotel-room-type-summary-capacity">{roomType.capacity} guests</span>
      </div>
    </button>
  );
}

type ProfileTab = "profile" | "hotel" | "rooms" | "policy" | "perks";

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "hotel", label: "Hotel details" },
  { key: "rooms", label: "Room types" },
  { key: "policy", label: "Refund policy" },
  { key: "perks", label: "Perks" },
];

type HotelStats = {
  roomTypeCount: number;
  priceMin: number;
  priceMax: number;
  currency: string;
  capacityMin: number;
  capacityMax: number;
  totalPhotos: number;
  perkCount: number;
} | null;

function HotelProfileOverview({
  profile,
  name,
  address,
  lat,
  lng,
  imageUrls,
  primaryImageIndex,
  stats,
  onEdit,
  onEditRooms,
  onEditPerks,
}: {
  profile: HotelProfile;
  name: string;
  address: string;
  lat: number;
  lng: number;
  imageUrls: string[];
  primaryImageIndex: number;
  stats: HotelStats;
  onEdit: () => void;
  onEditRooms: () => void;
  onEditPerks: () => void;
}) {
  const displayedRooms = profile.roomTypes.slice(0, 3);
  const moreRooms = profile.roomTypes.length > 3 ? profile.roomTypes.length - 3 : 0;
  const primaryImage = imageUrls[primaryImageIndex] ?? imageUrls[0];

  return (
    <div className="hotel-profile-overview">
      <div className="hotel-profile-hero">
        <div className="hotel-profile-hero-main">
          <div className="hotel-profile-hero-avatar">
            {primaryImage ? (
              <img src={primaryImage} alt={profile.name} />
            ) : (
              <span>{profile.name.charAt(0) || "H"}</span>
            )}
          </div>
          <div className="hotel-profile-hero-body">
            <h3>{name || "Unnamed hotel"}</h3>
            <p>{address || "No address set"}</p>
            <div className="hotel-profile-hero-meta">
              <span>Lat: {lat.toFixed(4)}</span>
              <span>Lng: {lng.toFixed(4)}</span>
            </div>
          </div>
        </div>
        <button type="button" className="hotel-btn-secondary" onClick={onEdit}>
          Edit hotel details
        </button>
      </div>

      <div className="hotel-profile-quick-stats">
        <div className="hotel-quick-stat" onClick={onEditRooms} role="button" tabIndex={0}>
          <span className="hotel-quick-stat-value">{profile.roomTypes.length}</span>
          <span className="hotel-quick-stat-label">Room types</span>
        </div>
        <div className="hotel-quick-stat" onClick={onEditPerks} role="button" tabIndex={0}>
          <span className="hotel-quick-stat-value">{profile.perks.length}</span>
          <span className="hotel-quick-stat-label">Perks</span>
        </div>
        <div className="hotel-quick-stat" onClick={onEditRooms} role="button" tabIndex={0}>
          <span className="hotel-quick-stat-value">{stats ? `${stats.currency} ${stats.priceMin}` : "—"}</span>
          <span className="hotel-quick-stat-label">From / night</span>
        </div>
      </div>

      <div className="hotel-profile-card">
        <div className="hotel-profile-card-header">
          <span className="hotel-profile-card-eyebrow">Rooms</span>
          <h3>Room types</h3>
        </div>
        {displayedRooms.length === 0 ? (
          <p className="coord-empty">No room types yet — add rooms so guests can book.</p>
        ) : (
          <div className="hotel-room-type-grid hotel-room-type-grid-compact">
            {displayedRooms.map((r) => (
              <RoomTypeSummaryCard key={r.id} roomType={r} onClick={onEditRooms} />
            ))}
            {moreRooms > 0 && (
              <button type="button" className="hotel-room-type-more" onClick={onEditRooms}>
                <span>+{moreRooms}</span>
                <span>View all</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="hotel-profile-card">
        <div className="hotel-profile-card-header">
          <span className="hotel-profile-card-eyebrow">Perks</span>
          <h3>Perks catalog</h3>
        </div>
        {profile.perks.length === 0 ? (
          <p className="coord-empty">No perks yet — add perks to offer during disruptions.</p>
        ) : (
          <div className="hotel-profile-perk-chips">
            {profile.perks.slice(0, 8).map((p) => (
              <span key={p.id} className="hotel-profile-perk-chip">{p.name}</span>
            ))}
            {profile.perks.length > 8 && (
              <button type="button" className="hotel-profile-perk-chip-more" onClick={onEditPerks}>
                +{profile.perks.length - 8} more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HotelProfileTabs({ active, onSelect }: { active: ProfileTab; onSelect: (t: ProfileTab) => void }) {
  return (
    <div className="hotel-profile-tabs">
      {PROFILE_TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`hotel-profile-tab ${active === t.key ? "hotel-profile-tab-active" : ""}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function HotelProfilePanel() {
  const [profile, setProfile] = useState<HotelProfile | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [addingRoomType, setAddingRoomType] = useState(false);
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>("profile");

  const refresh = useCallback(async () => {
    const res = await api.fetchProfile();
    if (res.code === 0) {
      setProfile(res.data);
      setName(res.data.name);
      setAddress(res.data.address);
      setLat(res.data.lat);
      setLng(res.data.lng);
      setImageUrls(res.data.imageUrls);
      setPrimaryImageIndex(res.data.primaryImageIndex);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (editingRoomTypeId && !profile?.roomTypes.some((r) => r.id === editingRoomTypeId)) {
      setEditingRoomTypeId(null);
    }
  }, [editingRoomTypeId, profile]);

  async function saveProfile() {
    setSaving(true);
    await api.updateProfile(name, address, lat, lng, imageUrls, primaryImageIndex);
    setSaving(false);
    setSaved(true);
    await refresh();
  }

  async function handleHotelImageChange(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newImages: string[] = [];
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 2 * 1024 * 1024) continue;
      const dataUrl = await readAsDataUrl(file);
      newImages.push(dataUrl);
    }
    if (newImages.length === 0) return;
    setImageUrls((prev) => [...prev, ...newImages]);
  }

  function removeHotelImage(index: number) {
    setImageUrls((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (primaryImageIndex >= next.length && next.length > 0) {
        setPrimaryImageIndex(0);
      }
      return next;
    });
  }

  async function saveRoomType(id: string, r: Omit<RoomType, "id">) {
    await api.updateRoomType(id, r);
    await refresh();
  }

  async function deleteRoomType(id: string) {
    await api.deleteRoomType(id);
    await refresh();
  }

  async function addRoomType() {
    setAddingRoomType(true);
    const res = await api.addRoomType(EMPTY_ROOM_TYPE);
    setAddingRoomType(false);
    await refresh();
    if (res.code === 0) {
      setEditingRoomTypeId(res.data.id);
      setTab("rooms");
    }
  }

  async function addPerk(name: string) {
    await api.addPerk(name);
    await refresh();
  }

  async function deletePerk(id: string) {
    await api.deletePerk(id);
    await refresh();
  }

  const stats = useMemo(() => {
    if (!profile || profile.roomTypes.length === 0) return null;
    const prices = profile.roomTypes.map((r) => r.priceAmount);
    const capacities = profile.roomTypes.map((r) => r.capacity);
    const totalPhotos = profile.roomTypes.reduce((sum, r) => sum + r.imageUrls.length, 0);
    return {
      roomTypeCount: profile.roomTypes.length,
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      currency: profile.roomTypes[0].currency,
      capacityMin: Math.min(...capacities),
      capacityMax: Math.max(...capacities),
      totalPhotos,
      perkCount: profile.perks.length,
    };
  }, [profile]);

  if (!profile) return <p className="coord-empty">Loading…</p>;

  return (
    <div className="hotel-profile-panel">
      <div className="hotel-profile-panel-header">
        <div>
          <span className="hotel-profile-panel-eyebrow">Hotel profile</span>
          <h2>Manage your hotel</h2>
        </div>
        <p className="hotel-profile-panel-subtitle">
          Your hotel at a glance. Edit details, rooms, refund policy and perks from the tabs below.
        </p>
      </div>

      <HotelProfileTabs active={tab} onSelect={setTab} />

      <div className="hotel-profile-panel-body">
        {tab === "profile" && (
          <HotelProfileOverview
            profile={profile}
            name={name}
            address={address}
            lat={lat}
            lng={lng}
            imageUrls={imageUrls}
            primaryImageIndex={primaryImageIndex}
            stats={stats}
            onEdit={() => setTab("hotel")}
            onEditRooms={() => setTab("rooms")}
            onEditPerks={() => setTab("perks")}
          />
        )}

        {tab === "hotel" && (
          <div className="hotel-profile-card">
            <div className="hotel-profile-card-header">
              <span className="hotel-profile-card-eyebrow">Hotel</span>
              <h3>Hotel details</h3>
              <p className="hotel-profile-card-caption">
                Update your hotel name, address and location. The location pin is used to match disruptions near your property.
              </p>
            </div>
            <div className="hotel-details-form">
              <div className="hotel-details-fields">
                <div className="hotel-details-image">
                  <span className="hotel-details-image-label">Hotel photos</span>
                  <p className="hotel-details-image-hint">
                    Upload multiple photos. Click "Set as profile photo" to choose which one appears as the hotel avatar.
                  </p>

                  {imageUrls.length > 0 && (
                    <div className="hotel-details-image-grid">
                      {imageUrls.map((url, index) => (
                        <div
                          key={`${url}-${index}`}
                          className={`hotel-details-image-thumb ${index === primaryImageIndex ? "hotel-details-image-thumb-primary" : ""}`}
                        >
                          <img src={url} alt={`Hotel photo ${index + 1}`} />
                          {index === primaryImageIndex && (
                            <span className="hotel-details-image-primary-badge">Profile photo</span>
                          )}
                          <div className="hotel-details-image-thumb-actions">
                            {index !== primaryImageIndex && (
                              <button
                                type="button"
                                className="hotel-btn-secondary"
                                onClick={() => setPrimaryImageIndex(index)}
                              >
                                Set as profile
                              </button>
                            )}
                            <button
                              type="button"
                              className="hotel-btn-danger"
                              onClick={() => removeHotelImage(index)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className="hotel-details-image-upload">
                    <span>+ Upload photos</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => void handleHotelImageChange(e.target.files)}
                      hidden
                    />
                  </label>
                </div>

                <label className="coord-field">
                  <span>Hotel name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Queenstown Lakeview Hotel" />
                </label>
                <label className="coord-field">
                  <span>Address</span>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 1 Lake Esplanade, Queenstown" />
                </label>
                <div className="hotel-details-coords">
                  <label className="coord-field">
                    <span>Latitude</span>
                    <input value={lat} onChange={(e) => setLat(Number(e.target.value))} type="number" step="any" />
                  </label>
                  <label className="coord-field">
                    <span>Longitude</span>
                    <input value={lng} onChange={(e) => setLng(Number(e.target.value))} type="number" step="any" />
                  </label>
                </div>
              </div>
              <div className="hotel-details-map">
                <span className="hotel-details-map-label">Location</span>
                <MapPicker
                  lat={lat}
                  lng={lng}
                  onPick={(newLat, newLng, newAddress) => {
                    setLat(newLat);
                    setLng(newLng);
                    if (newAddress) setAddress(newAddress);
                  }}
                />
                <p className="hotel-details-map-hint">Click the map or drag the marker to update coordinates.</p>
              </div>
            </div>
            <div className="hotel-details-actions">
              <button type="button" className="hotel-btn-primary" disabled={saving} onClick={() => void saveProfile()}>
                {saving ? "Saving…" : "Save hotel details"}
              </button>
              {saved && <span className="hotel-details-saved">Saved successfully</span>}
            </div>
          </div>
        )}

        {tab === "rooms" && (
          <div className="hotel-profile-card">
            <div className="hotel-profile-card-header">
              <span className="hotel-profile-card-eyebrow">Rooms</span>
              <h3>Room types</h3>
            </div>
            {editingRoomTypeId ? (
              <div className="hotel-room-type-editor">
                <div className="hotel-room-type-editor-header">
                  <button
                    type="button"
                    className="hotel-room-type-editor-back"
                    onClick={() => setEditingRoomTypeId(null)}
                  >
                    ← Back to room types
                  </button>
                </div>
                {(() => {
                  const roomType = profile.roomTypes.find((r) => r.id === editingRoomTypeId);
                  if (!roomType) return null;
                  return (
                    <RoomTypeCard
                      roomType={roomType}
                      onSave={(v) => saveRoomType(roomType.id, v)}
                      onDelete={() => deleteRoomType(roomType.id)}
                    />
                  );
                })()}
              </div>
            ) : profile.roomTypes.length === 0 ? (
              <p className="coord-empty">No room types yet — add one so guests have something to book.</p>
            ) : (
              <div className="hotel-room-type-grid">
                {profile.roomTypes.map((r) => (
                  <RoomTypeSummaryCard key={r.id} roomType={r} onClick={() => setEditingRoomTypeId(r.id)} />
                ))}
              </div>
            )}
            {!editingRoomTypeId && (
              <button
                type="button"
                className="hotel-btn-secondary"
                disabled={addingRoomType}
                onClick={() => void addRoomType()}
              >
                {addingRoomType ? "Adding…" : "+ Add room type"}
              </button>
            )}
          </div>
        )}

        {tab === "policy" && <RefundPolicySection />}

        {tab === "perks" && <PerksSection perks={profile.perks} onAdd={addPerk} onDelete={deletePerk} />}
      </div>
    </div>
  );
}
