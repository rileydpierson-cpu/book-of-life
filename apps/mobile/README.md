# Book of Life Mobile

The active Expo app currently lives in `mobile/`.

Future migration target:

- move `mobile/` into this folder
- keep SQLite/offline queue behavior
- sign in against the cloud backend by default
- allow photo uploads to cloud storage or a discovered desktop host
- sync cloud-authoritative entries into local SQLite

The existing mobile sync engine already speaks the `/api/sync/*` contract and is ready to consume the extended user/library/device-scoped payloads.
