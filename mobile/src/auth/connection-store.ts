import * as SecureStore from 'expo-secure-store';

const CONNECTION_KEY = 'lifeserver-mobile-connection';

export type StoredConnection = {
  serverUrl: string;
  deviceId: string;
  authToken: string;
  username?: string;
  syncRoot?: {
    rootId: string;
    rootLabel: string;
    deviceFolderName: string;
    baseRelativePath: string;
  } | null;
};

export async function saveConnection(connection: StoredConnection) {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection));
}

export async function loadConnection(): Promise<StoredConnection | null> {
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.serverUrl !== 'string' || typeof parsed.deviceId !== 'string' || typeof parsed.authToken !== 'string') return null;
    return parsed as StoredConnection;
  } catch (error) {
    return null;
  }
}

export async function clearConnection() {
  await SecureStore.deleteItemAsync(CONNECTION_KEY);
}
