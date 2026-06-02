export async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const message = error?.message || 'Network request failed.';
    throw new Error(message === 'Failed to fetch'
      ? 'Could not reach the local Book of Life desktop service. Restart the desktop app and try again.'
      : message);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function postJson(url, body, options = {}) {
  return fetchJson(url, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: JSON.stringify(body)
  });
}
