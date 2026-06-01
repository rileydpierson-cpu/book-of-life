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

alter table libraries enable row level security;
alter table devices enable row level security;
alter table entries enable row level security;
alter table entry_revisions enable row level security;
alter table media_items enable row level security;
alter table sync_changes enable row level security;
alter table sync_mutations enable row level security;

drop policy if exists "Users can read own libraries" on libraries;
create policy "Users can read own libraries"
  on libraries for select
  using (owner_user_id = auth.uid());

drop policy if exists "Users can create own libraries" on libraries;
create policy "Users can create own libraries"
  on libraries for insert
  with check (owner_user_id = auth.uid());

drop policy if exists "Users can update own libraries" on libraries;
create policy "Users can update own libraries"
  on libraries for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "Users can delete own libraries" on libraries;
create policy "Users can delete own libraries"
  on libraries for delete
  using (owner_user_id = auth.uid());

drop policy if exists "Users can read own devices" on devices;
create policy "Users can read own devices"
  on devices for select
  using (owner_user_id = auth.uid());

drop policy if exists "Users can create own devices" on devices;
create policy "Users can create own devices"
  on devices for insert
  with check (
    owner_user_id = auth.uid()
    and exists (
      select 1 from libraries
      where libraries.id = devices.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own devices" on devices;
create policy "Users can update own devices"
  on devices for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "Users can delete own devices" on devices;
create policy "Users can delete own devices"
  on devices for delete
  using (owner_user_id = auth.uid());

drop policy if exists "Users can read own entries" on entries;
create policy "Users can read own entries"
  on entries for select
  using (
    exists (
      select 1 from libraries
      where libraries.id = entries.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can create own entries" on entries;
create policy "Users can create own entries"
  on entries for insert
  with check (
    exists (
      select 1 from libraries
      where libraries.id = entries.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own entries" on entries;
create policy "Users can update own entries"
  on entries for update
  using (
    exists (
      select 1 from libraries
      where libraries.id = entries.library_id
        and libraries.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from libraries
      where libraries.id = entries.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can read own entry revisions" on entry_revisions;
create policy "Users can read own entry revisions"
  on entry_revisions for select
  using (
    exists (
      select 1 from libraries
      where libraries.id = entry_revisions.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can create own entry revisions" on entry_revisions;
create policy "Users can create own entry revisions"
  on entry_revisions for insert
  with check (
    exists (
      select 1 from libraries
      where libraries.id = entry_revisions.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can read own media" on media_items;
create policy "Users can read own media"
  on media_items for select
  using (
    exists (
      select 1 from libraries
      where libraries.id = media_items.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can create own media" on media_items;
create policy "Users can create own media"
  on media_items for insert
  with check (
    exists (
      select 1 from libraries
      where libraries.id = media_items.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own media" on media_items;
create policy "Users can update own media"
  on media_items for update
  using (
    exists (
      select 1 from libraries
      where libraries.id = media_items.library_id
        and libraries.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from libraries
      where libraries.id = media_items.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can read own sync changes" on sync_changes;
create policy "Users can read own sync changes"
  on sync_changes for select
  using (
    exists (
      select 1 from libraries
      where libraries.id = sync_changes.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can create own sync changes" on sync_changes;
create policy "Users can create own sync changes"
  on sync_changes for insert
  with check (
    exists (
      select 1 from libraries
      where libraries.id = sync_changes.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can read own sync mutations" on sync_mutations;
create policy "Users can read own sync mutations"
  on sync_mutations for select
  using (
    exists (
      select 1 from libraries
      where libraries.id = sync_mutations.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Users can create own sync mutations" on sync_mutations;
create policy "Users can create own sync mutations"
  on sync_mutations for insert
  with check (
    exists (
      select 1 from libraries
      where libraries.id = sync_mutations.library_id
        and libraries.owner_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
