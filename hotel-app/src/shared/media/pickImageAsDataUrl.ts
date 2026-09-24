import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type PickImageResult = { ok: true; dataUrl: string } | { ok: false; error: string } | { ok: false; cancelled: true };

// 跟 Web 端 HotelProfilePanel.tsx 的 readAsDataUrl() 同一套方案：图片就是 base64 data URL 直接存进
// ImageUrls 数组，后端没有独立的对象存储接口，不要在 App 侧另起一套上传机制。单张 2MB 上限对齐 Web 端。
export async function pickImageAsDataUrl(): Promise<PickImageResult> {
  // Web 上先 await 权限请求会打断浏览器"文件选择器必须在用户手势的同一个事件循环里打开"的
  // 要求,导致 launchImageLibraryAsync 静默不弹窗(没有报错,单纯什么都不发生)——这是真实踩过的
  // 坑。原生平台上 launchImageLibraryAsync 内部本来就会按需请求权限,这里不用重复问一遍。
  if (Platform.OS !== "web") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { ok: false, error: "Photo library permission was denied." };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    base64: true,
    quality: 0.9,
  });
  if (result.canceled || result.assets.length === 0) return { ok: false, cancelled: true };

  const asset = result.assets[0];
  if (!asset.base64) return { ok: false, error: "Could not read the selected photo." };

  const approxBytes = asset.fileSize ?? Math.ceil((asset.base64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return { ok: false, error: "Each photo must be under 2MB." };

  const mimeType = asset.mimeType ?? "image/jpeg";
  return { ok: true, dataUrl: `data:${mimeType};base64,${asset.base64}` };
}
