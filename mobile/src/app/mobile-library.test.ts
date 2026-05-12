import { describe, expect, it } from 'vitest';
import {
  buildMobileLibrarySnapshot,
  buildTimelineSectionIndex,
  buildTimelineSections,
  searchMobileLibrary,
  timelineSectionIndexFromProgress
} from './mobile-library';

describe('mobile library view models', () => {
  const snapshot = buildMobileLibrarySnapshot({
    entries: [
      { iso_date: '2026-05-10', raw: 'Temple trip with friends and photos', updated_at: '', server_version: 0, deleted: 0 },
      { iso_date: '2026-04-22', raw: 'Quiet day at home', updated_at: '', server_version: 0, deleted: 0 }
    ],
    syncedMedia: [
      { id: 'photo-1', iso_date: '2026-05-10', file_name: 'temple.jpg', metadata_json: '{"type":"photo","width":1200,"height":900}', server_version: 0, deleted: 0, cache_path: '', pin_state: '', cache_updated_at: '' }
    ],
    localMedia: [
      { id: 'local-1', device_folder_id: 'folder-1', asset_uri: 'file://local.mov', file_name: 'family.mov', metadata_json: '{"type":"video","modifiedAt":"2026-05-10T12:00:00.000Z"}', sync_state: 'local-only', remote_media_id: '', updated_at: '' }
    ],
    pendingMutations: [
      { id: 'mut-1', type: 'entry.save', entity_id: '2026-05-10', payload_json: '{}', base_sequence: 0, created_at: '' }
    ],
    hasConnection: true
  });

  it('builds grouped sections and year summaries', () => {
    const sections = buildTimelineSections(snapshot);
    expect(snapshot.yearSummaries[0]?.year).toBe(2026);
    expect(sections[0]?.data[0]?.isoDate).toBe('2026-05-10');
  });

  it('builds stable section index labels and progress mapping', () => {
    const sections = buildTimelineSections(snapshot);
    const sectionIndex = buildTimelineSectionIndex(sections);
    expect(sectionIndex.map((item) => item.sectionKey)).toEqual(['2026-05', '2026-04']);
    expect(sectionIndex[0]?.label).toBe('May 2026');
    expect(timelineSectionIndexFromProgress(sectionIndex, 0)).toBe(0);
    expect(timelineSectionIndexFromProgress(sectionIndex, 1)).toBe(1);
  });

  it('returns local search results across journal and media text', () => {
    const results = searchMobileLibrary({
      snapshot,
      entryRows: [
        { iso_date: '2026-05-10', raw: 'Temple trip with friends and photos', updated_at: '', server_version: 0, deleted: 0 },
        { iso_date: '2026-04-22', raw: 'Quiet day at home', updated_at: '', server_version: 0, deleted: 0 }
      ],
      query: 'temple'
    });
    expect(results[0]?.isoDate).toBe('2026-05-10');
    expect(results[0]?.matchSource).toMatch(/summary|journal|media/);
  });
});
