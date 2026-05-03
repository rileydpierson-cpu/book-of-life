# LifeServer

LifeServer is a local-first web app for browsing a personal journal and photo timeline.

## Architecture

- **Express server**: serves the UI, editor, auth, and timeline/media APIs.
- **Startup indexer**: recursively scans journal files, journal images, and photo folders.
- **Hidden cache**: stores the built index, photo-date metadata, HEIC conversions, and thumbnails in `.cache/`.
- **Frontend**: plain HTML/CSS/JS for stability and simple local startup.
- **Filesystem source of truth**: journal entries stay as Markdown files on disk. The app index is a cache, not a second database.

## Lazy-loading strategy

The app does **not** send the full timeline at once.

- The server keeps a sorted list of day entries in memory.
- The timeline API returns a **fixed slice of day blocks** by start index.
- The client loads only the requested chunk, centered on the chosen date when needed.
- As the user scrolls, top and bottom sentinels request **older** or **newer** day chunks.
- Jumping to a date uses the date rail index to fetch the chunk containing that day first, then scrolls to it.
- Search results reuse the same timeline renderer, but disable infinite loading so behavior stays predictable.

## Folder assumptions

Your folder configuration should point to:

- a **Journal Vault** folder that contains:
  - a `Journal` folder with files like `April 17, 2025.md`
  - an `Images` folder for journal inline images
- one or more **photo folders** that may be nested and messy

## Run locally

1. Copy `config.example.json` to `config.json`
2. Create a `.env` file in the project root
3. Add your folder paths:

```dotenv
LIFESERVER_JOURNAL_VAULT=D:\Notes\Journal Vault
LIFESERVER_PHOTO_ROOT=D:\Mission Photos
LIFESERVER_CACHE_DIR=./.cache
```

4. `config.json` can reference env vars with `${...}` placeholders, and the app will create these folders automatically if they do not exist
5. Optionally set `LIFESERVER_PHOTO_FOLDERS` for multiple photo roots. On Windows, separate folders with `;`, or use a JSON array string.

```dotenv
LIFESERVER_PHOTO_FOLDERS=D:\Mission Photos;D:\Family Photos
```

```dotenv
LIFESERVER_PHOTO_FOLDERS=["D:\\Mission Photos","D:\\Family Photos"]
```

6. Optionally enable auth and set a long random `auth.accessSecret`
7. In the project folder run:

```bash
npm install
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

To use the app on your LAN, visit your machine's local IP on port `3000`.

## Authentication

If `auth.enabled` is `true`, LifeServer requires a pasted access secret before loading the app.

Recommended config:

```json
"auth": {
  "enabled": true,
  "accessSecret": "paste-a-very-long-random-secret-here",
  "sessionDays": 30,
  "secureCookie": false
}
```

Notes:

- `secureCookie` should stay `false` for plain local HTTP.
- If you publish this on the internet, put it behind **HTTPS** and set `secureCookie` to `true`.
- The login page uses one pasted secret instead of usernames and passwords.
- Login sets an `httpOnly` session cookie.
- Environment variables in `.env` are loaded automatically at startup. Existing system env vars take precedence over `.env`.

## Entry editing

LifeServer now includes a Markdown editor for journal entries.

- Edit an existing entry using the edit button on a journal card.
- Use the calendar icon to jump to **today's entry**.
- If today's entry does not exist, the app creates the correctly named Markdown file automatically.
- Save using the top-right **Save** button or `Cmd/Ctrl + S`.
- Undo and redo are available with toolbar buttons and keyboard shortcuts.

Markdown files remain the source of truth. Saving writes directly to the correct journal file and refreshes that day in the in-memory index.

## Notes

- Journal dates come from the markdown filename only.
- Photo dates are determined in this order:
  1. manual date override saved by the app
  2. EXIF capture date
  3. filesystem created date
  4. filesystem modified date
- The upload dialog can stamp the selected day into the real image EXIF metadata instead of renaming files.
- If you have older photos whose dates only live in the filename, run `node scripts/apply-filename-date-overrides.js` to copy that date into EXIF on supported image types.
- `.heic` and `.heif` files are converted once and cached before browser delivery.
- Timeline thumbnails are cached at lower quality for speed.
- Full-size viewer loads the thumbnail first, then swaps to the full image.
- Background rebuilds run on an interval after startup.

## Main files

- `server.js` - app entrypoint and routes
- `src/auth.js` - access-secret auth and session handling
- `src/indexer.js` - indexing, journal parsing, entry loading/saving, date extraction, search
- `src/image-service.js` - thumbnails, HEIC conversion, image delivery
- `public/app.js` - client-side timeline loading and interactions
- `public/editor.js` - Markdown editor
- `public/styles.css` - timeline UI styling
- `public/editor.css` - editor styling
