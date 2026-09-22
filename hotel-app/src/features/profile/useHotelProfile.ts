import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import type { HotelProfile, RoomType } from "./types";

const EMPTY_ROOM_TYPE: Omit<RoomType, "id"> = { name: "", description: "", amenities: [], capacity: 2, priceAmount: 0, currency: "NZD", imageUrls: [] };

export function useHotelProfile() {
  const [profile, setProfile] = useState<HotelProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0);
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
      setImageUrls(res.data.imageUrls);
      setPrimaryImageIndex(res.data.primaryImageIndex);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function addHotelImage(dataUrl: string) {
    setImageUrls((prev) => [...prev, dataUrl]);
    setSaved(false);
  }

  function removeHotelImage(index: number) {
    setImageUrls((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (primaryImageIndex >= next.length && next.length > 0) setPrimaryImageIndex(0);
      return next;
    });
    setSaved(false);
  }

  async function saveProfile() {
    setSaving(true);
    await api.updateProfile(name, address, lat, lng, imageUrls, primaryImageIndex);
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

  async function addRoomType(): Promise<string | null> {
    setAddingRoomType(true);
    const res = await api.addRoomType(EMPTY_ROOM_TYPE);
    setAddingRoomType(false);
    await refresh();
    return res.code === 0 ? res.data.id : null;
  }

  async function addPerk(name: string) {
    await api.addPerk(name);
    await refresh();
  }

  async function deletePerk(id: string) {
    await api.deletePerk(id);
    await refresh();
  }

  return {
    profile,
    loading,
    name,
    setName: (v: string) => { setName(v); setSaved(false); },
    address,
    setAddress: (v: string) => { setAddress(v); setSaved(false); },
    lat,
    setLat: (v: number) => { setLat(v); setSaved(false); },
    lng,
    setLng: (v: number) => { setLng(v); setSaved(false); },
    imageUrls,
    primaryImageIndex,
    setPrimaryImageIndex: (i: number) => { setPrimaryImageIndex(i); setSaved(false); },
    addHotelImage,
    removeHotelImage,
    saving,
    saved,
    saveProfile,
    addingRoomType,
    addRoomType,
    saveRoomType,
    deleteRoomType,
    addPerk,
    deletePerk,
    refresh,
  };
}
