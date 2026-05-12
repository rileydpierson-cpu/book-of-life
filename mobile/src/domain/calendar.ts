export function isValidIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function isoToUtcDate(isoDate: string) {
  const [year, month, day] = String(isoDate || '').split('-').map(Number);
  return new Date(Date.UTC(year || 0, Math.max(0, (month || 1) - 1), day || 1));
}

export function monthKeyFromIso(isoDate: string) {
  return isValidIsoDate(isoDate) ? isoDate.slice(0, 7) : '';
}

export function monthStartIso(monthKey: string) {
  return /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? `${monthKey}-01` : '';
}

export function addDaysToIso(isoDate: string, delta: number) {
  const date = isoToUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + Number(delta || 0));
  return date.toISOString().slice(0, 10);
}

export function addMonthsToMonthKey(monthKey: string, delta: number) {
  const start = isoToUtcDate(monthStartIso(monthKey));
  start.setUTCMonth(start.getUTCMonth() + Number(delta || 0));
  return start.toISOString().slice(0, 7);
}

export function buildCalendarMonthDays(monthKey: string) {
  const firstDay = isoToUtcDate(monthStartIso(monthKey));
  const offset = firstDay.getUTCDay();
  const cursor = new Date(firstDay);
  cursor.setUTCDate(cursor.getUTCDate() - offset);
  return Array.from({ length: 42 }, () => {
    const isoDate = cursor.toISOString().slice(0, 10);
    const result = {
      isoDate,
      inMonth: monthKeyFromIso(isoDate) === monthKey
    };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return result;
  });
}

export function formatMonthLabel(monthKey: string) {
  const startIso = monthStartIso(monthKey);
  if (!startIso) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(isoToUtcDate(startIso));
}

export function formatMonthDayLabel(isoDate: string) {
  if (!isValidIsoDate(isoDate)) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(isoToUtcDate(isoDate));
}

export function formatLongDateLabel(isoDate: string) {
  if (!isValidIsoDate(isoDate)) return '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(isoToUtcDate(isoDate));
}
