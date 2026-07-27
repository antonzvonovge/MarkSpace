import { invoke } from "@tauri-apps/api/core";

export type SyncStatus = {
  connected: boolean;
  isRepo: boolean;
  remoteUrl: string | null;
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  conflicted: string[];
  lastError: string | null;
};

export type SyncResult = {
  status: SyncStatus;
  message: string;
  conflicted: string[];
};

export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type DeviceTokenResponse = {
  accessToken: string | null;
  error: string | null;
  errorDescription: string | null;
};

export async function syncGithubClientId(): Promise<string | null> {
  return invoke("sync_github_client_id");
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return invoke("sync_status");
}

export async function syncConnect(
  remoteUrl: string,
  token: string | null,
): Promise<SyncStatus> {
  return invoke("sync_connect", { remoteUrl, token });
}

export async function syncDisconnect(): Promise<SyncStatus> {
  return invoke("sync_disconnect");
}

export async function syncNow(token: string | null): Promise<SyncResult> {
  return invoke("sync_now", { token });
}

export async function syncResolveConflict(
  path: string,
  choice: "ours" | "theirs",
): Promise<SyncStatus> {
  return invoke("sync_resolve_conflict", { path, choice });
}

export async function syncDeviceFlowStart(): Promise<DeviceCodeResponse> {
  return invoke("sync_device_flow_start");
}

export async function syncDeviceFlowPoll(
  deviceCode: string,
): Promise<DeviceTokenResponse> {
  return invoke("sync_device_flow_poll", { deviceCode });
}
