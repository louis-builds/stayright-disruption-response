import { useCallback, useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as api from "./api";
import type { UploadedDocument } from "./types";

// 跟 Web 端 HotelProfilePanel.tsx 的 formatDateTimeForInput/parseDateTimeInput 同一套格式：
// datetime-local 在不同系统语言下 placeholder 不稳定，改成 "YYYY-MM-DD HH:mm" 文本输入。
function formatDateTimeForInput(iso?: string | null): string {
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

export function usePolicy() {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [freeCancellationHours, setFreeCancellationHours] = useState("");
  const [cancellationFeePercent, setCancellationFeePercent] = useState("");
  const [cancellationFeeFixed, setCancellationFeeFixed] = useState("");
  const [currency, setCurrency] = useState("NZD");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [extractStatus, setExtractStatus] = useState<"idle" | "extracting" | "done" | "error">("idle");
  const [aiUnavailableNotice, setAiUnavailableNotice] = useState(false);
  // 断网/上传失败时留着这份文档,让"重试"按钮能直接重发同一个文件,不用逼用户重新选一遍——
  // 这是明确降级出来的"手动重试",不做自动重试队列(plan.md 里写明了,纯展示型 App 不需要)。
  const [lastFailedDoc, setLastFailedDoc] = useState<UploadedDocument | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.fetchRefundPolicy();
    if (res.code === 0 && res.data) {
      setContent(res.data.content);
      setEffectiveFrom(formatDateTimeForInput(res.data.effectiveFrom));
      setEffectiveUntil(formatDateTimeForInput(res.data.effectiveUntil));
      try {
        const rules = res.data.structuredRulesJson ? (JSON.parse(res.data.structuredRulesJson) as Record<string, unknown>) : null;
        if (rules) {
          if (rules.freeCancellationHours != null) setFreeCancellationHours(String(rules.freeCancellationHours));
          if (rules.cancellationFeePercent != null) setCancellationFeePercent(String(rules.cancellationFeePercent));
          if (rules.cancellationFeeFixed != null) setCancellationFeeFixed(String(rules.cancellationFeeFixed));
          if (typeof rules.currency === "string") setCurrency(rules.currency);
        }
      } catch {
        // 存量数据的 structuredRulesJson 格式不对就跳过预填，不阻断整页加载。
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function buildStructuredRulesJson(): string | undefined {
    if (!freeCancellationHours.trim() && !cancellationFeePercent.trim() && !cancellationFeeFixed.trim()) return undefined;
    return JSON.stringify({
      freeCancellationHours: freeCancellationHours.trim() ? Number(freeCancellationHours) : null,
      cancellationFeePercent: cancellationFeePercent.trim() ? Number(cancellationFeePercent) : null,
      cancellationFeeFixed: cancellationFeeFixed.trim() ? Number(cancellationFeeFixed) : null,
      currency,
    });
  }

  function validateDates(): { from: string | null; until: string | null } | null {
    const parsedFrom = parseDateTimeInput(effectiveFrom);
    if (effectiveFrom.trim() && !parsedFrom) {
      setError("Effective from must be in YYYY-MM-DD HH:mm format.");
      return null;
    }
    const parsedUntil = parseDateTimeInput(effectiveUntil);
    if (effectiveUntil.trim() && !parsedUntil) {
      setError("Effective until must be in YYYY-MM-DD HH:mm format.");
      return null;
    }
    return { from: parsedFrom, until: parsedUntil };
  }

  async function save() {
    setError(null);
    setSaved(false);
    const dates = validateDates();
    if (!dates) return;

    setSaving(true);
    const res = await api.updateRefundPolicy({
      content,
      structuredRulesJson: buildStructuredRulesJson(),
      effectiveFrom: dates.from,
      effectiveUntil: dates.until,
      isActive: true,
    });
    setSaving(false);
    if (res.code === 0) {
      setSaved(true);
    } else {
      setError(res.message || "Failed to save policy.");
    }
  }

  async function runExtraction(text: string) {
    if (!text.trim()) return;
    setExtractStatus("extracting");
    const res = await api.extractRefundRules(text);
    if (res.code === 0) {
      const r = res.data;
      // 只回填非 null 字段，null 的字段保持表单原值不被覆盖——AI 没提取到不代表"这项就是没有"。
      if (r.freeCancellationHours != null) setFreeCancellationHours(String(r.freeCancellationHours));
      if (r.cancellationFeePercent != null) setCancellationFeePercent(String(r.cancellationFeePercent));
      if (r.cancellationFeeFixed != null) setCancellationFeeFixed(String(r.cancellationFeeFixed));
      if (r.currency) setCurrency(r.currency);
      setAiUnavailableNotice(!r.aiUsed);
      setExtractStatus("done");
    } else {
      setExtractStatus("error");
    }
  }

  async function uploadDocument(doc: UploadedDocument) {
    const dates = validateDates();
    if (!dates) return;

    setSaving(true);
    setExtractStatus("extracting");
    try {
      const res = await api.uploadRefundPolicyFile(doc, { effectiveFrom: dates.from, effectiveUntil: dates.until, isActive: true });
      if (res.code === 0) {
        setContent(res.data.content);
        setEffectiveFrom(formatDateTimeForInput(res.data.effectiveFrom));
        setEffectiveUntil(formatDateTimeForInput(res.data.effectiveUntil));
        setUploadedFileName(doc.name);
        setSaved(true);
        setLastFailedDoc(null);
        await runExtraction(res.data.content);
      } else {
        setError(res.message || "Failed to upload policy file.");
        setExtractStatus("error");
        setLastFailedDoc(doc);
      }
    } catch {
      setError("Failed to upload policy file — check your connection and retry.");
      setExtractStatus("error");
      setLastFailedDoc(doc);
    } finally {
      setSaving(false);
    }
  }

  async function pickAndUploadDocument() {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/markdown", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets || picked.assets.length === 0) return;

    const asset = picked.assets[0];
    const doc: UploadedDocument = { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file };
    await uploadDocument(doc);
  }

  async function retryUpload() {
    if (!lastFailedDoc) return;
    setError(null);
    await uploadDocument(lastFailedDoc);
  }

  return {
    loading,
    content,
    setContent: (v: string) => { setContent(v); setSaved(false); },
    effectiveFrom,
    setEffectiveFrom: (v: string) => { setEffectiveFrom(v); setSaved(false); },
    effectiveUntil,
    setEffectiveUntil: (v: string) => { setEffectiveUntil(v); setSaved(false); },
    freeCancellationHours,
    setFreeCancellationHours: (v: string) => { setFreeCancellationHours(v); setSaved(false); },
    cancellationFeePercent,
    setCancellationFeePercent: (v: string) => { setCancellationFeePercent(v); setSaved(false); },
    cancellationFeeFixed,
    setCancellationFeeFixed: (v: string) => { setCancellationFeeFixed(v); setSaved(false); },
    currency,
    setCurrency: (v: string) => { setCurrency(v); setSaved(false); },
    saving,
    saved,
    error,
    uploadedFileName,
    extractStatus,
    aiUnavailableNotice,
    canRetryUpload: !!lastFailedDoc,
    save,
    pickAndUploadDocument,
    retryUpload,
  };
}
