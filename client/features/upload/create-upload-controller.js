import { createStore } from '../../core/store/create-store.js';

export function createUploadController({ store, api, folderPicker, calendarModal, timePicker }) {
  const uploadStore = store || createStore({
    files: [],
    target: { rootId: '0', relativePath: '' },
    busy: false
  });

  return {
    getState() {
      return uploadStore.getState();
    },
    subscribe(listener) {
      return uploadStore.subscribe(listener);
    },
    setFiles(files) {
      uploadStore.setState((state) => ({ ...state, files: Array.from(files || []) }));
    },
    setTarget(target) {
      uploadStore.setState((state) => ({ ...state, target: { ...state.target, ...(target || {}) } }));
      folderPicker?.setSelection(target);
    },
    openDatePicker(options) {
      calendarModal?.open(options);
    },
    openTimePicker(options) {
      timePicker?.open(options);
    },
    async loadRoots() {
      if (!api?.fetchJson) return [];
      const payload = await api.fetchJson('/api/upload/folders');
      folderPicker?.setRoots(payload.roots || []);
      return payload.roots || [];
    }
  };
}
