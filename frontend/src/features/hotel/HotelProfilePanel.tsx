import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPicker } from "../auth/MapPicker";
import * as api from "./api";
import type { HotelPerk, HotelProfile, RoomType } from "./types";

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
        <div className="coord-toolbar hotel-amenity-add">
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
          <button type="button" className="coord-btn-secondary" onClick={addAmenity}>
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
      <div className="option-admin-actions">
        <button type="button" className="coord-btn-secondary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="coord-btn-link coord-btn-danger" disabled={deleting} onClick={() => void remove()}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
      {previewUrl && <PhotoLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </div>
  );
}

/** 权益目录：中断发生后，可以挂到"原房延期"这类方案上(免费早餐/饮品)，或者用来配一个全新的自定义
 * 方案(比如免费升房)——具体挂哪个方案是在酒店工作台的 H1/H2 待办里做的，这里只管维护这份可选名单。 */
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
    <div className="escalation-section hotel-perks-section">
      <h3>Perks</h3>
      <p className="hotel-perks-hint">
        Extras you can offer guests when a disruption hits — free breakfast, drinks, a room upgrade. Attach them to a
        rebooking option or offer a brand-new custom option from the case's to-do row.
      </p>
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
                  className="coord-btn-link coord-btn-danger"
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
      <div className="coord-toolbar">
        <input
          className="coord-search-input"
          placeholder="e.g. Free breakfast"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button type="button" className="coord-btn-secondary" disabled={adding} onClick={() => void submit()}>
          {adding ? "Adding…" : "+ Add perk"}
        </button>
      </div>
    </div>
  );
}

export function HotelProfilePanel() {
  const [profile, setProfile] = useState<HotelProfile | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [addingRoomType, setAddingRoomType] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api.fetchProfile();
    if (res.code === 0) {
      setProfile(res.data);
      setName(res.data.name);
      setAddress(res.data.address);
      setLat(res.data.lat);
      setLng(res.data.lng);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveProfile() {
    setSaving(true);
    await api.updateProfile(name, address, lat, lng);
    setSaving(false);
    setSaved(true);
    await refresh();
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
    await api.addRoomType(EMPTY_ROOM_TYPE);
    setAddingRoomType(false);
    await refresh();
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
    <div className="hotel-profile-grid">
      <div className="hotel-profile-col">
        <div className="escalation-section">
          <h3>Hotel details</h3>
          <label className="coord-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="coord-field">
            <span>Address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <MapPicker
            lat={lat}
            lng={lng}
            onPick={(newLat, newLng, newAddress) => {
              setLat(newLat);
              setLng(newLng);
              if (newAddress) setAddress(newAddress);
            }}
          />
          <button type="button" className="coord-btn-primary" disabled={saving} onClick={() => void saveProfile()}>
            {saving ? "Saving…" : "Save hotel details"}
          </button>
          {saved && <p className="escalation-refund-confirmed">Saved.</p>}
        </div>

        <PerksSection perks={profile.perks} onAdd={addPerk} onDelete={deletePerk} />

        {stats && (
          <div className="escalation-section">
            <h3>Profile snapshot</h3>
            <div className="coord-queue-stats hotel-profile-stats">
              <div className="coord-stat-card">
                <span className="coord-stat-label">Room types</span>
                <span className="coord-stat-value">{stats.roomTypeCount}</span>
                <span className="coord-stat-sub">{stats.totalPhotos} photos total</span>
              </div>
              <div className="coord-stat-card">
                <span className="coord-stat-label">Price range</span>
                <span className="coord-stat-value coord-stat-value-sm">
                  {stats.currency} {stats.priceMin}–{stats.priceMax}
                </span>
                <span className="coord-stat-sub">per night</span>
              </div>
              <div className="coord-stat-card">
                <span className="coord-stat-label">Capacity range</span>
                <span className="coord-stat-value coord-stat-value-sm">
                  {stats.capacityMin}–{stats.capacityMax} guests
                </span>
                <span className="coord-stat-sub">{stats.perkCount} perks in catalog</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="escalation-section">
        <h3>Room types</h3>
        {profile.roomTypes.length === 0 ? (
          <p className="coord-empty">No room types yet — add one so guests have something to book.</p>
        ) : (
          profile.roomTypes.map((r) => (
            <RoomTypeCard
              key={r.id}
              roomType={r}
              onSave={(v) => saveRoomType(r.id, v)}
              onDelete={() => deleteRoomType(r.id)}
            />
          ))
        )}
        <button type="button" className="coord-btn-secondary" disabled={addingRoomType} onClick={() => void addRoomType()}>
          {addingRoomType ? "Adding…" : "+ Add room type"}
        </button>
      </div>
    </div>
  );
}
