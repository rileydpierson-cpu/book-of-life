import { addDaysToIso, addMonthsToMonthKey, buildCalendarMonthDays, clampIsoDate, isValidIsoDate, isWithinCalendarRange, monthKeyFromIso, monthStartIso } from '../../domain/calendar/index.js';
import { renderPhIcon } from '../viewer/create-media-viewer.js';

function defaultFormatSelection(isoDate) {
  if (!isValidIsoDate(isoDate)) return 'Choose a date';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function createCalendarModal({ mountNode, services = {} }) {
  const dom = {
    root: mountNode,
    backdrop: mountNode.querySelector('.calendar-backdrop'),
    window: mountNode.querySelector('.calendar-window'),
    title: mountNode.querySelector('#calendarTitle'),
    subtitle: mountNode.querySelector('#calendarSubtitle'),
    monthLabel: mountNode.querySelector('#calendarMonthLabel'),
    prevMonth: mountNode.querySelector('#calendarPrevMonth'),
    nextMonth: mountNode.querySelector('#calendarNextMonth'),
    grid: mountNode.querySelector('#calendarGrid'),
    selection: mountNode.querySelector('#calendarSelectionLabel'),
    helper: mountNode.querySelector('#calendarHelperText'),
    footer: mountNode.querySelector('#calendarFooter'),
    cancel: mountNode.querySelector('#calendarCancelButton'),
    confirm: mountNode.querySelector('#calendarConfirmButton'),
    close: mountNode.querySelector('#calendarCloseButton')
  };

  const state = {
    isOpen: false,
    busy: false,
    context: '',
    selectedDate: '',
    visibleMonth: '',
    minDate: '',
    maxDate: '',
    title: 'Choose a date',
    subtitle: '',
    confirmLabel: 'Confirm',
    helperText: '',
    isDateEnabled: null,
    onConfirm: null,
    metadata: null
  };

  function isEnabled(isoDate) {
    if (!isWithinCalendarRange(isoDate, state.minDate, state.maxDate)) return false;
    if (typeof state.isDateEnabled === 'function') return Boolean(state.isDateEnabled(isoDate));
    return true;
  }

  function firstEnabledDateForMonth(monthKey) {
    return buildCalendarMonthDays(monthKey)
      .filter((entry) => entry.inMonth)
      .find((entry) => isEnabled(entry.isoDate))?.isoDate || '';
  }

  function focusDate(isoDate = state.selectedDate) {
    const target = isValidIsoDate(isoDate) ? dom.grid.querySelector(`[data-calendar-date="${isoDate}"]`) : null;
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      return;
    }
    dom.grid.querySelector('.calendar-day:not(:disabled)')?.focus({ preventScroll: true });
  }

  function render() {
    if (!state.isOpen) return;
    dom.title.textContent = state.title;
    dom.subtitle.textContent = state.subtitle;
    dom.monthLabel.textContent = services.monthLabelForIso
      ? services.monthLabelForIso(monthStartIso(state.visibleMonth))
      : state.visibleMonth;
    dom.selection.textContent = (services.formatSelectionText || defaultFormatSelection)(state.selectedDate);
    dom.helper.textContent = state.helperText;
    dom.confirm.textContent = state.busy ? 'Working...' : state.confirmLabel;
    dom.confirm.disabled = state.busy || !isEnabled(state.selectedDate);
    dom.footer.classList.toggle('hidden', state.context === 'jump-date');
    dom.grid.innerHTML = buildCalendarMonthDays(state.visibleMonth).map(({ isoDate, inMonth }) => {
      const enabled = isEnabled(isoDate);
      const selected = isoDate === state.selectedDate;
      const summary = services.findDaySummary ? services.findDaySummary(isoDate) : { hasJournal: false, hasMedia: false };
      const marker = `${summary.hasJournal ? renderPhIcon('note', { variant: 'duotone' }) : ''}${summary.hasMedia ? renderPhIcon('images-square', { variant: 'duotone' }) : ''}`;
      const classes = [
        'calendar-day',
        inMonth ? '' : 'is-outside-month',
        selected ? 'is-selected' : '',
        enabled ? '' : 'is-disabled',
        (summary.hasJournal || summary.hasMedia) ? 'is-has-content' : ''
      ].filter(Boolean).join(' ');
      return `<button class="${classes}" type="button" role="gridcell" data-calendar-date="${isoDate}" aria-selected="${selected ? 'true' : 'false'}" ${enabled ? '' : 'disabled'}><span class="calendar-day-number">${Number(isoDate.slice(-2))}</span><span class="calendar-day-dot" aria-hidden="true">${marker}</span></button>`;
    }).join('');
  }

  async function confirm() {
    if (!state.isOpen || state.busy || !isEnabled(state.selectedDate)) return;
    if (typeof state.onConfirm !== 'function') {
      api.close();
      return;
    }
    state.busy = true;
    render();
    try {
      await state.onConfirm(state.selectedDate, state.metadata || {});
      api.close();
    } finally {
      if (state.isOpen) {
        state.busy = false;
        render();
      }
    }
  }

  const api = {
    open(options = {}) {
      const fallbackDate = options.initialDate || options.minDate || options.maxDate || '';
      const selectedDate = clampIsoDate(options.initialDate || fallbackDate, options.minDate, options.maxDate);
      Object.assign(state, {
        isOpen: true,
        busy: false,
        context: options.context || '',
        selectedDate,
        visibleMonth: options.visibleMonth || monthKeyFromIso(selectedDate || fallbackDate),
        minDate: isValidIsoDate(options.minDate) ? options.minDate : '',
        maxDate: isValidIsoDate(options.maxDate) ? options.maxDate : '',
        title: options.title || 'Choose a date',
        subtitle: options.subtitle || '',
        confirmLabel: options.confirmLabel || 'Confirm',
        helperText: options.helperText || '',
        isDateEnabled: options.isDateEnabled || null,
        onConfirm: options.onConfirm || null,
        metadata: options.metadata || null
      });
      if (!isEnabled(state.selectedDate)) state.selectedDate = firstEnabledDateForMonth(state.visibleMonth);
      mountNode.classList.remove('hidden');
      render();
      requestAnimationFrame(() => focusDate());
    },
    close() {
      state.isOpen = false;
      mountNode.classList.add('hidden');
    },
    update(patch = {}) {
      Object.assign(state, patch);
      render();
    },
    destroy() {
      mountNode.classList.add('hidden');
    }
  };

  dom.close?.addEventListener('click', () => api.close());
  dom.cancel?.addEventListener('click', () => api.close());
  dom.backdrop?.addEventListener('click', () => api.close());
  dom.prevMonth?.addEventListener('click', () => {
    state.visibleMonth = addMonthsToMonthKey(state.visibleMonth, -1);
    render();
    requestAnimationFrame(() => focusDate());
  });
  dom.nextMonth?.addEventListener('click', () => {
    state.visibleMonth = addMonthsToMonthKey(state.visibleMonth, 1);
    render();
    requestAnimationFrame(() => focusDate());
  });
  dom.confirm?.addEventListener('click', () => {
    confirm().catch(console.error);
  });
  dom.grid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-calendar-date]');
    if (!button || button.disabled) return;
    state.selectedDate = button.dataset.calendarDate || state.selectedDate;
    state.visibleMonth = monthKeyFromIso(state.selectedDate) || state.visibleMonth;
    render();
    if (state.context === 'jump-date') {
      confirm().catch(console.error);
      return;
    }
    focusDate(state.selectedDate);
  });
  dom.window?.addEventListener('keydown', (event) => {
    if (!state.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      api.close();
      return;
    }
    const activeDateButton = document.activeElement?.closest?.('[data-calendar-date]');
    const currentDate = activeDateButton?.dataset.calendarDate || state.selectedDate;
    let nextDate = '';
    if (event.key === 'ArrowLeft') nextDate = addDaysToIso(currentDate, -1);
    if (event.key === 'ArrowRight') nextDate = addDaysToIso(currentDate, 1);
    if (event.key === 'ArrowUp') nextDate = addDaysToIso(currentDate, -7);
    if (event.key === 'ArrowDown') nextDate = addDaysToIso(currentDate, 7);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      confirm().catch(console.error);
      return;
    }
    if (!nextDate) return;
    event.preventDefault();
    state.visibleMonth = monthKeyFromIso(nextDate) || state.visibleMonth;
    if (isEnabled(nextDate)) state.selectedDate = nextDate;
    render();
    focusDate(nextDate);
  });

  return api;
}
