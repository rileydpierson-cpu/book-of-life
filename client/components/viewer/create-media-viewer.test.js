import { describe, expect, it } from 'vitest';
import { buildNearbyMediaPreloadQueue } from './create-media-viewer.js';

function mediaItems(count) {
  return Array.from({ length: count }, (_value, index) => ({
    id: `photo-${index}`,
    fullUrl: `/media/display/photo-${index}`
  }));
}

function queuedIds(result) {
  return result.queue.map((item) => item.id);
}

describe('buildNearbyMediaPreloadQueue', () => {
  it('orders candidates from the current item outward', () => {
    const result = buildNearbyMediaPreloadQueue(mediaItems(30), 10, { maxItems: 5 });

    expect(queuedIds(result)).toEqual([
      'photo-10',
      'photo-9',
      'photo-11',
      'photo-8',
      'photo-12'
    ]);
    expect(Array.from(result.queuedIds)).toEqual(queuedIds(result));
  });

  it('caps the queue to the requested nearby buffer size', () => {
    const result = buildNearbyMediaPreloadQueue(mediaItems(60), 30);

    expect(result.queue).toHaveLength(20);
    expect(queuedIds(result)).toEqual([
      'photo-30',
      'photo-29',
      'photo-31',
      'photo-28',
      'photo-32',
      'photo-27',
      'photo-33',
      'photo-26',
      'photo-34',
      'photo-25',
      'photo-35',
      'photo-24',
      'photo-36',
      'photo-23',
      'photo-37',
      'photo-22',
      'photo-38',
      'photo-21',
      'photo-39',
      'photo-20'
    ]);
  });

  it('continues scanning nearby context when some items are not eligible', () => {
    const items = mediaItems(8).map((item, index) => ({
      ...item,
      type: index === 4 ? 'video' : 'image',
      fullUrl: index === 2 ? '' : item.fullUrl
    }));
    const loadedIds = new Set(['photo-3']);
    const pendingIds = new Set(['photo-5']);

    const result = buildNearbyMediaPreloadQueue(items, 4, {
      maxItems: 4,
      isEligible: (item) => (
        item.type !== 'video'
        && Boolean(item.fullUrl)
        && !loadedIds.has(item.id)
        && !pendingIds.has(item.id)
      )
    });

    expect(queuedIds(result)).toEqual(['photo-6', 'photo-1', 'photo-7', 'photo-0']);
  });

  it('handles sequence edges without wrapping outside the active context', () => {
    const result = buildNearbyMediaPreloadQueue(mediaItems(6), 0, { maxItems: 4 });

    expect(queuedIds(result)).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3']);
  });
});
