'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

export default function WebAppPage() {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [libraryId, setLibraryId] = useState('');
  const [isoDate, setIsoDate] = useState(todayIso());
  const [raw, setRaw] = useState('');
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState('Connect to Supabase, then load or save a cloud entry.');

  async function authHeader() {
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function ensureLibrary() {
    if (libraryId) return libraryId;
    const response = await fetch('/api/libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ name: 'Book of Life' })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not create library.');
    setLibraryId(payload.library.id);
    return payload.library.id;
  }

  async function loadEntries() {
    try {
      setStatus('Loading entries...');
      const activeLibraryId = await ensureLibrary();
      const response = await fetch(`/api/entries?libraryId=${encodeURIComponent(activeLibraryId)}`, {
        headers: await authHeader()
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load entries.');
      setEntries(payload.entries || []);
      const matching = (payload.entries || []).find((entry) => entry.isoDate === isoDate);
      if (matching) setRaw(matching.raw || '');
      setStatus(`Loaded ${(payload.entries || []).length} entries.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function saveEntry() {
    try {
      setStatus('Saving entry...');
      const activeLibraryId = await ensureLibrary();
      const response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ libraryId: activeLibraryId, isoDate, raw })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save entry.');
      setStatus(`Saved ${isoDate} at cloud version ${payload.entry.cloudVersion}.`);
      await loadEntries();
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main className="app-shell">
      <nav className="topbar">
        <Link className="brand" href="/">Book of Life</Link>
        <div className="nav-actions">
          <Link href="/login">Account</Link>
          <button className="button small" type="button" onClick={loadEntries}>Sync</button>
        </div>
      </nav>

      <section className="workspace">
        <aside className="sidebar">
          <h1>Cloud Library</h1>
          <label>
            Library ID
            <input value={libraryId} onChange={(event) => setLibraryId(event.target.value)} placeholder="Auto-created on first sync" />
          </label>
          <div className="entry-list">
            {entries.map((entry) => (
              <button
                key={entry.isoDate}
                type="button"
                onClick={() => {
                  setIsoDate(entry.isoDate);
                  setRaw(entry.raw || '');
                }}
              >
                <span>{entry.isoDate}</span>
                <small>v{entry.cloudVersion}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="editor-pane">
          <div className="editor-toolbar">
            <label>
              Entry date
              <input value={isoDate} onChange={(event) => setIsoDate(event.target.value)} />
            </label>
            <button className="button" type="button" onClick={saveEntry}>Save to cloud</button>
          </div>
          <textarea value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="Write today's entry..." />
          <p className="status">{status}</p>
        </section>
      </section>
    </main>
  );
}
