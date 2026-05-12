export function estimateTimelineUnitHeight() {
  return 300;
}

export function timelineHydrationWindowSize() {
  return 10;
}

export function estimateHeightForDay(day, measuredHeights) {
  if (!day?.isoDate) return estimateTimelineUnitHeight();
  return measuredHeights.get(day.isoDate) || estimateTimelineUnitHeight();
}

export function sumEstimatedHeights(days, measuredHeights) {
  return Math.round((days || []).reduce((sum, day) => sum + estimateHeightForDay(day, measuredHeights), 0));
}
