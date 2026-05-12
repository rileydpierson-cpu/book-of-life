import { describe, expect, it } from 'vitest';
import { estimateHeightForDay, estimateTimelineUnitHeight, sumEstimatedHeights, timelineHydrationWindowSize } from './index.js';

describe('timeline domain', () => {
  it('returns stable baseline values', () => {
    expect(estimateTimelineUnitHeight()).toBeGreaterThan(0);
    expect(timelineHydrationWindowSize()).toBe(10);
  });

  it('uses measured heights when available', () => {
    const measured = new Map([['2026-05-10', 420]]);
    expect(estimateHeightForDay({ isoDate: '2026-05-10' }, measured)).toBe(420);
    expect(sumEstimatedHeights([{ isoDate: '2026-05-10' }, { isoDate: '2026-05-11' }], measured)).toBe(720);
  });
});
