# Book of Life Local Server

The current Express/Vite filesystem host still lives at the repo root while the cloud-authoritative sync work lands incrementally.

Current local server responsibilities:

* serve the browser UI
* mirror cloud-authoritative entries into local Markdown files
* detect Markdown edits made outside the app and push them into the local cloud-entry authority
* index selected local photo folders
* generate local thumbnails/previews
* receive device uploads into configured folders

Future migration target:

* move `server.js`, `src/`, `client/`, and root Vite HTML entrypoints under this app or expose them as packages consumed by `apps/desktop`.


