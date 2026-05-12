import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFonts } from 'expo-font';
import { LavishlyYours_400Regular } from '@expo-google-fonts/lavishly-yours';
import { listLocalEntries, listSyncedMediaItems, initializeDatabase } from './src/storage/database';
import { createSyncEngine } from './src/sync/sync-engine';
import { loadConnection } from './src/auth/connection-store';
import { buildTodayIsoDate, saveLocalJournalEntry } from './src/storage/local-journal';
import { listLocalMediaAssets } from './src/storage/local-media-index';
import { listPendingMutations } from './src/sync/mutation-queue';
import { getDeviceFolderSummary, registerDeviceFolder, scanDeviceFolder } from './src/device/device-indexer';
import { cacheRemoteMediaVariant } from './src/media/media-cache';
import { buildMobileLibrarySnapshot, type MediaItemView, type MobileLibrarySnapshot, type TimelineDayView } from './src/app/mobile-library';
import { MobileTopbar } from './src/components/mobile-topbar';
import { TimelineDayCard } from './src/components/timeline-day-card';
import { JournalEditorModal } from './src/components/journal-editor-modal';
import { MediaViewerModal } from './src/components/media-viewer-modal';
import { YearCarousel } from './src/components/year-carousel';
import type { SyncConnection } from './src/sync/types';

type LocalEntryRow = {
  iso_date: string;
  raw: string;
  updated_at: string;
  server_version: number;
  deleted: number;
};

type SyncStatus = {
  lastCheckpoint: number;
  pendingMutations: number;
  localEntries: number;
  localMediaAssets: number;
  pendingMediaUploads: number;
  syncedMediaItems: number;
};

function currentYearStats(days: TimelineDayView[]) {
  const currentYear = new Date().getFullYear();
  const inYear = days.filter((day) => Number(day.isoDate.slice(0, 4)) === currentYear);
  return {
    year: currentYear,
    days: inYear.length,
    media: inYear.reduce((sum, day) => sum + day.syncedMediaCount + day.localMediaCount, 0)
  };
}

function buildEntryMap(rows: LocalEntryRow[]) {
  return new Map(rows.map((row) => [row.iso_date, row]));
}

function matchesSearch(day: TimelineDayView, entry: LocalEntryRow | undefined, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return (
    day.isoDate.toLowerCase().includes(term)
    || day.summary.toLowerCase().includes(term)
    || String(entry?.raw || '').toLowerCase().includes(term)
  );
}

export default function App() {
  const [status, setStatus] = useState('Starting local database...');
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:3000');
  const [secret, setSecret] = useState('');
  const [connection, setConnection] = useState<SyncConnection | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStatus | null>(null);
  const [deviceFolderLabel, setDeviceFolderLabel] = useState('No device folders selected');
  const [entryRows, setEntryRows] = useState<LocalEntryRow[]>([]);
  const [library, setLibrary] = useState<MobileLibrarySnapshot>({
    timelineDays: [],
    mediaItems: [],
    pendingEntryDates: new Set()
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const [syncPanelVisible, setSyncPanelVisible] = useState(false);
  const [entryDate, setEntryDate] = useState('');
  const [entryText, setEntryText] = useState('');
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerItems, setViewerItems] = useState<MediaItemView[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [fontsLoaded] = useFonts({
    LavishlyYours_400Regular
  });

  const syncEngine = useMemo(() => createSyncEngine(), []);

  async function refreshDashboard() {
    const [
      savedConnection,
      folderSummary,
      localEntries,
      syncedMedia,
      localMediaAssets,
      pendingMutations,
      nextSyncStatus
    ] = await Promise.all([
      loadConnection(),
      getDeviceFolderSummary(),
      listLocalEntries(),
      listSyncedMediaItems(600),
      listLocalMediaAssets(),
      listPendingMutations(),
      syncEngine.getStatus()
    ]);

    setConnection(savedConnection);
    setServerUrl(savedConnection?.serverUrl || serverUrl);
    setEntryRows(localEntries);
    setDeviceFolderLabel(
      folderSummary.folders.length
        ? `${folderSummary.folders.length} folder(s), ${folderSummary.assetCount} indexed asset(s)`
        : 'No device folders selected'
    );
    setSyncStats(nextSyncStatus);
    setLibrary(buildMobileLibrarySnapshot({
      entries: localEntries,
      syncedMedia,
      localMedia: localMediaAssets,
      pendingMutations,
      hasConnection: Boolean(savedConnection?.authToken)
    }));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initializeDatabase();
      if (cancelled) return;
      await refreshDashboard();
      if (!cancelled) {
        setStatus('Ready. Journal saves queue sync automatically, and media stays labeled as local, synced, or remote.');
      }
    })().catch((error: Error) => {
      if (!cancelled) setStatus(`Startup failed: ${error.message}`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const entryMap = useMemo(() => buildEntryMap(entryRows), [entryRows]);
  const filteredDays = useMemo(
    () => library.timelineDays.filter((day) => {
      if (activeYear !== null && Number(day.isoDate.slice(0, 4)) !== activeYear) return false;
      return matchesSearch(day, entryMap.get(day.isoDate), searchQuery);
    }),
    [library.timelineDays, entryMap, searchQuery, activeYear]
  );
  const dayMediaMap = useMemo(() => {
    const map = new Map<string, MediaItemView[]>();
    for (const item of library.mediaItems) {
      if (!item.isoDate) continue;
      const bucket = map.get(item.isoDate) || [];
      bucket.push(item);
      map.set(item.isoDate, bucket);
    }
    return map;
  }, [library.mediaItems]);

  const selectedDay = library.timelineDays.find((day) => day.isoDate === entryDate) || null;
  const viewerItem = viewerItems[viewerIndex] || null;
  const heroStats = currentYearStats(library.timelineDays);
  const availableYears = useMemo(
    () => Array.from(new Set(library.timelineDays.map((day) => Number(day.isoDate.slice(0, 4))))).sort((a, b) => b - a),
    [library.timelineDays]
  );

  function openEditorForDay(day: TimelineDayView) {
    setEntryDate(day.isoDate);
    setEntryText(entryMap.get(day.isoDate)?.raw || '');
    setEditorVisible(true);
  }

  function openMediaViewerFromDay(isoDate: string, target: MediaItemView) {
    const items = dayMediaMap.get(isoDate) || [];
    const index = Math.max(0, items.findIndex((item) => item.key === target.key));
    setViewerItems(items);
    setViewerIndex(index);
    setViewerVisible(true);
  }

  async function performConnectedSync(options: { includeBootstrap?: boolean; reason?: string } = {}) {
    const savedConnection = await loadConnection();
    if (!savedConnection) throw new Error('No saved sync connection.');

    const messages: string[] = [];
    if (options.includeBootstrap) {
      const payload = await syncEngine.bootstrap(savedConnection);
      messages.push(`bootstrap ${payload.entries.length} entries`);
    }

    const replay = await syncEngine.replayPendingMutations(savedConnection);
    const uploads = await syncEngine.uploadPendingMedia(savedConnection);
    const pulled = await syncEngine.pullChanges(savedConnection);
    await refreshDashboard();

    messages.push(`entries ${replay.accepted}/${replay.sent}`);
    messages.push(`media ${uploads.uploaded} uploaded`);
    messages.push(`changes ${pulled.changes.length}`);
    setStatus(`${options.reason || 'Sync complete'}: ${messages.join(' | ')}.`);
  }

  async function saveJournal() {
    if (!entryDate) throw new Error('Choose a date before saving.');
    const saved = await saveLocalJournalEntry({
      isoDate: entryDate,
      raw: entryText
    });
    await syncEngine.queueMutation({
      id: `entry-save-${saved.isoDate}-${Date.now()}`,
      type: 'entry.save',
      entityId: saved.isoDate,
      payload: {
        isoDate: saved.isoDate,
        raw: saved.raw
      }
    });
    await refreshDashboard();
    setStatus(`Saved ${saved.isoDate} locally and queued journal sync.`);

    if (connection?.authToken) {
      try {
        await performConnectedSync({ reason: `Journal synced for ${saved.isoDate}` });
      } catch (error) {
        setStatus(`Saved ${saved.isoDate} locally. Sync is pending: ${(error as Error).message}`);
      }
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <MobileTopbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onHomePress={() => {
            setActiveYear(null);
            setSearchQuery('');
          }}
          onDatePress={() => {
            const today = buildTodayIsoDate();
            const existing = library.timelineDays.find((day) => day.isoDate === today);
            openEditorForDay(existing || {
              isoDate: today,
              summary: 'Start writing today.',
              journalStatus: connection?.authToken ? 'synced' : 'local',
              syncedMediaCount: 0,
              localMediaCount: 0,
              remoteOnlyMediaCount: 0,
              hasEntry: false
            });
          }}
          onSettingsPress={() => setSyncPanelVisible((value) => !value)}
          syncEnabled={Boolean(connection?.authToken)}
          pendingCount={syncStats?.pendingMutations || 0}
          dateLabel={activeYear ? String(activeYear) : 'Memory browser'}
        />

        <View style={styles.heroCard}>
          <Text style={[styles.heroTitle, fontsLoaded ? styles.heroTitleScript : null]}>Book of Life</Text>
          <Text style={styles.heroSubtitle}>Your timeline, journal, and media feed in one place.</Text>
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{heroStats.year}</Text>
              <Text style={styles.heroStatLabel}>Year</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{heroStats.days}</Text>
              <Text style={styles.heroStatLabel}>Active Days</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{heroStats.media}</Text>
              <Text style={styles.heroStatLabel}>Media Items</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Years</Text>
          <Text style={styles.sectionSubtitle}>Browse the timeline the way the website does.</Text>
        </View>
        <YearCarousel years={availableYears} activeYear={activeYear} onSelectYear={setActiveYear} />

        {syncPanelVisible ? (
          <View style={styles.syncCard}>
            <Text style={styles.syncTitle}>Sync and Device Media</Text>
            <Text style={styles.syncText}>{status}</Text>
            <Text style={styles.syncMeta}>{connection?.serverUrl || 'No sync connection saved yet.'}</Text>
            <TextInput
              style={styles.syncInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              placeholder="Server URL"
              placeholderTextColor="#7a7366"
            />
            <TextInput
              style={styles.syncInput}
              value={secret}
              onChangeText={setSecret}
              autoCapitalize="none"
              secureTextEntry
              placeholder="Access secret"
              placeholderTextColor="#7a7366"
            />
            <View style={styles.syncButtonColumn}>
              <TouchableOpacity
                style={styles.syncButton}
                onPress={async () => {
                  try {
                    const nextConnection = await syncEngine.connect(serverUrl, secret);
                    setConnection(nextConnection);
                    await refreshDashboard();
                    await performConnectedSync({ includeBootstrap: true, reason: 'Connected and synced' });
                  } catch (error) {
                    setStatus(`Connect failed: ${(error as Error).message}`);
                  }
                }}
              >
                <Text style={styles.syncButtonText}>Connect And Sync</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.syncButton}
                onPress={async () => {
                  try {
                    await performConnectedSync({ reason: 'Manual sync' });
                  } catch (error) {
                    setStatus(`Sync failed: ${(error as Error).message}`);
                  }
                }}
              >
                <Text style={styles.syncButtonText}>Sync Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.syncButton}
                onPress={async () => {
                  try {
                    const folder = await registerDeviceFolder();
                    await refreshDashboard();
                    setStatus(folder ? `Registered folder ${folder.displayName}.` : 'Folder registration cancelled.');
                  } catch (error) {
                    setStatus(`Register folder failed: ${(error as Error).message}`);
                  }
                }}
              >
                <Text style={styles.syncButtonText}>Register Device Folder</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.syncButton}
                onPress={async () => {
                  try {
                    const summary = await getDeviceFolderSummary();
                    if (!summary.folders.length) throw new Error('No device folder registered yet.');
                    for (const folder of summary.folders) {
                      await scanDeviceFolder(folder.id);
                    }
                    await refreshDashboard();
                    setStatus(`Indexed local device media. ${deviceFolderLabel}`);
                    if (connection?.authToken) {
                      await performConnectedSync({ reason: 'Uploaded device media' });
                    }
                  } catch (error) {
                    setStatus(`Scan failed: ${(error as Error).message}`);
                  }
                }}
              >
                <Text style={styles.syncButtonText}>Scan And Upload Media</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.syncMeta}>{deviceFolderLabel}</Text>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          <Text style={styles.sectionSubtitle}>
            {filteredDays.length ? `${filteredDays.length} matching day(s)` : 'No matching days yet'}
          </Text>
        </View>

        <View style={styles.timelineFeed}>
          {filteredDays.map((day) => (
            <TimelineDayCard
              key={day.isoDate}
              day={day}
              mediaItems={dayMediaMap.get(day.isoDate) || []}
              active={day.isoDate === entryDate}
              onPress={() => openEditorForDay(day)}
              onOpenMedia={(item) => openMediaViewerFromDay(day.isoDate, item)}
            />
          ))}
        </View>
      </ScrollView>

      <JournalEditorModal
        visible={editorVisible}
        isoDate={entryDate}
        value={entryText}
        day={selectedDay}
        onChangeDate={setEntryDate}
        onChangeText={setEntryText}
        onClose={() => setEditorVisible(false)}
        onSave={async () => {
          try {
            await saveJournal();
          } catch (error) {
            setStatus(`Save failed: ${(error as Error).message}`);
          }
        }}
      />

      <MediaViewerModal
        visible={viewerVisible}
        item={viewerItem}
        canGoPrev={viewerIndex > 0}
        canGoNext={viewerIndex < viewerItems.length - 1}
        onClose={() => setViewerVisible(false)}
        onPrev={() => setViewerIndex((index) => Math.max(0, index - 1))}
        onNext={() => setViewerIndex((index) => Math.min(viewerItems.length - 1, index + 1))}
        onCacheThumb={async () => {
          if (!viewerItem?.remoteMediaId) return;
          try {
            await cacheRemoteMediaVariant({
              photoId: viewerItem.remoteMediaId,
              fileName: viewerItem.fileName,
              variant: 'thumb'
            });
            await refreshDashboard();
            setStatus(`Cached thumbnail for ${viewerItem.fileName}.`);
          } catch (error) {
            setStatus(`Thumb cache failed: ${(error as Error).message}`);
          }
        }}
        onCachePrimary={async () => {
          if (!viewerItem?.remoteMediaId) return;
          try {
            await cacheRemoteMediaVariant({
              photoId: viewerItem.remoteMediaId,
              fileName: viewerItem.fileName,
              variant: viewerItem.mediaType === 'video' ? 'preview' : 'full'
            });
            await refreshDashboard();
            setStatus(`Cached ${viewerItem.mediaType === 'video' ? 'preview' : 'full'} for ${viewerItem.fileName}.`);
          } catch (error) {
            setStatus(`Media cache failed: ${(error as Error).message}`);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2ede4'
  },
  container: {
    padding: 18,
    gap: 16
  },
  heroCard: {
    backgroundColor: '#fffaf0',
    borderRadius: 24,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#e0d6c2',
    alignItems: 'center'
  },
  heroTitle: {
    fontSize: 42,
    color: '#22201a',
    textAlign: 'center'
  },
  heroTitleScript: {
    fontFamily: 'LavishlyYours_400Regular',
    fontSize: 58,
    lineHeight: 68
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#5a5345',
    textAlign: 'center'
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 12
  },
  heroStat: {
    flex: 1,
    backgroundColor: '#f6efe0',
    borderRadius: 18,
    padding: 14,
    gap: 4
  },
  heroStatValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2a281f'
  },
  heroStatLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#7a7366'
  },
  syncCard: {
    backgroundColor: '#fffaf0',
    borderRadius: 24,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#d8cdb9'
  },
  syncTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2f291f'
  },
  syncText: {
    fontSize: 14,
    color: '#4c463a',
    lineHeight: 20
  },
  syncMeta: {
    fontSize: 13,
    color: '#7a7366'
  },
  syncButtonColumn: {
    gap: 10
  },
  syncInput: {
    borderWidth: 1,
    borderColor: '#d2c7b2',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fffdfa',
    fontSize: 15,
    color: '#2f291f'
  },
  syncButton: {
    backgroundColor: '#2f5f87',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'
  },
  syncButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  sectionHeader: {
    gap: 4,
    marginTop: 4
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#22201a'
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#5a5345'
  },
  timelineFeed: {
    gap: 12,
    paddingBottom: 40
  }
});
