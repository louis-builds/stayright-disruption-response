import * as MediaLibrary from "expo-media-library";

export function requestMediaLibraryAudioPermission() {
  return MediaLibrary.requestPermissionsAsync(false, ["audio"]);
}

export function getMediaLibraryAudioPermission() {
  return MediaLibrary.getPermissionsAsync(false, ["audio"]);
}
