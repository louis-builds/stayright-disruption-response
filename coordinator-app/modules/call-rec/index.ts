import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type XiaomiCallRec = {
  path: string;
  uri: string;
  name: string;
  time: number;
  size: number;
};

type CallRecNative = {
  hasAllFilesAccess(): boolean;
  scanStatus(): string;
  listXiaomiCallRec(): Promise<XiaomiCallRec[]>;
  copyToCache(path: string): Promise<string>;
};

const CallRec: CallRecNative =
  Platform.OS === "android"
    ? requireNativeModule<CallRecNative>("CallRec")
    : {
        hasAllFilesAccess: () => false,
        scanStatus: () => "not-android",
        listXiaomiCallRec: async () => [],
        copyToCache: async () => "",
      };

export default CallRec;
