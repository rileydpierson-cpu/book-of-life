import { describe, expect, it } from 'vitest';
import { addMonthsToMonthKey, buildCalendarMonthDays, formatMonthLabel, monthKeyFromIso } from './calendar';

describe('mobile calendar domain', () => {
  it('derives month keys and calendar grids', () => {
    expect(monthKeyFromIso('2026-05-10')).toBe('2026-05');
    expect(buildCalendarMonthDays('2026-05')).toHaveLength(42);
  });

  it('moves between months safely', () => {
    expect(addMonthsToMonthKey('2026-05', -1)).toBe('2026-04');
    expect(formatMonthLabel('2026-05')).toContain('2026');
  });
});
