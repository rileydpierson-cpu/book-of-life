import { describe, expect, it } from 'vitest';
import { buildJustifiedGalleryRows, galleryMediaAspectRatio } from './index.js';

function rowWidth(row, gap = 8) {
  return row.items.reduce((sum, item) => sum + item.width, 0) + Math.max(0, row.items.length - 1) * gap;
}

describe('gallery layout domain', () => {
  it('makes complete rows exactly fill the container including gaps', () => {
    const rows = buildJustifiedGalleryRows([
      { width: 400, height: 300 },
      { width: 400, height: 300 },
      { width: 400, height: 300 }
    ], { containerWidth: 900, gap: 8, targetRowHeight: 240 });

    expect(rows).toHaveLength(1);
    expect(rows[0].justified).toBe(true);
    expect(rowWidth(rows[0])).toBe(900);
  });

  it('keeps an underfilled last row at natural width', () => {
    const rows = buildJustifiedGalleryRows([
      { width: 400, height: 300 },
      { width: 300, height: 300 }
    ], { containerWidth: 900, gap: 8, targetRowHeight: 180 });

    expect(rows).toHaveLength(1);
    expect(rows[0].justified).toBe(false);
    expect(rowWidth(rows[0])).toBeLessThan(900);
    expect(rows[0].height).toBe(180);
  });

  it('justifies the last row when natural width would overflow', () => {
    const rows = buildJustifiedGalleryRows([
      { width: 1000, height: 300 },
      { width: 1000, height: 300 }
    ], { containerWidth: 620, gap: 8, targetRowHeight: 180 });

    expect(rows.at(-1).justified).toBe(true);
    expect(rowWidth(rows.at(-1))).toBe(620);
  });

  it('falls back to square tiles for missing dimensions', () => {
    const rows = buildJustifiedGalleryRows([
      {},
      { width: 0, height: 0 },
      { width: 400, height: 400 }
    ], { containerWidth: 600, gap: 8, targetRowHeight: 240 });

    expect(rows[0].items.map((item) => item.ratio)).toEqual([1, 1, 1]);
    expect(rowWidth(rows[0])).toBe(600);
  });

  it('clamps extreme aspect ratios', () => {
    expect(galleryMediaAspectRatio({ width: 4000, height: 500 })).toBe(3.2);
    expect(galleryMediaAspectRatio({ width: 300, height: 1200 })).toBe(0.45);

    const rows = buildJustifiedGalleryRows([
      { width: 4000, height: 500 },
      { width: 300, height: 1200 },
      { width: 600, height: 600 }
    ], { containerWidth: 720, gap: 8, targetRowHeight: 180 });

    expect(rows.every((row) => row.width <= 720)).toBe(true);
  });
});
