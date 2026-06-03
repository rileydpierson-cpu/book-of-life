export const BASIC_PLAN_STORAGE_BYTES = 1024 * 1024 * 1024;

export function computeCloudStorageUsage(items = []) {
  const usedBytes = (Array.isArray(items) ? items : [])
    .filter((item) => item?.original_in_cloud !== false)
    .reduce((total, item) => total + Math.max(0, Number(item?.original_size || 0)), 0);
  return {
    usedBytes,
    limitBytes: BASIC_PLAN_STORAGE_BYTES,
    percent: Math.max(0, Math.min(100, Math.round((usedBytes / BASIC_PLAN_STORAGE_BYTES) * 100)))
  };
}
