# Cloud API Service

This folder is reserved for the Supabase/Postgres/S3-backed API.

The local server now exposes a development version of the cloud-entry authority:

- `GET /api/cloud/entries`
- `GET /api/cloud/entries/:date`
- `POST /api/cloud/entries/:date`
- `GET /api/desktop/sync-settings`
- `POST /api/desktop/sync-settings`

The production service should implement the same behavior with Supabase Auth, Postgres row-level security, and S3-compatible object storage.
