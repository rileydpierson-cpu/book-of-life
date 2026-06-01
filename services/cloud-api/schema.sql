-- Initial cloud schema sketch for the cloud-authoritative Book of Life model.
-- Apply inside Supabase after replacing UUID defaults/policies to match the project.

create table if not exists libraries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name text not null default 'Book of Life',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references libraries(id) on delete cascade,
  owner_user_id uuid not null,
  device_name text not null default '',
  device_type text not null default 'desktop',
  can_upload_media boolean not null default false,
  can_edit_entries boolean not null default true,
  can_request_originals boolean not null default false,
  can_use_desktop_host boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists entries (
  library_id uuid not null references libraries(id) on delete cascade,
  iso_date date not null,
  raw text not null default '',
  cloud_version bigint not null default 1,
  updated_by_device_id uuid references devices(id),
  updated_at timestamptz not null default now(),
  primary key (library_id, iso_date)
);

create table if not exists entry_revisions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references libraries(id) on delete cascade,
  iso_date date not null,
  raw text not null default '',
  cloud_version bigint not null,
  updated_by_device_id uuid references devices(id),
  updated_at timestamptz not null,
  superseded_at timestamptz not null default now(),
  conflict boolean not null default false
);

create table if not exists media_items (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references libraries(id) on delete cascade,
  host_device_id uuid references devices(id),
  iso_date date,
  file_name text not null default '',
  metadata jsonb not null default '{}',
  has_thumb boolean not null default false,
  has_preview boolean not null default false,
  original_in_cloud boolean not null default false,
  original_on_host boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists sync_changes (
  id bigserial primary key,
  library_id uuid not null references libraries(id) on delete cascade,
  change_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}',
  changed_at timestamptz not null default now()
);

create table if not exists sync_mutations (
  id text primary key,
  library_id uuid not null references libraries(id) on delete cascade,
  device_id uuid references devices(id),
  mutation_type text not null,
  accepted boolean not null default false,
  result jsonb not null default '{}',
  created_at timestamptz not null default now()
);
