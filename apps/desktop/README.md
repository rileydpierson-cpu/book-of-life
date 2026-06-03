# Book of Life Desktop

The desktop app is an Electron shell around the local Book of Life host. It starts the existing Express/Vite server, opens the library UI, and provides desktop sync settings for Supabase.

## Run Locally

From the repo root:

```bash
npm install --prefix apps/desktop --no-bin-links
npm run desktop:dev
```

The Electron shell starts the local host on:

```text
http://127.0.0.1:3131
```

On launch, the desktop app opens the onboarding flow first. It is skipped automatically once the desktop has at least one source configured: a media folder, imported entries, or a live Markdown journal mirror.

Use the app menu:

```text
Book of Life > Desktop Sync Settings
```

The desktop app also keeps a status icon in the system tray while the local service is running. Click it to reopen Book of Life, open onboarding, open hosting settings, restart the local service, or quit the background service.


## Build Installers

Install the desktop build tooling once:

```bash
npm install --prefix apps/desktop --no-bin-links
```

Build Linux packages from the repo root:

```bash
npm run desktop:dist:linux
```

The Linux build writes these files to `apps/desktop/release/`:

- `.deb`
- `.tar.gz`

The build also runs a packaged smoke test that starts the bundled local server and confirms the desktop cloud configuration is present. Run it again after any packaging change with:

```bash
npm run desktop:verify:linux
```

Do not run the `.deb` file directly; it is an installer package. Install it from the repo root with:

```bash
sudo apt install ./apps/desktop/release/Book\ of\ Life-0.1.0-amd64.deb
```

Then launch Book of Life from the app menu. To try the unpacked Linux build without installing it, run:

```bash
./apps/desktop/release/linux-unpacked/@book-of-lifedesktop
```

The tarball contains the same unpacked app and can be extracted before running the bundled executable:

```bash
tar -xzf ./apps/desktop/release/Book\ of\ Life-0.1.0-x64.tar.gz -C /tmp/book-of-life-desktop
/tmp/book-of-life-desktop/@book-of-lifedesktop
```

Rebuild the Linux artifacts whenever cloud config or local-server files change so `resources/local-server/` contains the current source.

AppImage packaging is also configured as an optional target:

```bash
npm --prefix apps/desktop run dist:linux:appimage
```

On some mounted drives, AppImage builds can fail when the filesystem blocks symlinks. If that happens, build from a native Linux filesystem or use the `.deb`/`.tar.gz` outputs.

Windows packaging is also configured:

```bash
npm run desktop:dist:win
```

That command prepares the Windows Sharp native dependency, builds the web bundle, and creates NSIS plus portable `.exe` artifacts. Outputs land in:

```text
apps/desktop/release/
```

Current Windows artifacts:

- `Book of Life Setup-0.1.0-x64.exe` - installer with Start Menu/Desktop shortcuts
- `Book of Life Portable-0.1.0-x64.exe` - portable executable

Mac packaging is configured, but it is best run on macOS:

```bash
npm run desktop:dist:mac
```

For a publishable Mac release, expect to add Apple code signing, notarization, and a custom app icon later.

The app is not code-signed yet, so Windows SmartScreen may warn users until a signing certificate is added. A custom app icon is also not configured yet, so Electron's default icon is used.

Packaged installs store default data under the user's app data folder and create starter folders for the journal vault, photos, cache, and device uploads. Users can change media folders and Supabase sync settings from `Book of Life > Desktop Sync Settings`.

## Supabase Connection

In Desktop Sync Settings, set:

- desktop name
- library name
- media folders
- device upload destination

Then sign in with the same Book of Life Cloud email/password used by the web app. The desktop host will:

- create or find the user library
- register this desktop as a host device
- push newer local/cloud-mirror entries to Supabase
- pull cloud entries into the local Markdown journal folder
- keep the existing local media host/upload APIs running

## Current Scope

This first desktop slice supports entry sync and host/device registration. Media metadata, thumbnail derivative upload, and desktop-host upload routing are the next build steps.
