export type MobileConnection = {
  serverUrl: string;
  authToken?: string;
};

export async function mobileFetchJson<T>(connection: MobileConnection, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, connection.serverUrl).toString(), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(connection.authToken ? { Authorization: `Bearer ${connection.authToken}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || `Request failed (${response.status})`);
  }
  return payload as T;
}

export async function mobileUploadJson<T>(
  connection: MobileConnection,
  path: string,
  payload: {
    assetUri: string;
    fileName: string;
    rootId: string;
    relativePath: string;
    localAssetId: string;
  }
): Promise<T> {
  const formData = new FormData();
  formData.append('rootId', payload.rootId);
  formData.append('relativePath', payload.relativePath);
  formData.append('localAssetId', payload.localAssetId);
  formData.append('file', {
    uri: payload.assetUri,
    name: payload.fileName,
    type: payload.fileName.toLowerCase().match(/\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/)
      ? 'video/*'
      : 'image/*'
  } as unknown as Blob);

  const response = await fetch(new URL(path, connection.serverUrl).toString(), {
    method: 'POST',
    headers: {
      ...(connection.authToken ? { Authorization: `Bearer ${connection.authToken}` } : {})
    },
    body: formData
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((responsePayload as { error?: string }).error || `Upload failed (${response.status})`);
  }
  return responsePayload as T;
}
