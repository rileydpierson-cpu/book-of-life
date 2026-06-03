import { describe, expect, it } from 'vitest';
import { BASIC_PLAN_STORAGE_BYTES, computeCloudStorageUsage } from './storage-usage.js';

describe('cloud storage usage', () => {
  it('returns zero usage when there are no cloud originals', () => {
    const usage = computeCloudStorageUsage([]);
    expect(usage.usedBytes).toBe(0);
    expect(usage.limitBytes).toBe(BASIC_PLAN_STORAGE_BYTES);
    expect(usage.percent).toBe(0);
  });

  it('sums original sizes only for cloud originals', () => {
    const usage = computeCloudStorageUsage([
      { original_in_cloud: true, original_size: 128 },
      { original_in_cloud: false, original_size: 1024 },
      { original_in_cloud: true, original_size: 256 }
    ]);
    expect(usage.usedBytes).toBe(384);
  });
});
