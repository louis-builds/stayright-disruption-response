export async function requestMediaLibraryAudioPermission() {
  return { status: "granted" as const };
}

export async function getMediaLibraryAudioPermission() {
  return { status: "granted" as const, granted: true };
}
