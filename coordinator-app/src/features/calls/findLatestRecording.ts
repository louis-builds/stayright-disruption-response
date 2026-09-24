import CallRec from "call-rec";
import Constants from "expo-constants";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

const PACKAGE = Constants.expoConfig?.android?.package ?? "nz.stayright.coordinator";

export function hasAllFilesAccess() {
  if (Platform.OS !== "android") return false;
  return CallRec.hasAllFilesAccess();
}

export async function requestAllFilesAccess() {
  if (Platform.OS !== "android") return;
  try {
    await IntentLauncher.startActivityAsync("android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION", {
      data: `package:${PACKAGE}`,
    });
  } catch {
    await IntentLauncher.startActivityAsync("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION");
  }
}

export async function findLatestCallRecording(startedAt: string, calleePhone?: string | null) {
  if (Platform.OS !== "android") {
    return { file: null, reason: "Auto-upload only works on an Android phone with system call recording enabled." };
  }

  try {
    const files = await CallRec.listXiaomiCallRec();
    if (files.length === 0) {
      const status = CallRec.scanStatus();
      if (!CallRec.hasAllFilesAccess()) {
        return {
          file: null,
          reason: `Grant all files access, then Scan again. ${status}`,
        };
      }
      return {
        file: null,
        reason: `No recording in MIUI/sound_recorder/call_rec yet. ${status}`,
      };
    }

    const digits = calleePhone?.replace(/\D/g, "").slice(-6) ?? "";
    const startedMs = new Date(startedAt).getTime() - 60_000;
    files.sort((a, b) => score(b, digits, startedMs) - score(a, digits, startedMs) || b.time - a.time);
    const chosen = files[0];
    const uri = await CallRec.copyToCache(chosen.path || chosen.uri);

    return {
      file: {
        uri,
        name: chosen.name,
        type: guessType(chosen.name),
      },
      reason: null,
    };
  } catch (error) {
    return {
      file: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function score(file: { name: string; time: number }, phoneDigits: string, startedMs: number) {
  let value = 0;
  if (file.time >= startedMs) value += 6;
  if (phoneDigits && file.name.replace(/\D/g, "").includes(phoneDigits)) value += 4;
  return value;
}

function guessType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".amr")) return "audio/amr";
  if (lower.endsWith(".3gp")) return "audio/3gpp";
  return "audio/mp4";
}
