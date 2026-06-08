import { describe, expect, it, vi } from 'vitest';
import { CloudRealtimeWakeup, hasRealtimeSettings } from './cloud-realtime.js';

describe('cloud realtime wake-up', () => {
  it('requires Supabase, library, and signed-in session settings', () => {
    expect(hasRealtimeSettings({})).toBe(false);
    expect(hasRealtimeSettings({
      supabaseUrl: 'https://example.supabase.co',
      supabasePublishableKey: 'key',
      libraryId: 'library',
      cloudSession: { accessToken: 'token' }
    })).toBe(true);
  });

  it('debounces multiple change notifications into one wake-up', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const realtime = new CloudRealtimeWakeup({ onChange, debounceMs: 50 });

    realtime.handleChange({ new: { id: 1, change_type: 'entry.upsert' } });
    realtime.handleChange({ new: { id: 2, change_type: 'entry.upsert' } });

    await vi.advanceTimersByTimeAsync(49);
    expect(onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].change.id).toBe(2);
    vi.useRealTimers();
  });
});
