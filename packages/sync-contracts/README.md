# Sync Contracts Package

The active sync contracts currently live in `shared/sync-contracts.js`.

This package is the migration target for shared mutation/change types, validators, user/library/device scoping, desktop settings shapes, media cloud policy constants, and host availability constants.

When the mobile app is moved into the workspace, both mobile and server code should import from this package instead of relative paths.
