# Cloud-Hosted Entries and Desktop Sync Setup

This guide covers the first implemented slice of the cloud-authoritative architecture. The current repo still runs the local desktop host from the root, while the cloud service and Electron shell are scaffolded for the next stage.

## 1. Local Desktop Host

1. Configure `.env` with your existing local paths:

```dotenv
LIFESERVER_JOURNAL_VAULT=/path/to/Journal Vault
LIFESERVER_PHOTO_ROOT=/path/to/Photos
LIFESERVER_CACHE_DIR=./.cache
LIFESERVER_ALLOWED_USERS=yourname
BOOK_OF_LIFE_USER_ID=local-user
BOOK_OF_LIFE_LIBRARY_ID=default-library
BOOK_OF_LIFE_DEVICE_ID=desktop-main
```

2. Start the local desktop host:

```bash
npm run start:local
```

3. Open the desktop sync settings:

```text
http://127.0.0.1:3000/desktop/settings
```

4. Set:

- User ID
- Library ID
- Desktop Device ID
- local journal mirror folder
- device upload destination folder
- host availability mode
- media folders and cloud policy per folder

Settings are stored in `.cache/desktop-sync-settings.json`.

## 2. Cloud-Authoritative Entries

The local development cloud authority is exposed through:

```text
GET  /api/cloud/entries
GET  /api/cloud/entries/:date
POST /api/cloud/entries/:date
```

Entry saves through the existing editor also write to the local cloud-entry store and mirror to Markdown. The desktop journal watcher monitors Markdown files and pushes outside-the-app edits back into the cloud-entry store.

Canonical entry records include:

- `userId`
- `libraryId`
- `isoDate`
- `raw`
- `cloudVersion`
- `updatedAt`
- `updatedByDeviceId`

Revision history is stored in `.cache/cloud-entry-store.json`.

## 3. Supabase Cloud Backend

The production cloud backend should be created from `services/cloud-api/schema.sql`.

Minimum setup:

1. Create a Supabase project.
2. Apply `services/cloud-api/schema.sql`.
3. Enable row-level security before production use.
4. Add policies so users can only read/write rows where they own the library.
5. Create S3-compatible buckets for:
   - thumbnails
   - previews
   - selected originals
6. Deploy `services/cloud-api` endpoints to your server/Vercel functions when implemented.

## 4. Web App

The future Vercel app belongs in `apps/web`.

Required environment values:

```dotenv
VITE_BOOK_OF_LIFE_CLOUD_API_URL=https://your-cloud-api.example.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The web app should always read/write entries through the cloud API. It should never read local desktop files directly.

## 5. Mobile App

The current Expo app lives in `apps/mobile/`.

For the current local host flow:

1. Start the desktop host.
2. Find the desktop URL.
3. In mobile settings, sign in using the server URL and a configured user.
4. Run sync.

For the future cloud flow:

1. Mobile signs in through Supabase.
2. Mobile receives `userId`, `libraryId`, and `deviceId`.
3. Mobile pulls cloud entries into SQLite.
4. Mobile queues offline mutations and replays them to cloud.
5. Mobile uploads photos either to cloud storage or a discovered online desktop host.

## 6. Troubleshooting

- If entries do not appear in the editor, check `.cache/cloud-entry-store.json`.
- If desktop settings do not save, check `.cache/desktop-sync-settings.json` permissions.
- If external Markdown edits do not sync, confirm the file name parses to a date, such as `2026-05-11.md` or `May 11, 2026.md`.
- If mobile upload to desktop fails, confirm the connection includes a device sync root and the desktop upload destination is configured.
