import { fetchJson, postJson } from './api.js';

export function createAppContext({ documentRef = document, windowRef = window } = {}) {
  return {
    document: documentRef,
    window: windowRef,
    fetchJson,
    postJson
  };
}
