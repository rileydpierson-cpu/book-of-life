export const TIME_HOUR_VALUES = Array.from({ length: 12 }, (_, index) => String(index + 1));
export const TIME_MINUTE_VALUES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
export const TIME_PERIOD_VALUES = ['AM', 'PM'];
export const TIME_SPINNER_REPEAT_COUNT = 5;
export const TIME_SPINNER_CENTER_REPEAT = Math.floor(TIME_SPINNER_REPEAT_COUNT / 2);

export function normalizeTimeValue(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  if (!match) return '12:00';
  const hours = Math.min(23, Math.max(0, Number(match[1] || 0)));
  const minutes = Math.min(59, Math.max(0, Number(match[2] || 0)));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getTimeParts(value) {
  const normalized = normalizeTimeValue(value);
  const [hours24, minutes] = normalized.split(':').map(Number);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hour12 = hours24 % 12 || 12;
  return {
    hour24: hours24,
    hour12: String(hour12),
    minute: String(minutes).padStart(2, '0'),
    period
  };
}

export function composeTimeValue({ hour12 = '12', minute = '00', period = 'AM' } = {}) {
  const normalizedHour = Math.min(12, Math.max(1, Number(hour12) || 12));
  const normalizedMinute = Math.min(59, Math.max(0, Number(minute) || 0));
  const normalizedPeriod = String(period || 'AM').toUpperCase() === 'PM' ? 'PM' : 'AM';
  let hours24 = normalizedHour % 12;
  if (normalizedPeriod === 'PM') hours24 += 12;
  return `${String(hours24).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
}

export function formatTimeSelectionText(value) {
  const normalized = normalizeTimeValue(value);
  const [hours, minutes] = normalized.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes, 0));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
}

export function shiftTimePartValue(part, value, delta) {
  if (part === 'hour') {
    const index = TIME_HOUR_VALUES.indexOf(String(value || '12'));
    return TIME_HOUR_VALUES[(index + delta + TIME_HOUR_VALUES.length) % TIME_HOUR_VALUES.length];
  }
  if (part === 'minute') {
    const index = TIME_MINUTE_VALUES.indexOf(String(value || '00').padStart(2, '0'));
    return TIME_MINUTE_VALUES[(index + delta + TIME_MINUTE_VALUES.length) % TIME_MINUTE_VALUES.length];
  }
  const index = TIME_PERIOD_VALUES.indexOf(String(value || 'AM').toUpperCase());
  return TIME_PERIOD_VALUES[(Math.max(index, 0) + delta + TIME_PERIOD_VALUES.length) % TIME_PERIOD_VALUES.length];
}
