export function galleryMediaAspectRatio(media) {
  const width = Number(media?.width || 0);
  const height = Number(media?.height || 0);
  if (width > 0 && height > 0) return clamp(width / height, 0.45, 3.2);
  return 1;
}

export function buildJustifiedGalleryRows(media, options = {}) {
  const items = Array.isArray(media) ? media : [];
  const containerWidth = Math.max(1, Math.floor(Number(options.containerWidth || 0)));
  const gap = Math.max(0, Math.round(Number(options.gap ?? 8)));
  const targetRowHeight = Math.max(1, Math.round(Number(options.targetRowHeight || 190)));
  const minRowHeight = Math.max(1, Math.round(Number(options.minRowHeight || 110)));
  const maxRowHeight = Math.max(minRowHeight, Math.round(Number(options.maxRowHeight || 340)));
  const getAspectRatio = typeof options.getAspectRatio === 'function' ? options.getAspectRatio : galleryMediaAspectRatio;
  const rows = [];
  let current = [];
  let ratioSum = 0;

  const pushRow = (rowItems, rowRatioSum, justified) => {
    if (!rowItems.length) return;
    const gapsWidth = Math.max(0, rowItems.length - 1) * gap;
    const availableWidth = Math.max(1, containerWidth - gapsWidth);
    const solvedHeight = availableWidth / Math.max(rowRatioSum, 0.1);
    const naturalHeight = justified ? solvedHeight : targetRowHeight;
    const height = clamp(Math.round(naturalHeight), minRowHeight, maxRowHeight);
    const tileAvailableWidth = justified
      ? availableWidth
      : Math.min(availableWidth, Math.round(rowRatioSum * height));
    const widths = distributeWidths(rowItems.map((entry) => entry.ratio), tileAvailableWidth);
    rows.push({
      height,
      justified,
      width: widths.reduce((sum, width) => sum + width, 0) + gapsWidth,
      items: rowItems.map((entry, index) => ({
        item: entry.item,
        ratio: entry.ratio,
        width: widths[index]
      }))
    });
  };

  items.forEach((item, index) => {
    const ratio = Math.max(0.1, Number(getAspectRatio(item)) || 1);
    current.push({ item, ratio });
    ratioSum += ratio;
    const gapsWidth = Math.max(0, current.length - 1) * gap;
    const availableWidth = Math.max(1, containerWidth - gapsWidth);
    const rowHeight = availableWidth / Math.max(ratioSum, 0.1);
    const isLast = index === items.length - 1;

    if (!isLast && rowHeight <= targetRowHeight) {
      pushRow(current, ratioSum, true);
      current = [];
      ratioSum = 0;
      return;
    }

    if (isLast) {
      const naturalWidth = Math.round(ratioSum * targetRowHeight) + gapsWidth;
      pushRow(current, ratioSum, naturalWidth > containerWidth);
    }
  });

  return rows;
}

function distributeWidths(ratios, totalWidth) {
  const safeTotal = Math.max(1, Math.round(Number(totalWidth || 0)));
  const ratioSum = ratios.reduce((sum, ratio) => sum + Math.max(0.1, Number(ratio) || 1), 0);
  const widths = ratios.map((ratio) => {
    const exact = (Math.max(0.1, Number(ratio) || 1) / ratioSum) * safeTotal;
    return {
      width: Math.max(1, Math.floor(exact)),
      remainder: exact - Math.floor(exact)
    };
  });
  let remaining = safeTotal - widths.reduce((sum, entry) => sum + entry.width, 0);
  const byRemainder = widths
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; remaining > 0 && byRemainder.length; index = (index + 1) % byRemainder.length) {
    widths[byRemainder[index].index].width += 1;
    remaining -= 1;
  }
  return widths.map((entry) => entry.width);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
