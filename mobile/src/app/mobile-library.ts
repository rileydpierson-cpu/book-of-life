import { countWords } from '../domain/time';
import { formatLongDateLabel, formatMonthLabel, monthKeyFromIso } from '../domain/calendar';

type EntryRow = {
  iso_date: string;
  raw: string;
  updated_at: string;
  server_version: number;
  deleted: number;
};

type SyncedMediaRow = {
  id: string;
  iso_date: string;
  file_name: string;
  metadata_json: string;
  server_version: number;
  deleted: number;
  cache_path: string;
  pin_state: string;
  cache_updated_at: string;
};

type LocalMediaRow = {
  id: string;
  device_folder_id: string;
  asset_uri: string;
  file_name: string;
  metadata_json: string;
  sync_state: string;
  remote_media_id: string;
  updated_at: string;
};

type PendingMutationRow = {
  id: string;
  type: string;
  entity_id: string;
  payload_json: string;
  base_sequence: number;
  created_at: string;
};

export type TimelineDayView = {
  isoDate: string;
  title: string;
  summary: string;
  journalStatus: 'local' | 'pending' | 'synced';
  syncedMediaCount: number;
  localMediaCount: number;
  remoteOnlyMediaCount: number;
  hasEntry: boolean;
  monthKey: string;
  monthLabel: string;
  year: number;
};

export type MediaItemView = {
  key: string;
  id?: string;
  fileName: string;
  isoDate: string;
  mediaType: string;
  sourceStatus: 'local' | 'synced' | 'remote';
  syncState: string;
  cachePath: string;
  assetUri: string;
  remoteMediaId: string;
  dimensionsLabel: string;
  sizeLabel: string;
  folderLabel: string;
};

export type TimelineListItem = TimelineDayView & {
  mediaItems: MediaItemView[];
};

export type MonthSummaryView = {
  monthKey: string;
  label: string;
  year: number;
  dayCount: number;
  mediaCount: number;
  latestIsoDate: string;
};

export type YearSummaryView = {
  year: number;
  label: string;
  dayCount: number;
  mediaCount: number;
  latestIsoDate: string;
  months: MonthSummaryView[];
};

export type SearchResultView = {
  key: string;
  isoDate: string;
  title: string;
  snippet: string;
  matchSource: 'date' | 'summary' | 'journal' | 'media';
  mediaCount: number;
  hasEntry: boolean;
};

export type ViewerItemView = MediaItemView & {
  title: string;
  subtitle: string;
};

export type EditorEntryView = {
  isoDate: string;
  title: string;
  summary: string;
  raw: string;
  journalStatus: TimelineDayView['journalStatus'];
  mediaItems: MediaItemView[];
  wordCount: number;
  hasEntry: boolean;
};

export type TimelineSectionView = {
  key: string;
  title: string;
  subtitle: string;
  data: TimelineListItem[];
};

export type TimelineSectionIndexView = {
  sectionIndex: number;
  sectionKey: string;
  label: string;
  itemCount: number;
};

export type MobileLibrarySnapshot = {
  timelineDays: TimelineDayView[];
  mediaItems: MediaItemView[];
  timelineItems: TimelineListItem[];
  pendingEntryDates: Set<string>;
  monthSummaries: MonthSummaryView[];
  yearSummaries: YearSummaryView[];
};

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch (error) {
    return {};
  }
}

function summarizeEntry(raw: string) {
  const normalized = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Empty entry';
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function isoDateFromTimestamp(value: unknown) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
}

function incrementCount(map: Map<string, number>, key: string) {
  if (!key) return;
  map.set(key, Number(map.get(key) || 0) + 1);
}

function buildMediaMetadataLabels(metadata: Record<string, unknown>) {
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const size = Number(metadata.size || 0);
  return {
    dimensionsLabel: width && height ? `${width} x ${height}` : 'Unknown size',
    sizeLabel: size ? `${(size / (1024 * 1024)).toFixed(size > 1024 * 1024 ? 1 : 2)} MB` : 'Local size unavailable'
  };
}

function buildTimelineTitle(isoDate: string) {
  return formatLongDateLabel(isoDate) || isoDate;
}

export function buildEntryMap(rows: EntryRow[]) {
  return new Map(rows.map((row) => [row.iso_date, row]));
}

export function buildMobileLibrarySnapshot(input: {
  entries: EntryRow[];
  syncedMedia: SyncedMediaRow[];
  localMedia: LocalMediaRow[];
  pendingMutations: PendingMutationRow[];
  hasConnection: boolean;
}) {
  const pendingEntryDates = new Set(
    (input.pendingMutations || [])
      .filter((mutation) => mutation.type === 'entry.save' && mutation.entity_id)
      .map((mutation) => mutation.entity_id)
  );

  const localByRemoteId = new Map<string, LocalMediaRow>();
  const localMediaItems: MediaItemView[] = [];
  const syncedMediaCountByDate = new Map<string, number>();
  const localMediaCountByDate = new Map<string, number>();
  const remoteOnlyMediaCountByDate = new Map<string, number>();

  for (const item of input.localMedia || []) {
    const metadata = safeParseJson(item.metadata_json);
    const isoDate = isoDateFromTimestamp(metadata.modifiedAt) || isoDateFromTimestamp(metadata.isoDate);
    const labels = buildMediaMetadataLabels(metadata);
    if (item.remote_media_id) localByRemoteId.set(item.remote_media_id, item);
    incrementCount(localMediaCountByDate, isoDate);
    localMediaItems.push({
      key: `local:${item.id}`,
      fileName: item.file_name,
      isoDate,
      mediaType: String(metadata.type || 'media'),
      sourceStatus: item.remote_media_id ? 'synced' : 'local',
      syncState: item.sync_state,
      cachePath: '',
      assetUri: item.asset_uri,
      remoteMediaId: item.remote_media_id || '',
      dimensionsLabel: labels.dimensionsLabel,
      sizeLabel: labels.sizeLabel,
      folderLabel: String(metadata.folderLabel || '')
    });
  }

  const remoteMediaItems: MediaItemView[] = [];
  for (const item of input.syncedMedia || []) {
    const metadata = safeParseJson(item.metadata_json);
    const labels = buildMediaMetadataLabels(metadata);
    const matchingLocal = item.id ? localByRemoteId.get(item.id) : null;
    incrementCount(syncedMediaCountByDate, item.iso_date);
    if (!matchingLocal) incrementCount(remoteOnlyMediaCountByDate, item.iso_date);
    remoteMediaItems.push({
      key: `remote:${item.id}`,
      id: item.id,
      fileName: item.file_name,
      isoDate: item.iso_date || '',
      mediaType: String(metadata.type || 'media'),
      sourceStatus: matchingLocal ? 'synced' : 'remote',
      syncState: matchingLocal?.sync_state || 'remote-only',
      cachePath: item.cache_path || '',
      assetUri: matchingLocal?.asset_uri || '',
      remoteMediaId: item.id,
      dimensionsLabel: labels.dimensionsLabel,
      sizeLabel: labels.sizeLabel,
      folderLabel: String(metadata.folder || '')
    });
  }

  const dayMap = new Map<string, TimelineDayView>();
  for (const entry of input.entries || []) {
    if (!entry.iso_date) continue;
    const monthKey = monthKeyFromIso(entry.iso_date);
    dayMap.set(entry.iso_date, {
      isoDate: entry.iso_date,
      title: buildTimelineTitle(entry.iso_date),
      summary: summarizeEntry(entry.raw),
      journalStatus: pendingEntryDates.has(entry.iso_date)
        ? 'pending'
        : (input.hasConnection ? 'synced' : 'local'),
      syncedMediaCount: Number(syncedMediaCountByDate.get(entry.iso_date) || 0),
      localMediaCount: Number(localMediaCountByDate.get(entry.iso_date) || 0),
      remoteOnlyMediaCount: Number(remoteOnlyMediaCountByDate.get(entry.iso_date) || 0),
      hasEntry: true,
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      year: Number(entry.iso_date.slice(0, 4))
    });
  }

  for (const [isoDate, count] of syncedMediaCountByDate.entries()) {
    if (!isoDate) continue;
    const current = dayMap.get(isoDate);
    if (current) {
      current.syncedMediaCount = count;
      current.localMediaCount = Number(localMediaCountByDate.get(isoDate) || 0);
      current.remoteOnlyMediaCount = Number(remoteOnlyMediaCountByDate.get(isoDate) || 0);
      continue;
    }
    const monthKey = monthKeyFromIso(isoDate);
    dayMap.set(isoDate, {
      isoDate,
      title: buildTimelineTitle(isoDate),
      summary: 'Media activity',
      journalStatus: input.hasConnection ? 'synced' : 'local',
      syncedMediaCount: count,
      localMediaCount: Number(localMediaCountByDate.get(isoDate) || 0),
      remoteOnlyMediaCount: Number(remoteOnlyMediaCountByDate.get(isoDate) || 0),
      hasEntry: false,
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      year: Number(isoDate.slice(0, 4))
    });
  }

  for (const [isoDate, count] of localMediaCountByDate.entries()) {
    if (!isoDate || dayMap.has(isoDate)) continue;
    const monthKey = monthKeyFromIso(isoDate);
    dayMap.set(isoDate, {
      isoDate,
      title: buildTimelineTitle(isoDate),
      summary: 'Local media only',
      journalStatus: 'local',
      syncedMediaCount: Number(syncedMediaCountByDate.get(isoDate) || 0),
      localMediaCount: count,
      remoteOnlyMediaCount: Number(remoteOnlyMediaCountByDate.get(isoDate) || 0),
      hasEntry: false,
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      year: Number(isoDate.slice(0, 4))
    });
  }

  const timelineDays = Array.from(dayMap.values()).sort((left, right) => right.isoDate.localeCompare(left.isoDate));
  const mediaItems = [...localMediaItems, ...remoteMediaItems].sort(
    (left, right) => right.isoDate.localeCompare(left.isoDate) || left.fileName.localeCompare(right.fileName)
  );
  const dayMediaMap = new Map<string, MediaItemView[]>();
  for (const item of mediaItems) {
    if (!item.isoDate) continue;
    const bucket = dayMediaMap.get(item.isoDate) || [];
    bucket.push(item);
    dayMediaMap.set(item.isoDate, bucket);
  }

  const timelineItems = timelineDays.map((day) => ({
    ...day,
    mediaItems: dayMediaMap.get(day.isoDate) || []
  }));

  const monthSummaryMap = new Map<string, MonthSummaryView>();
  for (const item of timelineItems) {
    const existing = monthSummaryMap.get(item.monthKey);
    const mediaCount = item.syncedMediaCount + item.localMediaCount;
    if (!existing) {
      monthSummaryMap.set(item.monthKey, {
        monthKey: item.monthKey,
        label: item.monthLabel,
        year: item.year,
        dayCount: 1,
        mediaCount,
        latestIsoDate: item.isoDate
      });
      continue;
    }
    existing.dayCount += 1;
    existing.mediaCount += mediaCount;
    if (item.isoDate > existing.latestIsoDate) existing.latestIsoDate = item.isoDate;
  }

  const monthSummaries = Array.from(monthSummaryMap.values()).sort((left, right) => right.monthKey.localeCompare(left.monthKey));
  const yearSummaryMap = new Map<number, YearSummaryView>();
  for (const month of monthSummaries) {
    const existing = yearSummaryMap.get(month.year);
    if (!existing) {
      yearSummaryMap.set(month.year, {
        year: month.year,
        label: String(month.year),
        dayCount: month.dayCount,
        mediaCount: month.mediaCount,
        latestIsoDate: month.latestIsoDate,
        months: [month]
      });
      continue;
    }
    existing.dayCount += month.dayCount;
    existing.mediaCount += month.mediaCount;
    existing.months.push(month);
    if (month.latestIsoDate > existing.latestIsoDate) existing.latestIsoDate = month.latestIsoDate;
  }

  const yearSummaries = Array.from(yearSummaryMap.values())
    .sort((left, right) => right.year - left.year)
    .map((year) => ({
      ...year,
      months: year.months.sort((left, right) => right.monthKey.localeCompare(left.monthKey))
    }));

  return {
    timelineDays,
    mediaItems,
    timelineItems,
    pendingEntryDates,
    monthSummaries,
    yearSummaries
  } satisfies MobileLibrarySnapshot;
}

export function buildTimelineSections(snapshot: MobileLibrarySnapshot, options: { year?: number | null } = {}) {
  const source = options.year
    ? snapshot.timelineItems.filter((item) => item.year === options.year)
    : snapshot.timelineItems;
  const sectionMap = new Map<string, TimelineSectionView>();

  for (const item of source) {
    const existing = sectionMap.get(item.monthKey);
    if (!existing) {
      sectionMap.set(item.monthKey, {
        key: item.monthKey,
        title: item.monthLabel,
        subtitle: `${item.year}`,
        data: [item]
      });
      continue;
    }
    existing.data.push(item);
  }

  return Array.from(sectionMap.values())
    .sort((left, right) => right.key.localeCompare(left.key))
    .map((section) => ({
      ...section,
      data: section.data.sort((left, right) => right.isoDate.localeCompare(left.isoDate))
    }));
}

export function buildTimelineSectionIndex(sections: TimelineSectionView[]) {
  return sections.map((section, sectionIndex) => ({
    sectionIndex,
    sectionKey: section.key,
    label: section.title,
    itemCount: section.data.length
  })) satisfies TimelineSectionIndexView[];
}

export function timelineSectionIndexFromProgress(sectionIndex: TimelineSectionIndexView[], progress: number) {
  if (!sectionIndex.length) return -1;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return Math.min(sectionIndex.length - 1, Math.round(clamped * (sectionIndex.length - 1)));
}

export function searchMobileLibrary(input: {
  snapshot: MobileLibrarySnapshot;
  entryRows: EntryRow[];
  query: string;
}) {
  const term = String(input.query || '').trim().toLowerCase();
  if (!term) return [] as SearchResultView[];

  const entryMap = buildEntryMap(input.entryRows);
  const results: SearchResultView[] = [];

  for (const item of input.snapshot.timelineItems) {
    const entry = entryMap.get(item.isoDate);
    const raw = String(entry?.raw || '');
    const mediaText = item.mediaItems.map((media) => media.fileName).join(' ').toLowerCase();
    let matchSource: SearchResultView['matchSource'] | null = null;
    let snippet = item.summary;

    if (item.isoDate.toLowerCase().includes(term)) {
      matchSource = 'date';
      snippet = item.title;
    } else if (item.summary.toLowerCase().includes(term)) {
      matchSource = 'summary';
      snippet = item.summary;
    } else if (raw.toLowerCase().includes(term)) {
      matchSource = 'journal';
      const matchIndex = raw.toLowerCase().indexOf(term);
      const excerptStart = Math.max(0, matchIndex - 48);
      const excerptEnd = Math.min(raw.length, matchIndex + term.length + 96);
      snippet = raw.slice(excerptStart, excerptEnd).replace(/\s+/g, ' ').trim();
    } else if (mediaText.includes(term)) {
      matchSource = 'media';
      snippet = item.mediaItems.map((media) => media.fileName).slice(0, 3).join(' • ');
    }

    if (!matchSource) continue;

    results.push({
      key: `${matchSource}:${item.isoDate}`,
      isoDate: item.isoDate,
      title: item.title,
      snippet,
      matchSource,
      mediaCount: item.mediaItems.length,
      hasEntry: item.hasEntry
    });
  }

  return results.sort((left, right) => right.isoDate.localeCompare(left.isoDate));
}

export function buildEditorEntry(input: {
  snapshot: MobileLibrarySnapshot;
  entryRows: EntryRow[];
  isoDate: string;
}) {
  const entry = buildEntryMap(input.entryRows).get(input.isoDate);
  const day = input.snapshot.timelineItems.find((item) => item.isoDate === input.isoDate);
  const raw = String(entry?.raw || '');
  return {
    isoDate: input.isoDate,
    title: buildTimelineTitle(input.isoDate),
    summary: summarizeEntry(raw) || day?.summary || 'Start writing today.',
    raw,
    journalStatus: day?.journalStatus || 'local',
    mediaItems: day?.mediaItems || [],
    wordCount: countWords(raw),
    hasEntry: Boolean(day?.hasEntry || raw.trim())
  } satisfies EditorEntryView;
}

export function buildViewerSequence(input: {
  snapshot: MobileLibrarySnapshot;
  isoDate?: string;
}) {
  const source = input.isoDate
    ? input.snapshot.mediaItems.filter((item) => item.isoDate === input.isoDate)
    : input.snapshot.mediaItems;

  return source.map((item) => ({
    ...item,
    title: item.fileName,
    subtitle: `${item.isoDate || 'No date'} • ${item.mediaType}`
  })) satisfies ViewerItemView[];
}
