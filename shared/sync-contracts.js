const MUTATION_TYPES = Object.freeze({
  ENTRY_SAVE: 'entry.save',
  ENTRY_DELETE: 'entry.delete',
  FOLDER_CREATE: 'folder.create',
  MEDIA_TAGS_SET: 'media.tags.set',
  MEDIA_DESCRIPTION_SET: 'media.description.set',
  MEDIA_LIKE_SET: 'media.like.set',
  MEDIA_DATE_TIME_SET: 'media.date-time.set',
  MEDIA_RENAME: 'media.rename',
  MEDIA_MOVE: 'media.move',
  MEDIA_DELETE: 'media.delete'
});

const CHANGE_TYPES = Object.freeze({
  SNAPSHOT: 'snapshot',
  ENTRY_UPSERT: 'entry.upsert',
  ENTRY_DELETE: 'entry.delete',
  MEDIA_UPSERT: 'media.upsert',
  MEDIA_DELETE: 'media.delete',
  FOLDER_UPSERT: 'folder.upsert'
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function normalizeMutationEnvelope(value) {
  if (!isObject(value)) return null;
  const id = String(value.id || '').trim();
  const type = String(value.type || '').trim();
  const clientTimestamp = String(value.clientTimestamp || '').trim();
  const payload = isObject(value.payload) ? value.payload : {};
  if (!id || !type) return null;
  return {
    id,
    type,
    entityId: String(value.entityId || '').trim(),
    baseSequence: Number.isFinite(Number(value.baseSequence)) ? Number(value.baseSequence) : 0,
    clientTimestamp,
    payload
  };
}

function validateMutationEnvelope(envelope) {
  const normalized = normalizeMutationEnvelope(envelope);
  if (!normalized) return { ok: false, error: 'Invalid mutation envelope.' };
  const { type, payload } = normalized;
  switch (type) {
    case MUTATION_TYPES.ENTRY_SAVE:
      if (!isValidIsoDate(payload.isoDate) || typeof payload.raw !== 'string') return { ok: false, error: 'Invalid entry.save payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.ENTRY_DELETE:
      if (!isValidIsoDate(payload.isoDate)) return { ok: false, error: 'Invalid entry.delete payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.FOLDER_CREATE:
      if (typeof payload.rootId !== 'string' || typeof payload.relativePath !== 'string' || typeof payload.folderName !== 'string') return { ok: false, error: 'Invalid folder.create payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_TAGS_SET:
      if (typeof payload.photoId !== 'string' || !Array.isArray(payload.tags)) return { ok: false, error: 'Invalid media.tags.set payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_DESCRIPTION_SET:
      if (typeof payload.photoId !== 'string' || typeof payload.description !== 'string') return { ok: false, error: 'Invalid media.description.set payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_LIKE_SET:
      if (typeof payload.photoId !== 'string' || typeof payload.liked !== 'boolean') return { ok: false, error: 'Invalid media.like.set payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_DATE_TIME_SET:
      if (typeof payload.photoId !== 'string') return { ok: false, error: 'Invalid media.date-time.set payload.' };
      if (payload.isoDate && !isValidIsoDate(payload.isoDate)) return { ok: false, error: 'Invalid media.date-time.set date.' };
      if (payload.time && !isValidTime(payload.time)) return { ok: false, error: 'Invalid media.date-time.set time.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_RENAME:
      if (typeof payload.photoId !== 'string' || typeof payload.baseName !== 'string') return { ok: false, error: 'Invalid media.rename payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_MOVE:
      if (typeof payload.photoId !== 'string' || typeof payload.rootId !== 'string' || typeof payload.relativePath !== 'string') return { ok: false, error: 'Invalid media.move payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_DELETE:
      if (typeof payload.photoId !== 'string') return { ok: false, error: 'Invalid media.delete payload.' };
      return { ok: true, mutation: normalized };
    default:
      return { ok: false, error: `Unsupported mutation type: ${type}` };
  }
}

module.exports = {
  MUTATION_TYPES,
  CHANGE_TYPES,
  normalizeMutationEnvelope,
  validateMutationEnvelope,
  isValidIsoDate,
  isValidTime
};
