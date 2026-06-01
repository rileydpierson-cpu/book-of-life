# Book of Life Desktop

This folder is reserved for the Electron shell. The current desktop host still runs from the repo root with:

```bash
npm run start:local
```

Open the first desktop sync settings screen at:

```text
http://127.0.0.1:3000/desktop/settings
```

The desktop implementation now has the server-side foundations for:

- cloud account/library/device-scoped settings
- local Markdown journal mirroring
- outside-the-app Markdown edit detection
- media folder sync policies
- device upload destination settings

The next Electron slice should move server startup into this app and open the existing Vite UI in a native window.
