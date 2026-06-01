# Book of Life Web + Cloud API

This is the Vercel-hosted app for Book of Life. It owns:

- public homepage at `/`
- Supabase login at `/login`
- first cloud web app at `/app`
- Vercel API routes under `/api/*`

## Local Setup

```bash
cp apps/web/.env.example apps/web/.env.local
npm install
npm run web:dev
```

Required environment values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `services/cloud-api/schema.sql`.
4. Add row-level security policies before production use.
5. Deploy this app to Vercel with the same environment variables.

## Routes

Pages:

- `/` homepage
- `/login` sign in/sign up
- `/app` first web journal client

APIs:

- `GET /api/health`
- `GET /api/session`
- `GET /api/libraries`
- `POST /api/libraries`
- `GET /api/entries?libraryId=...`
- `POST /api/entries`
- `GET /api/entries/:isoDate/revisions?libraryId=...`
- `GET /api/devices?libraryId=...`
- `POST /api/devices`
- `GET /api/hosts?libraryId=...`
- `GET /api/media?libraryId=...`
- `POST /api/media`

All non-health APIs require a Supabase bearer token from the signed-in client.

## Deploy to Vercel

Use `apps/web` as the Vercel project root. The build command is:

```bash
npm run build
```

The output is managed by Next.js.
