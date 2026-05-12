export function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function isoToUtcDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function monthKeyFromIso(isoDate) {
  return isValidIsoDate(isoDate) ? isoDate.slice(0, 7) : '';
}

export function monthStartIso(monthKey) {
  return /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? `${monthKey}-01` : '';
}

export function addDaysToIso(isoDate, delta) {
  const date = isoToUtcDate(isoDate);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(delta || 0));
  return [
    date.getUTCFullYear(),
    `${date.getUTCMonth() + 1}`.padStart(2, '0'),
    `${date.getUTCDate()}`.padStart(2, '0')
  ].join('-');
}

export function addMonthsToMonthKey(monthKey, delta) {
  const date = isoToUtcDate(monthStartIso(monthKey));
  if (!date) return '';
  date.setUTCMonth(date.getUTCMonth() + Number(delta || 0));
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}`;
}

export function compareIsoDates(a, b) {
  if (!isValidIsoDate(a) || !isValidIsoDate(b)) return 0;
  return a.localeCompare(b);
}

export function isWithinCalendarRange(isoDate, minDate, maxDate) {
  if (!isValidIsoDate(isoDate)) return false;
  if (isValidIsoDate(minDate) && compareIsoDates(isoDate, minDate) < 0) return false;
  if (isValidIsoDate(maxDate) && compareIsoDates(isoDate, maxDate) > 0) return false;
  return true;
}

export function clampIsoDate(isoDate, minDate, maxDate) {
  if (!isValidIsoDate(isoDate)) return '';
  if (isValidIsoDate(minDate) && compareIsoDates(isoDate, minDate) < 0) return minDate;
  if (isValidIsoDate(maxDate) && compareIsoDates(isoDate, maxDate) > 0) return maxDate;
  return isoDate;
}

export function buildCalendarMonthDays(monthKey) {
  const firstDay = isoToUtcDate(monthStartIso(monthKey));
  if (!firstDay) return [];
  const firstWeekday = firstDay.getUTCDay();
  const firstGridDate = new Date(firstDay);
  firstGridDate.setUTCDate(firstGridDate.getUTCDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDate);
    date.setUTCDate(firstGridDate.getUTCDate() + index);
    const isoDate = [
      date.getUTCFullYear(),
      `${date.getUTCMonth() + 1}`.padStart(2, '0'),
      `${date.getUTCDate()}`.padStart(2, '0')
    ].join('-');
    return {
      isoDate,
      inMonth: monthKeyFromIso(isoDate) === monthKey
    };
  });
}
