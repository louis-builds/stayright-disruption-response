import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { pickImageAsDataUrl } from "../../shared/media/pickImageAsDataUrl";
import { useNetworkStatus } from "../../shared/network/useNetworkStatus";
import { confirmAsync, showAlert } from "../../shared/platformAlert";
import { theme } from "../../shared/theme";
import { useMinLoadingDuration } from "../../shared/useMinLoadingDuration";
import { PerksSection } from "./PerksSection";
import { PolicySection } from "./PolicySection";
import type { RoomType } from "./types";
import { useHotelProfile } from "./useHotelProfile";

type Tab = "overview" | "details" | "rooms" | "policy" | "perks";

function PhotoGrid({ urls, primaryIndex, onSetPrimary, onRemove }: {
  urls: string[];
  primaryIndex?: number;
  onSetPrimary?: (i: number) => void;
  onRemove: (i: number) => void;
}) {
  if (urls.length === 0) return <Text style={styles.emptyHint}>No photos yet.</Text>;
  return (
    <View style={styles.photoGrid}>
      {urls.map((url, i) => (
        <View key={`${url.slice(0, 24)}-${i}`} style={styles.photoThumbWrap}>
          <Image source={{ uri: url }} style={[styles.photoThumb, i === primaryIndex && styles.photoThumbPrimary]} />
          {i === primaryIndex && (
            <View style={styles.primaryBadge}>
              <Text style={styles.primaryBadgeText}>Profile photo</Text>
            </View>
          )}
          <View style={styles.photoThumbActions}>
            {onSetPrimary && i !== primaryIndex && (
              <Pressable style={({ pressed }) => [styles.photoActionButton, pressed && styles.buttonPressed]} onPress={() => onSetPrimary(i)}>
                <Text style={styles.photoActionButtonText}>Set as profile</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.photoActionButton, styles.photoActionButtonDanger, pressed && styles.buttonPressed]}
              onPress={() => onRemove(i)}
            >
              <Text style={styles.photoActionButtonDangerText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function AddPhotoButton({ onAdd }: { onAdd: (dataUrl: string) => void }) {
  const [busy, setBusy] = useState(false);

  async function handlePress() {
    setBusy(true);
    try {
      const result = await pickImageAsDataUrl();
      if ("cancelled" in result) return;
      if (!result.ok) {
        showAlert("Couldn't add photo", result.error);
        return;
      }
      onAdd(result.dataUrl);
    } catch {
      showAlert("Couldn't add photo", "Something went wrong while picking the photo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.addPhotoButton, pressed && styles.buttonPressed]}
      disabled={busy}
      onPress={() => void handlePress()}
    >
      {busy ? <ActivityIndicator size="small" color={theme.accent} /> : <Text style={styles.addPhotoButtonText}>+ Add photo</Text>}
    </Pressable>
  );
}

function CoordinateField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // 直接 Number(v)||0 会在只打了个 "-" 时把值弹回 "0"，导致负纬度(新西兰所有酒店都是负纬度)
  // 没法逐字符手打——本地存原始字符串，只在能解析出有限数字时才回写上层。
  const [text, setText] = useState(String(value));
  return (
    <TextInput
      style={styles.input}
      value={text}
      onChangeText={(v) => {
        setText(v);
        const n = Number(v);
        if (v.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      keyboardType="numbers-and-punctuation"
    />
  );
}

function AmenityChips({ amenities, onRemove }: { amenities: string[]; onRemove: (a: string) => void }) {
  if (amenities.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {amenities.map((a) => (
        <View key={a} style={styles.chip}>
          <Text style={styles.chipText}>{a.replace(/_/g, " ")}</Text>
          <Pressable onPress={() => onRemove(a)} hitSlop={8} style={({ pressed }) => [pressed && styles.buttonPressed]}>
            <Text style={styles.chipRemove}>×</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function RoomTypeSummaryCard({ roomType, onPress, compact }: { roomType: RoomType; onPress: () => void; compact?: boolean }) {
  const firstPhoto = roomType.imageUrls[0];
  return (
    <Pressable style={({ pressed }) => [styles.summaryCard, pressed && styles.buttonPressed]} onPress={onPress}>
      {firstPhoto ? (
        <Image source={{ uri: firstPhoto }} style={styles.summaryPhoto} />
      ) : (
        <View style={[styles.summaryPhoto, styles.summaryPhotoPlaceholder]}>
          <Text style={styles.emptyHint}>No photo</Text>
        </View>
      )}
      <Text style={styles.summaryName} numberOfLines={1}>{roomType.name || "Unnamed room"}</Text>
      <Text style={styles.summaryPrice}>
        {roomType.currency} {roomType.priceAmount} <Text style={styles.summaryUnit}>/ night</Text>
      </Text>
      <Text style={styles.summaryCapacity}>{roomType.capacity} guests</Text>
      {/* Overview 只是"瞟一眼"用的预览网格,详情一点就到 Room types tab——描述/设施只在
          真正管理列表(Room types tab)展开,避免 Overview 卡片跟着变厚重复信息。 */}
      {!compact && (
        <>
          {roomType.description ? (
            <Text style={styles.summaryDescription} numberOfLines={2}>{roomType.description}</Text>
          ) : null}
          {roomType.amenities.length > 0 && (
            <View style={styles.summaryAmenityRow}>
              {roomType.amenities.slice(0, 3).map((a) => (
                <View key={a} style={styles.summaryAmenityChip}>
                  <Text style={styles.summaryAmenityText}>{a.replace(/_/g, " ")}</Text>
                </View>
              ))}
              {roomType.amenities.length > 3 && <Text style={styles.summaryAmenityMore}>+{roomType.amenities.length - 3}</Text>}
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

function RoomTypeEditor({ roomType, onSave, onDelete, onBack, isOnline }: {
  roomType: RoomType;
  onSave: (r: Omit<RoomType, "id">) => Promise<void>;
  onDelete: () => Promise<void>;
  onBack: () => void;
  isOnline: boolean;
}) {
  const [name, setName] = useState(roomType.name);
  const [description, setDescription] = useState(roomType.description);
  const [capacity, setCapacity] = useState(String(roomType.capacity));
  const [price, setPrice] = useState(String(roomType.priceAmount));
  const [imageUrls, setImageUrls] = useState(roomType.imageUrls);
  const [amenities, setAmenities] = useState(roomType.amenities);
  const [amenityInput, setAmenityInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function addAmenity() {
    const v = amenityInput.trim();
    if (!v || amenities.includes(v)) return;
    setAmenities((prev) => [...prev, v]);
    setAmenityInput("");
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({ name, description, amenities, capacity: Number(capacity) || 1, priceAmount: Number(price) || 0, currency: roomType.currency, imageUrls });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Pressable
        onPress={async () => {
          if (dirty && !(await confirmAsync("Discard changes?", "Unsaved changes to this room type will be lost."))) return;
          onBack();
        }}
        hitSlop={8}
        style={({ pressed }) => [pressed && styles.buttonPressed]}
      >
        <Text style={styles.backLink}>← Back to room types</Text>
      </Pressable>

      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={(v) => { setName(v); setDirty(true); }} />

      <Text style={styles.fieldLabel}>Description</Text>
      <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={(v) => { setDescription(v); setDirty(true); }} multiline />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Capacity</Text>
          <TextInput style={styles.input} value={capacity} onChangeText={(v) => { setCapacity(v); setDirty(true); }} keyboardType="number-pad" />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.fieldLabel}>Price ({roomType.currency} / night)</Text>
          <TextInput style={styles.input} value={price} onChangeText={(v) => { setPrice(v); setDirty(true); }} keyboardType="decimal-pad" />
        </View>
      </View>

      <Text style={styles.fieldLabel}>Amenities ({amenities.length})</Text>
      <AmenityChips amenities={amenities} onRemove={(a) => { setAmenities((prev) => prev.filter((x) => x !== a)); setDirty(true); }} />
      <View style={styles.addRow}>
        <TextInput style={[styles.input, styles.addRowInput]} value={amenityInput} onChangeText={setAmenityInput} placeholder="e.g. wifi, lake_view" onSubmitEditing={addAmenity} />
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={addAmenity}>
          <Text style={styles.secondaryButtonText}>+ Add</Text>
        </Pressable>
      </View>

      <Text style={styles.fieldLabel}>Photos ({imageUrls.length})</Text>
      {/* 房型卡片(RoomTypeSummaryCard)固定用 imageUrls[0] 当封面,不像酒店详情那样有独立的
          "设为封面"概念——这里不传 primaryIndex/onSetPrimary 是故意的,不是漏加。 */}
      <PhotoGrid urls={imageUrls} onRemove={(i) => { setImageUrls((prev) => prev.filter((_, idx) => idx !== i)); setDirty(true); }} />
      <AddPhotoButton onAdd={(dataUrl) => { setImageUrls((prev) => [...prev, dataUrl]); setDirty(true); }} />

      {!isOnline && <Text style={styles.offlineHint}>You&apos;re offline — reconnect to save or delete</Text>}
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, (!dirty || !isOnline) && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={!dirty || saving || !isOnline}
          onPress={() => void save()}
        >
          <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save room type"}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.dangerButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
          disabled={deleting || !isOnline}
          onPress={async () => {
            const confirmed = await confirmAsync("Delete room type", `Remove "${roomType.name || "this room type"}"? This can't be undone.`);
            if (!confirmed) return;
            setDeleting(true);
            try {
              await onDelete();
            } catch {
              setDeleting(false);
            }
          }}
        >
          <Text style={styles.dangerButtonText}>{deleting ? "Deleting…" : "Delete"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ProfileScreen() {
  const profileState = useHotelProfile();
  const isOnline = useNetworkStatus();
  const showLoading = useMinLoadingDuration(profileState.loading);
  const [tab, setTab] = useState<Tab>("overview");
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);

  // 每次切 tab 都是这个页面最主要的"页面变化"，给内容一个轻淡入而不是硬切；
  // 只依赖 tab，不依赖会因轮询/保存而变的数据，避免刷新时被误触发重播。
  const tabFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showLoading) return;
    tabFade.setValue(0);
    Animated.timing(tabFade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [tab, showLoading, tabFade]);

  if (showLoading || !profileState.profile) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const { profile } = profileState;
  const primaryImage = profileState.imageUrls[profileState.primaryImageIndex] ?? profileState.imageUrls[0];
  const editingRoomType = editingRoomTypeId ? profile.roomTypes.find((r) => r.id === editingRoomTypeId) : null;

  return (
    <LinearGradient colors={[theme.background, theme.accentSoft, theme.background]} locations={[0, 0.55, 1]} style={styles.screen}>
      <View style={styles.tabsWrap}>
        <View style={styles.tabs}>
          {(["overview", "details", "rooms", "policy", "perks"] as Tab[]).map((t) => (
            <Pressable
              key={t}
              accessibilityRole="tab"
              aria-selected={tab === t}
              style={({ pressed }) => [styles.tabButton, tab === t && styles.tabButtonActive, pressed && tab !== t && styles.tabButtonPressed]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabButtonText, tab === t && styles.tabButtonTextActive]} numberOfLines={1} adjustsFontSizeToFit>
                {t === "overview"
                  ? "Overview"
                  : t === "details"
                    ? "Details"
                    : t === "rooms"
                      ? "Rooms"
                      : t === "policy"
                        ? "Policy"
                        : "Perks"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Animated.ScrollView
        style={{ opacity: tabFade }}
        contentContainerStyle={[
          styles.scrollContent,
          tab === "perks" && profile.perks.length === 0 && styles.scrollContentCentered,
          // 真实种子数据显示每家酒店房型只有2条(见 room_types 表)——2列网格放1-3条时下方会空出
          // 大半屏,跟 Perks 目录为空时同一个道理,居中而不是硬堆在顶部。<=3 不是随便定的：
          // 2列网格奇数条(1或3)最后一行都会落单,凑不满一整行才最容易显得空;4条正好两整行，
          // 已经不需要居中兜底了。超过3条以后如果又出现单数落单(比如5条)，这条判断不会再生效，
          // 到时候再按实际空白率重新量一次，不要凭感觉改这个数字。
          tab === "rooms" && !editingRoomType && profile.roomTypes.length > 0 && profile.roomTypes.length <= 3 && styles.scrollContentCentered,
        ]}
      >
        {tab === "overview" && (
          <View style={styles.card}>
            <View style={styles.heroRow}>
              <View style={styles.heroAvatar}>
                {primaryImage ? <Image source={{ uri: primaryImage }} style={styles.heroAvatarImage} /> : <Text style={styles.heroAvatarLetter}>{profile.name.charAt(0) || "H"}</Text>}
              </View>
              <View style={styles.heroBody}>
                <Text style={styles.heroName}>{profileState.name || "Unnamed hotel"}</Text>
                <Text style={styles.heroAddress}>{profileState.address || "No address set"}</Text>
                <Text style={styles.heroMeta}>Lat: {profileState.lat.toFixed(4)} · Lng: {profileState.lng.toFixed(4)}</Text>
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => setTab("details")}>
              <Text style={styles.secondaryButtonText}>Edit hotel details</Text>
            </Pressable>

            <View style={styles.statsRow}>
              <Pressable style={({ pressed }) => [styles.statCard, pressed && styles.buttonPressed]} onPress={() => setTab("rooms")}>
                <Text style={styles.statValue}>{profile.roomTypes.length}</Text>
                <Text style={styles.statLabel}>Room types</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.statCard, pressed && styles.buttonPressed]} onPress={() => setTab("perks")}>
                <Text style={styles.statValue}>{profile.perks.length}</Text>
                <Text style={styles.statLabel}>Perks</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.statCard, pressed && styles.buttonPressed]} onPress={() => setTab("rooms")}>
                <Text style={styles.statValue}>
                  {profile.roomTypes.length > 0 ? `${profile.roomTypes[0].currency} ${Math.min(...profile.roomTypes.map((r) => r.priceAmount))}` : "—"}
                </Text>
                <Text style={styles.statLabel}>From / night</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>Room types</Text>
            {profile.roomTypes.length === 0 ? (
              <Text style={styles.emptyHint}>No room types yet — add rooms so guests can book.</Text>
            ) : (
              <View style={styles.summaryGrid}>
                {profile.roomTypes.slice(0, 4).map((r) => (
                  <RoomTypeSummaryCard key={r.id} roomType={r} compact onPress={() => { setEditingRoomTypeId(r.id); setTab("rooms"); }} />
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Perks catalog</Text>
            {profile.perks.length === 0 ? (
              <Text style={styles.emptyHint}>No perks yet — add perks to offer during disruptions.</Text>
            ) : (
              <View style={styles.chipRow}>
                {profile.perks.slice(0, 8).map((p) => (
                  <View key={p.id} style={styles.perkChip}>
                    <Text style={styles.perkChipText}>{p.name}</Text>
                  </View>
                ))}
                {profile.perks.length > 8 && (
                  <Pressable style={({ pressed }) => [styles.perkChip, pressed && styles.buttonPressed]} onPress={() => setTab("perks")}>
                    <Text style={styles.perkChipText}>+{profile.perks.length - 8} more</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {tab === "details" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Hotel details</Text>
            <Text style={styles.cardCaption}>Update your hotel name, address and location. The pin is used to match nearby disruptions.</Text>

            <Text style={styles.fieldLabel}>Hotel photos</Text>
            <PhotoGrid
              urls={profileState.imageUrls}
              primaryIndex={profileState.primaryImageIndex}
              onSetPrimary={profileState.setPrimaryImageIndex}
              onRemove={profileState.removeHotelImage}
            />
            <AddPhotoButton onAdd={profileState.addHotelImage} />

            <Text style={styles.fieldLabel}>Hotel name</Text>
            <TextInput style={styles.input} value={profileState.name} onChangeText={profileState.setName} placeholder="e.g. Queenstown Lakeview Hotel" />

            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput style={styles.input} value={profileState.address} onChangeText={profileState.setAddress} placeholder="e.g. 1 Lake Esplanade, Queenstown" />

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Text style={styles.fieldLabel}>Latitude</Text>
                <CoordinateField value={profileState.lat} onChange={profileState.setLat} />
              </View>
              <View style={styles.rowItem}>
                <Text style={styles.fieldLabel}>Longitude</Text>
                <CoordinateField value={profileState.lng} onChange={profileState.setLng} />
              </View>
            </View>

            {!isOnline && <Text style={styles.offlineHint}>You&apos;re offline — reconnect to save changes</Text>}
            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
                disabled={profileState.saving || !isOnline}
                onPress={() => void profileState.saveProfile()}
              >
                <Text style={styles.primaryButtonText}>{profileState.saving ? "Saving…" : "Save hotel details"}</Text>
              </Pressable>
              {profileState.saved && <Text style={styles.savedText}>Saved successfully</Text>}
            </View>
          </View>
        )}

        {tab === "rooms" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Room types</Text>
            {editingRoomType ? (
              <RoomTypeEditor
                roomType={editingRoomType}
                onSave={(r) => profileState.saveRoomType(editingRoomType.id, r)}
                onDelete={async () => {
                  await profileState.deleteRoomType(editingRoomType.id);
                  setEditingRoomTypeId(null);
                }}
                onBack={() => setEditingRoomTypeId(null)}
                isOnline={isOnline}
              />
            ) : (
              <>
                {profile.roomTypes.length === 0 ? (
                  <Text style={styles.emptyHint}>No room types yet — add one so guests have something to book.</Text>
                ) : (
                  <View style={styles.summaryGrid}>
                    {profile.roomTypes.map((r) => (
                      <RoomTypeSummaryCard key={r.id} roomType={r} onPress={() => setEditingRoomTypeId(r.id)} />
                    ))}
                  </View>
                )}
                {!isOnline && <Text style={styles.offlineHint}>You&apos;re offline — reconnect to add a room type</Text>}
                <Pressable
                  style={({ pressed }) => [styles.secondaryButton, !isOnline && styles.buttonDisabled, pressed && styles.buttonPressed]}
                  disabled={profileState.addingRoomType || !isOnline}
                  onPress={async () => {
                    const id = await profileState.addRoomType();
                    if (id) setEditingRoomTypeId(id);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>{profileState.addingRoomType ? "Adding…" : "+ Add room type"}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {tab === "policy" && <PolicySection isOnline={isOnline} />}

        {tab === "perks" && <PerksSection perks={profile.perks} onAdd={profileState.addPerk} onDelete={profileState.deletePerk} isOnline={isOnline} />}
      </Animated.ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 12 },
  scrollContentCentered: { flexGrow: 1, justifyContent: "center" },
  tabsWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 4, gap: 4 },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8, paddingHorizontal: 2 },
  tabButtonActive: { backgroundColor: "#7628e8" },
  tabButtonPressed: { backgroundColor: "#f1f5f9" },
  tabButtonText: { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabButtonTextActive: { color: "#fff" },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.borderLight, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: theme.ink },
  cardCaption: { fontSize: 12, color: theme.muted, marginTop: -4 },
  heroRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  heroAvatar: { width: 56, height: 56, borderRadius: 14, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  heroAvatarImage: { width: "100%", height: "100%" },
  heroAvatarLetter: { fontSize: 22, fontWeight: "800", color: theme.accent },
  heroBody: { flex: 1, gap: 2 },
  heroName: { fontSize: 17, fontWeight: "800", color: theme.ink },
  heroAddress: { fontSize: 12, color: theme.mutedDark },
  heroMeta: { fontSize: 11, color: theme.muted, fontVariant: ["tabular-nums"] },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, backgroundColor: theme.background, borderRadius: 10, padding: 12, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800", color: theme.ink },
  statLabel: { fontSize: 11, color: theme.muted },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.ink, marginTop: 4 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  summaryCard: { width: "47%", backgroundColor: theme.background, borderRadius: 10, padding: 10, gap: 4 },
  summaryPhoto: { width: "100%", aspectRatio: 0.9, borderRadius: 8, backgroundColor: theme.borderLight },
  summaryPhotoPlaceholder: { alignItems: "center", justifyContent: "center" },
  summaryName: { fontSize: 13, fontWeight: "700", color: theme.ink },
  summaryPrice: { fontSize: 12, color: theme.accent, fontWeight: "700" },
  summaryUnit: { fontSize: 10, color: theme.muted, fontWeight: "400" },
  summaryCapacity: { fontSize: 11, color: theme.muted },
  summaryDescription: { fontSize: 11, color: theme.mutedDark, lineHeight: 15 },
  summaryAmenityRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
  summaryAmenityChip: { backgroundColor: theme.borderLight, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  summaryAmenityText: { fontSize: 9, color: theme.mutedDark, fontWeight: "600" },
  summaryAmenityMore: { fontSize: 9, color: theme.muted },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: theme.mutedDark, marginTop: 6 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.ink, textAlignVertical: "center" },
  textArea: { minHeight: 60, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  perkChip: { backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  perkChipText: { fontSize: 11, color: theme.accent, fontWeight: "700" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 11, color: theme.accent, fontWeight: "600" },
  chipRemove: { fontSize: 14, color: theme.accent, fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8 },
  addRowInput: { flex: 1 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoThumbWrap: { width: 100, gap: 4 },
  photoThumb: { width: 100, height: 80, borderRadius: 8, backgroundColor: theme.borderLight },
  photoThumbPrimary: { borderWidth: 2, borderColor: theme.accent },
  primaryBadge: { position: "absolute", top: 4, left: 4, backgroundColor: theme.accent, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  primaryBadgeText: { fontSize: 8, color: theme.surface, fontWeight: "700" },
  photoThumbActions: { gap: 4 },
  photoActionButton: { backgroundColor: theme.borderLight, borderRadius: 6, paddingVertical: 4, alignItems: "center" },
  photoActionButtonText: { fontSize: 9, color: theme.ink, fontWeight: "600" },
  photoActionButtonDanger: { backgroundColor: theme.dangerSoft },
  photoActionButtonDangerText: { fontSize: 9, color: theme.danger, fontWeight: "600" },
  addPhotoButton: { alignSelf: "flex-start", backgroundColor: theme.accentSoft, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  addPhotoButtonText: { fontSize: 12, color: theme.accent, fontWeight: "700" },
  emptyHint: { fontSize: 12, color: theme.muted, fontStyle: "italic" },
  backLink: { fontSize: 13, color: theme.accent, fontWeight: "600" },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  primaryButton: { backgroundColor: theme.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center" },
  primaryButtonText: { color: theme.surface, fontSize: 13, fontWeight: "700" },
  secondaryButton: { alignSelf: "flex-start", backgroundColor: theme.borderLight, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButtonText: { color: theme.ink, fontSize: 13, fontWeight: "700" },
  dangerButton: { backgroundColor: theme.dangerSoft, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center" },
  dangerButtonText: { color: theme.danger, fontSize: 13, fontWeight: "700" },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.7 },
  savedText: { fontSize: 12, color: theme.success, fontWeight: "600" },
  offlineHint: { fontSize: 11, color: theme.danger, fontWeight: "600" },
});
