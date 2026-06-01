import { describe, expect, it } from 'vitest';
import { MUTATION_TYPES, normalizeDesktopSyncSettings, validateMutationEnvelope } from './sync-contracts.js';

describe('sync contracts', () => {
  it('accepts a valid entry save mutation', () => {
    const result = validateMutationEnvelope({
      id: 'm1',
      type: MUTATION_TYPES.ENTRY_SAVE,
      payload: {
        isoDate: '2026-05-11',
        raw: 'Hello world'
      }
    });
    expect(result.ok).toBe(true);
    expect(result.mutation.type).toBe(MUTATION_TYPES.ENTRY_SAVE);
  });

  it('rejects invalid date payloads', () => {
    const result = validateMutationEnvelope({
      id: 'm2',
      type: MUTATION_TYPES.ENTRY_SAVE,
      payload: {
        isoDate: 'bad-date',
        raw: 'Hello world'
      }
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown mutation types', () => {
    const result = validateMutationEnvelope({
      id: 'm3',
      type: 'unknown',
      payload: {}
    });
    expect(result.ok).toBe(false);
  });

  it('normalizes desktop sync settings for per-user cloud libraries', () => {
    const settings = normalizeDesktopSyncSettings({
      userId: 'user-1',
      libraryId: 'library-1',
      deviceId: 'desktop-1',
      hostAvailability: 'cloud-relay',
      mediaFolders: [{
        id: 'photos',
        path: '/Photos',
        cloudPolicy: 'selected-originals'
      }],
      devicePermissions: {
        phone: { canUploadMedia: true }
      }
    });
    expect(settings.userId).toBe('user-1');
    expect(settings.mediaFolders[0].cloudPolicy).toBe('selected-originals');
    expect(settings.devicePermissions.phone.canUploadMedia).toBe(true);
    expect(settings.devicePermissions.phone.canEditEntries).toBe(false);
  });

  it('accepts cloud scoped entry save mutations', () => {
    const result = validateMutationEnvelope({
      id: 'm4',
      type: MUTATION_TYPES.ENTRY_SAVE,
      userId: 'user-1',
      libraryId: 'library-1',
      deviceId: 'phone-1',
      baseCloudVersion: 2,
      payload: {
        isoDate: '2026-05-11',
        raw: 'Cloud entry'
      }
    });
    expect(result.ok).toBe(true);
    expect(result.mutation.userId).toBe('user-1');
    expect(result.mutation.baseCloudVersion).toBe(2);
  });
});
