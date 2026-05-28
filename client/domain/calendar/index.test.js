import { describe, expect, it } from 'vitest';
import { buildCalendarMonthDays, clampIsoDate, isWithinCalendarRange, monthKeyFromIso } from './index.js';

describe('calendar domain', () => {
  it('builds a 6-week month grid', () => {
    const days = buildCalendarMonthDays('2026-05');
    expect(days).toHaveLength(42);
    expect(days.some((entry) => entry.isoDate === '2026-05-01')).toBe(true);
  });

  it('clamps dates into range', () => {
    expect(clampIsoDate('2026-05-10', '2026-05-01', '2026-05-31')).toBe('2026-05-10');
    expect(clampIsoDate('2026-04-10', '2026-05-01', '2026-05-31')).toBe('2026-05-01');
    expect(clampIsoDate('2026-06-10', '2026-05-01', '2026-05-31')).toBe('2026-05-31');
  });

  it('checks ranges and month keys', () => {
    expect(isWithinCalendarRange('2026-05-10', '2026-05-01', '2026-05-31')).toBe(true);
    expect(isWithinCalendarRange('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false);
    expect(monthKeyFromIso('2026-05-10')).toBe('2026-05');
  });
});
