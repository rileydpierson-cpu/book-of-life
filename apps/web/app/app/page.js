'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, isBrowserSupabaseConfigured } from '../../utils/supabase/client.js';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'editor', label: 'Editor' },
  { id: 'media', label: 'Media' },
  { id: 'folders', label: 'Folders' },
  { id: 'devices', label: 'Devices' },
  { id: 'settings', label: 'Settings' }
];

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKeyFromIso(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || '')) ? isoDate.slice(0, 7) : todayIso().slice(0, 7);
}

function buildCalendarMonthDays(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const firstGridDate = new Date(firstDay);
  firstGridDate.setUTCDate(firstGridDate.getUTCDate() - firstDay.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDate);
    date.setUTCDate(firstGridDate.getUTCDate() + index);
    const isoDate = [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
    return { isoDate, inMonth: isoDate.startsWith(monthKey) };
  });
}

function addMonths(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function wordCount(raw) {
  return String(raw || '').trim().split(/\s+/).filter(Boolean).length;
}

function entryTitle(entry) {
  const firstLine = String(entry?.raw || '').split(/\r?\n/).find((line) => line.trim());
  return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 80) : 'Untitled entry';
}

function formatMonthTitle(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export default function WebAppPage() {
  const supabase = useMemo(() => (isBrowserSupabaseConfigured() ? createClient() : null), []);
  const [activeTab, setActiveTab] = useState('timeline');
  const [user, setUser] = useState(null);
  const [libraryId, setLibraryId] = useState('');
  const [libraryName, setLibraryName] = useState('Book of Life');
  const [isoDate, setIsoDate] = useState(todayIso());
  const [calendarMonth, setCalendarMonth] = useState(monthKeyFromIso(todayIso()));
  const [raw, setRaw] = useState('');
  const [entries, setEntries] = useState([]);
  const [media, setMedia] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [devices, setDevices] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Checking your cloud session...');
  const [busy, setBusy] = useState(false);
  const loadEverythingRef = useRef(null);
  const realtimeTimerRef = useRef(null);

  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.isoDate, entry])), [entries]);
  const selectedEntry = entryMap.get(isoDate) || null;
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) => {
      return entry.isoDate.includes(normalized) ||
        String(entry.raw || '').toLowerCase().includes(normalized);
    });
  }, [entries, query]);
  const calendarDays = useMemo(() => buildCalendarMonthDays(calendarMonth), [calendarMonth]);
  const summary = useMemo(() => {
    const words = entries.reduce((sum, entry) => sum + wordCount(entry.raw), 0);
    return {
      entries: entries.length,
      words,
      media: media.length,
      devices: devices.length
    };
  }, [entries, media, devices]);
  const mediaByDate = useMemo(() => {
    const map = new Map();
    for (const item of media) {
      const key = item.isoDate || item.metadata?.isoDate || '';
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }, [media]);
  const folderGroups = useMemo(() => {
    const groups = new Map();
    for (const item of media) {
      const folder = item.metadata?.folder || item.metadata?.relative_path || 'Unfiled';
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(item);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [media]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!supabase) {
        setStatus('Supabase environment variables are not configured yet.');
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        setStatus('Sign in to open your cloud library.');
        return;
      }
      setUser(data.user);
      await loadEverything();
    }
    boot().catch((error) => setStatus(error.message));
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function ensureLibrary() {
    if (!supabase) throw new Error('Supabase environment variables are not configured yet.');
    if (libraryId) return libraryId;
    const response = await fetch('/api/libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: libraryName || 'Book of Life' })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not create library.');
    setLibraryId(payload.library.id);
    setLibraryName(payload.library.name || 'Book of Life');
    return payload.library.id;
  }

  async function loadEverything() {
    setBusy(true);
    try {
      setStatus('Syncing cloud library...');
      const activeLibraryId = await ensureLibrary();
      const [entriesPayload, mediaPayload, devicesPayload, hostsPayload] = await Promise.all([
        fetchJson(`/api/entries?libraryId=${encodeURIComponent(activeLibraryId)}`),
        fetchJson(`/api/media?libraryId=${encodeURIComponent(activeLibraryId)}`),
        fetchJson(`/api/devices?libraryId=${encodeURIComponent(activeLibraryId)}`),
        fetchJson(`/api/hosts?libraryId=${encodeURIComponent(activeLibraryId)}`)
      ]);
      const nextEntries = entriesPayload.entries || [];
      setEntries(nextEntries);
      setMedia(mediaPayload.media || []);
      setDevices(devicesPayload.devices || []);
      setHosts(hostsPayload.hosts || []);
      const matching = nextEntries.find((entry) => entry.isoDate === isoDate) || nextEntries[0] || null;
      if (matching) {
        setIsoDate(matching.isoDate);
        setCalendarMonth(monthKeyFromIso(matching.isoDate));
        setRaw(matching.raw || '');
      }
      setStatus(`Synced ${nextEntries.length} entries.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  loadEverythingRef.current = loadEverything;

  useEffect(() => {
    if (!supabase || !libraryId) return undefined;
    const channel = supabase
      .channel(`book-of-life-sync-${libraryId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sync_changes',
          filter: `library_id=eq.${libraryId}`
        },
        () => {
          if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
          realtimeTimerRef.current = setTimeout(() => {
            realtimeTimerRef.current = null;
            loadEverythingRef.current?.();
          }, 900);
        }
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setStatus('Realtime sync connected.');
      });

    return () => {
      if (realtimeTimerRef.current) {
        clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [supabase, libraryId]);

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  async function saveEntry() {
    setBusy(true);
    try {
      const activeLibraryId = await ensureLibrary();
      const baseCloudVersion = selectedEntry?.cloudVersion || 0;
      const payload = await fetchJson('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryId: activeLibraryId, isoDate, raw, baseCloudVersion })
      });
      setEntries((current) => {
        const without = current.filter((entry) => entry.isoDate !== payload.entry.isoDate);
        return [payload.entry, ...without].sort((a, b) => b.isoDate.localeCompare(a.isoDate));
      });
      setCalendarMonth(monthKeyFromIso(isoDate));
      setStatus(`Saved ${isoDate} at cloud version ${payload.entry.cloudVersion}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  function selectEntry(entry, nextTab = activeTab) {
    setIsoDate(entry.isoDate);
    setCalendarMonth(monthKeyFromIso(entry.isoDate));
    setRaw(entry.raw || '');
    setActiveTab(nextTab);
  }

  function selectDate(nextIsoDate, nextTab = 'editor') {
    const entry = entryMap.get(nextIsoDate);
    setIsoDate(nextIsoDate);
    setCalendarMonth(monthKeyFromIso(nextIsoDate));
    setRaw(entry?.raw || '');
    setActiveTab(nextTab);
  }

  return (
    <main className="app-shell">
      <nav className="topbar app-topbar">
        <Link className="brand" href="/">Book of Life</Link>
        <div className="nav-actions">
          <span className="session-label">{user?.email || 'Not signed in'}</span>
          <button className="button small secondary" type="button" onClick={loadEverything} disabled={busy}>Sync</button>
          <button className="button small" type="button" onClick={signOut}>Sign out</button>
        </div>
      </nav>

      <section className="library-header">
        <div>
          <p className="eyebrow">Cloud library</p>
          <h1>{libraryName || 'Book of Life'}</h1>
        </div>
        <div className="stats-grid">
          <Stat label="Entries" value={summary.entries} />
          <Stat label="Words" value={summary.words} />
          <Stat label="Media" value={summary.media} />
          <Stat label="Devices" value={summary.devices} />
        </div>
      </section>

      <section className="webapp-layout">
        <aside className="app-sidebar">
          <div className="tab-list" role="tablist" aria-label="Library views">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <label className="search-box">
            Search entries
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Date, word, phrase" />
          </label>
          <p className="status compact">{status}</p>
        </aside>

        <section className="tab-panel">
          {activeTab === 'timeline' ? (
            <TimelineView
              entries={filteredEntries}
              mediaByDate={mediaByDate}
              libraryId={libraryId}
              onSelect={(entry) => selectEntry(entry, 'editor')}
              onOpenMedia={setSelectedMedia}
            />
          ) : null}
          {activeTab === 'calendar' ? (
            <CalendarView
              calendarDays={calendarDays}
              calendarMonth={calendarMonth}
              entryMap={entryMap}
              onMonthChange={setCalendarMonth}
              onSelectDate={selectDate}
            />
          ) : null}
          {activeTab === 'editor' ? (
            <EditorView
              isoDate={isoDate}
              raw={raw}
              selectedEntry={selectedEntry}
              busy={busy}
              onDateChange={(nextIsoDate) => selectDate(nextIsoDate, 'editor')}
              onRawChange={setRaw}
              onSave={saveEntry}
            />
          ) : null}
          {activeTab === 'media' ? (
            <MediaView
              media={media}
              hosts={hosts}
              libraryId={libraryId}
              onOpenMedia={setSelectedMedia}
              onActionComplete={loadEverything}
            />
          ) : null}
          {activeTab === 'folders' ? (
            <FoldersView
              groups={folderGroups}
              libraryId={libraryId}
              onOpenMedia={setSelectedMedia}
            />
          ) : null}
          {activeTab === 'devices' ? <DevicesView devices={devices} hosts={hosts} /> : null}
          {activeTab === 'settings' ? (
            <SettingsView
              libraryId={libraryId}
              libraryName={libraryName}
              onLibraryIdChange={setLibraryId}
              onLibraryNameChange={setLibraryName}
            />
          ) : null}
        </section>
      </section>
      {selectedMedia ? (
        <MediaViewer
          item={selectedMedia}
          libraryId={libraryId}
          onClose={() => setSelectedMedia(null)}
          onActionComplete={loadEverything}
        />
      ) : null}
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function variantUrl(libraryId, item, variant) {
  if (!libraryId || !item?.id) return '';
  return `/api/media/${encodeURIComponent(item.id)}/variant/${encodeURIComponent(variant)}?libraryId=${encodeURIComponent(libraryId)}`;
}

function pendingActionCount(item) {
  return Array.isArray(item?.metadata?.pendingActions) ? item.metadata.pendingActions.length : 0;
}

function TimelineView({ entries, mediaByDate, libraryId, onSelect, onOpenMedia }) {
  if (!entries.length) {
    return <EmptyState title="No timeline entries yet" message="Create an entry in the editor and it will appear here." />;
  }
  return (
    <div className="timeline-view">
      {entries.map((entry) => {
        const dayMedia = mediaByDate.get(entry.isoDate) || [];
        return (
          <article className="timeline-card" key={entry.isoDate}>
            <div className="timeline-date">
              <strong>{entry.isoDate}</strong>
              <span>v{entry.cloudVersion}</span>
              {dayMedia.length ? <span>{dayMedia.length} media</span> : null}
            </div>
            <div>
              <h2>{entryTitle(entry)}</h2>
              <p>{String(entry.raw || '').replace(/\s+/g, ' ').slice(0, 240) || 'No text yet.'}</p>
              {dayMedia.length ? (
                <div className="timeline-media-strip">
                  {dayMedia.slice(0, 8).map((item) => (
                    <button className="thumb-button" key={item.id} type="button" onClick={() => onOpenMedia(item)}>
                      <img src={variantUrl(libraryId, item, 'thumb')} alt={item.fileName || 'Media'} loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : null}
              <button className="button small secondary" type="button" onClick={() => onSelect(entry)}>Edit</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function FoldersView({ groups, libraryId, onOpenMedia }) {
  if (!groups.length) {
    return <EmptyState title="No folders yet" message="Desktop media metadata will fill this view after sync." />;
  }
  return (
    <div className="folder-list">
      {groups.map(([folder, items]) => (
        <section className="folder-group" key={folder}>
          <div className="folder-heading">
            <h2>{folder}</h2>
            <span>{items.length} item{items.length === 1 ? '' : 's'}</span>
          </div>
          <div className="media-grid compact">
            {items.map((item) => (
              <MediaCard key={item.id} item={item} libraryId={libraryId} onOpen={() => onOpenMedia(item)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CalendarView({ calendarDays, calendarMonth, entryMap, onMonthChange, onSelectDate }) {
  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <button className="button small secondary" type="button" onClick={() => onMonthChange(addMonths(calendarMonth, -1))}>Previous</button>
        <h2>{formatMonthTitle(calendarMonth)}</h2>
        <button className="button small secondary" type="button" onClick={() => onMonthChange(addMonths(calendarMonth, 1))}>Next</button>
      </div>
      <div className="calendar-weekdays">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {calendarDays.map((day) => {
          const entry = entryMap.get(day.isoDate);
          return (
            <button
              className={`calendar-day ${day.inMonth ? '' : 'muted'} ${entry ? 'has-entry' : ''}`}
              key={day.isoDate}
              type="button"
              onClick={() => onSelectDate(day.isoDate, entry ? 'editor' : 'editor')}
            >
              <span>{Number(day.isoDate.slice(-2))}</span>
              {entry ? <small>{wordCount(entry.raw)} words</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditorView({ isoDate, raw, selectedEntry, busy, onDateChange, onRawChange, onSave }) {
  return (
    <div className="editor-pane rich-editor">
      <div className="editor-toolbar">
        <label>
          Entry date
          <input value={isoDate} onChange={(event) => onDateChange(event.target.value)} />
        </label>
        <div className="editor-actions">
          <span className="session-label">{selectedEntry ? `Cloud v${selectedEntry.cloudVersion}` : 'New cloud entry'}</span>
          <button className="button" type="button" onClick={onSave} disabled={busy}>Save to cloud</button>
        </div>
      </div>
      <textarea value={raw} onChange={(event) => onRawChange(event.target.value)} placeholder="Write today's entry..." />
    </div>
  );
}

function MediaView({ media, hosts, libraryId, onOpenMedia, onActionComplete }) {
  if (!media.length) {
    return (
      <EmptyState
        title="No cloud media metadata yet"
        message="Desktop and mobile uploads will fill this view with thumbnails, previews, host availability, and selected originals."
      />
    );
  }
  return (
    <div className="media-grid">
      {media.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          libraryId={libraryId}
          onOpen={() => onOpenMedia(item)}
          onActionComplete={onActionComplete}
        />
      ))}
      {hosts.length ? <p className="status">Online hosts: {hosts.map((host) => host.device_name).join(', ')}</p> : null}
    </div>
  );
}

function MediaCard({ item, libraryId, onOpen, onActionComplete = null }) {
  return (
    <article className="media-card">
      <button className="media-thumb image" type="button" onClick={onOpen}>
        <img src={variantUrl(libraryId, item, 'thumb')} alt={item.fileName || 'Media'} loading="lazy" />
      </button>
      <h2>{item.fileName || 'Untitled media'}</h2>
      <p>{item.isoDate || 'No date'}</p>
      <div className="pill-row">
        <span>{item.hasThumb ? 'Thumb' : 'No thumb'}</span>
        <span>{item.hasPreview ? 'Preview' : 'No preview'}</span>
        <span>{item.originalInCloud ? 'Cloud original' : 'Host original'}</span>
        {pendingActionCount(item) ? <span>{pendingActionCount(item)} pending</span> : null}
      </div>
      {onActionComplete ? (
        <button className="button small secondary" type="button" onClick={onOpen}>Open</button>
      ) : null}
    </article>
  );
}

function MediaViewer({ item, libraryId, onClose, onActionComplete }) {
  const [status, setStatus] = useState('');
  const [description, setDescription] = useState(item.metadata?.description || '');
  const [tags, setTags] = useState(Array.isArray(item.metadata?.tags) ? item.metadata.tags.join(', ') : '');
  const isVideo = item.metadata?.type === 'video' || item.fileName?.toLowerCase().match(/\.(mp4|mov|m4v|webm)$/);
  const source = variantUrl(libraryId, item, isVideo ? 'preview' : 'full');

  async function queueAction(actionType, payload) {
    setStatus('Queued for desktop...');
    const response = await fetch('/api/media/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryId, mediaId: item.id, actionType, payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Media action failed.');
    setStatus('Pending desktop sync.');
    await onActionComplete();
  }

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true">
      <div className="viewer-panel">
        <div className="viewer-toolbar">
          <div>
            <h2>{item.fileName || 'Media'}</h2>
            <p>{item.isoDate || 'No date'} · {item.metadata?.folder || 'No folder'}</p>
          </div>
          <button className="button small secondary" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="viewer-media">
          {isVideo ? (
            <video src={source} controls playsInline />
          ) : (
            <img src={source} alt={item.fileName || 'Media'} />
          )}
        </div>
        <div className="viewer-details">
          <label>
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>
            Tags
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="comma, separated, tags" />
          </label>
          <div className="editor-actions">
            <button
              className="button small"
              type="button"
              onClick={() => queueAction('media.description.set', { photoId: item.localMediaId || item.id, description }).catch((error) => setStatus(error.message))}
            >
              Save description
            </button>
            <button
              className="button small secondary"
              type="button"
              onClick={() => queueAction('media.tags.set', {
                photoId: item.localMediaId || item.id,
                tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean)
              }).catch((error) => setStatus(error.message))}
            >
              Save tags
            </button>
            <button
              className="button small secondary"
              type="button"
              onClick={() => queueAction('media.like.set', { photoId: item.localMediaId || item.id, liked: !item.metadata?.liked }).catch((error) => setStatus(error.message))}
            >
              {item.metadata?.liked ? 'Unlike' : 'Like'}
            </button>
            <button
              className="button small danger"
              type="button"
              onClick={() => queueAction('media.delete', { photoId: item.localMediaId || item.id }).catch((error) => setStatus(error.message))}
            >
              Delete on desktop
            </button>
          </div>
          <p className="status compact">{status || (pendingActionCount(item) ? 'Waiting for desktop to apply pending actions.' : 'Originals may take a moment when served by desktop.')}</p>
        </div>
      </div>
    </div>
  );
}

function DevicesView({ devices, hosts }) {
  return (
    <div className="table-panel">
      <h2>Registered devices</h2>
      {!devices.length ? <EmptyState title="No devices yet" message="Desktop and mobile clients will register here as they connect." /> : null}
      {devices.map((device) => (
        <article className="device-row" key={device.id}>
          <div>
            <strong>{device.device_name || 'Unnamed device'}</strong>
            <span>{device.device_type}</span>
          </div>
          <div className="pill-row">
            {device.can_upload_media ? <span>Uploads media</span> : null}
            {device.can_edit_entries ? <span>Edits entries</span> : null}
            {device.can_use_desktop_host ? <span>Desktop host</span> : null}
          </div>
        </article>
      ))}
      <h2>Available hosts</h2>
      {!hosts.length ? <p className="status">No desktop hosts are online yet.</p> : null}
      {hosts.map((host) => (
        <article className="device-row" key={host.id}>
          <div>
            <strong>{host.device_name || 'Desktop host'}</strong>
            <span>Last seen {host.last_seen_at || 'unknown'}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function SettingsView({ libraryId, libraryName, onLibraryIdChange, onLibraryNameChange }) {
  return (
    <div className="settings-panel-app">
      <h2>Library settings</h2>
      <label>
        Library name
        <input value={libraryName} onChange={(event) => onLibraryNameChange(event.target.value)} />
      </label>
      <label>
        Library ID
        <input value={libraryId} onChange={(event) => onLibraryIdChange(event.target.value)} placeholder="Created automatically" />
      </label>
      <p className="status">
        The web app uses cloud entries only. Desktop apps will use this library ID to mirror Markdown files and sync media metadata.
      </p>
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
