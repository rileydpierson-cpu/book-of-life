import { TIME_HOUR_VALUES, TIME_MINUTE_VALUES, TIME_PERIOD_VALUES, TIME_SPINNER_CENTER_REPEAT, TIME_SPINNER_REPEAT_COUNT, composeTimeValue, formatTimeSelectionText, getTimeParts, normalizeTimeValue, shiftTimePartValue } from '../../domain/time/index.js';

function buildLaneMarkup(values, part, selectedValue) {
  return Array.from({ length: TIME_SPINNER_REPEAT_COUNT }, (_, repeat) => values.map((value) => {
    const selected = repeat === TIME_SPINNER_CENTER_REPEAT && value === selectedValue;
    return `<button class="time-spinner-option ${selected ? 'is-selected' : ''}" type="button" role="option" aria-selected="${selected ? 'true' : 'false'}" data-time-option="${part}" data-time-value="${value}">${value}</button>`;
  }).join('')).join('');
}

export function createTimePickerModal({ mountNode }) {
  const dom = {
    root: mountNode,
    backdrop: mountNode.querySelector('.calendar-backdrop'),
    window: mountNode.querySelector('.time-window'),
    title: mountNode.querySelector('#timeTitle'),
    subtitle: mountNode.querySelector('#timeSubtitle'),
    helper: mountNode.querySelector('#timeHelperText'),
    selection: mountNode.querySelector('#timeSelectionLabel'),
    confirm: mountNode.querySelector('#timeConfirmButton'),
    cancel: mountNode.querySelector('#timeCancelButton'),
    close: mountNode.querySelector('#timeCloseButton'),
    hourLane: mountNode.querySelector('#timeHourLane'),
    minuteLane: mountNode.querySelector('#timeMinuteLane'),
    periodLane: mountNode.querySelector('#timePeriodLane')
  };

  const state = {
    isOpen: false,
    busy: false,
    title: 'Choose a time',
    subtitle: '',
    helperText: '',
    confirmLabel: 'Confirm',
    selectedTime: '12:00',
    onConfirm: null,
    metadata: null
  };

  function render() {
    if (!state.isOpen) return;
    const parts = getTimeParts(state.selectedTime);
    dom.title.textContent = state.title;
    dom.subtitle.textContent = state.subtitle;
    dom.helper.textContent = state.helperText;
    dom.selection.textContent = formatTimeSelectionText(state.selectedTime);
    dom.confirm.textContent = state.busy ? 'Working...' : state.confirmLabel;
    dom.confirm.disabled = state.busy;
    dom.hourLane.innerHTML = buildLaneMarkup(TIME_HOUR_VALUES, 'hour', parts.hour12);
    dom.minuteLane.innerHTML = buildLaneMarkup(TIME_MINUTE_VALUES, 'minute', parts.minute);
    dom.periodLane.innerHTML = buildLaneMarkup(TIME_PERIOD_VALUES, 'period', parts.period);
  }

  function updatePart(part, value) {
    const parts = getTimeParts(state.selectedTime);
    if (part === 'hour') parts.hour12 = value;
    if (part === 'minute') parts.minute = value;
    if (part === 'period') parts.period = value;
    state.selectedTime = composeTimeValue(parts);
    render();
  }

  async function confirm() {
    if (!state.isOpen || state.busy) return;
    if (typeof state.onConfirm !== 'function') {
      api.close();
      return;
    }
    state.busy = true;
    render();
    try {
      await state.onConfirm(normalizeTimeValue(state.selectedTime), state.metadata || {});
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
      Object.assign(state, {
        isOpen: true,
        busy: false,
        title: options.title || 'Choose a time',
        subtitle: options.subtitle || '',
        helperText: options.helperText || '',
        confirmLabel: options.confirmLabel || 'Confirm',
        selectedTime: normalizeTimeValue(options.initialTime || '12:00'),
        onConfirm: options.onConfirm || null,
        metadata: options.metadata || null
      });
      mountNode.classList.remove('hidden');
      render();
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
  dom.confirm?.addEventListener('click', () => {
    confirm().catch(console.error);
  });
  [dom.hourLane, dom.minuteLane, dom.periodLane].forEach((lane) => {
    lane?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-time-option]');
      if (!option || state.busy) return;
      updatePart(option.dataset.timeOption || '', option.dataset.timeValue || '');
      lane.focus({ preventScroll: true });
    });
  });
  dom.window?.addEventListener('keydown', (event) => {
    if (!state.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      api.close();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      confirm().catch(console.error);
      return;
    }
    const activeLane = document.activeElement?.closest?.('[data-time-lane]');
    if (!activeLane) return;
    const part = activeLane.dataset.timeLane || 'hour';
    const parts = getTimeParts(state.selectedTime);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const currentValue = part === 'hour' ? parts.hour12 : part === 'minute' ? parts.minute : parts.period;
      updatePart(part, shiftTimePartValue(part, currentValue, delta));
    }
  });

  return api;
}
