-- Migration: 20261115_phase4_profiles_and_rls.sql
-- Description: Sets up profiles, galleries, artworks, model_jobs, and RLS policies for artizART.

-- 1. Profiles Table
create table if not exists public.profiles (
    id uuid references auth.users on delete cascade primary key,
    username text unique,
    display_name text,
    role text not null default 'artist' check (role in ('artist', 'admin')),
    approved boolean not null default true,
    meshy_daily_quota integer not null default 10,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable RLS on profiles
alter table public.profiles enable row level security;

-- Profiles Policies:
-- 1) Anyone can view approved artist profiles
create policy "Public can view approved artist profiles"
    on public.profiles for select
    using (approved = true);

-- 2) Users can view their own profile regardless of approval
create policy "Users can view own profile"
    on public.profiles for select
    using (auth.uid() = id);

-- 3) Users can update their own profile
create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- 4) Users can insert their own profile
create policy "Users can insert own profile"
    on public.profiles for insert
    with check (auth.uid() = id);

-- Trigger to auto-create profile on auth.users signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, username, display_name, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
        'artist'
    )
    on conflict (id) do update set
        display_name = coalesce(excluded.display_name, profiles.display_name),
        username = coalesce(excluded.username, profiles.username);
    return new;
end;
$$ language plpgsql security definer;

-- Trigger definition
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 2. Galleries Table
create table if not exists public.galleries (
    id uuid default gen_random_uuid() primary key,
    owner_id uuid references public.profiles(id) on delete cascade not null,
    title text not null,
    description text default '',
    status text not null default 'draft' check (status in ('draft', 'published')),
    created_at timestamptz not null default now()
);

alter table public.galleries enable row level security;

create policy "Public can view published galleries"
    on public.galleries for select
    using (status = 'published');

create policy "Owners have full CRUD on their galleries"
    on public.galleries for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

-- 3. Artworks Table
create table if not exists public.artworks (
    id uuid default gen_random_uuid() primary key,
    gallery_id uuid references public.galleries(id) on delete cascade not null,
    owner_id uuid references public.profiles(id) on delete cascade not null,
    title text not null,
    artist_name text not null default 'IRLO',
    image_path text not null,
    thumb_path text,
    model_path text,
    model_poster_path text,
    model_source text check (model_source in ('uploaded', 'meshy', null)),
    target_path text,
    trackability_score real,
    sort_order integer default 0,
    created_at timestamptz not null default now()
);

alter table public.artworks enable row level security;

create policy "Public can view artworks in published galleries"
    on public.artworks for select
    using (
        exists (
            select 1 from public.galleries g
            where g.id = artworks.gallery_id and g.status = 'published'
        )
    );

create policy "Owners have full CRUD on their artworks"
    on public.artworks for all
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

-- 4. Model Jobs Table
create table if not exists public.model_jobs (
    id uuid default gen_random_uuid() primary key,
    artwork_id uuid references public.artworks(id) on delete cascade not null,
    owner_id uuid references public.profiles(id) on delete cascade not null,
    provider text not null default 'meshy',
    provider_task_id text,
    status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'EXPIRED')),
    progress integer default 0,
    error text,
    created_at timestamptz not null default now(),
    finished_at timestamptz
);

alter table public.model_jobs enable row level security;

create policy "Owners can view their model jobs"
    on public.model_jobs for select
    using (auth.uid() = owner_id);

-- Storage buckets setup (artwork-images, models, targets)
insert into storage.buckets (id, name, public)
values 
    ('artwork-images', 'artwork-images', true),
    ('models', 'models', true),
    ('targets', 'targets', true)
on conflict (id) do nothing;

-- Storage policies: Public read, writes only inside {auth.uid()} folder
create policy "Public can read artwork images"
    on storage.objects for select
    using (bucket_id = 'artwork-images');

create policy "Public can read models"
    on storage.objects for select
    using (bucket_id = 'models');

create policy "Public can read targets"
    on storage.objects for select
    using (bucket_id = 'targets');

create policy "Artists can upload to own folder in artwork-images"
    on storage.objects for insert
    with check (bucket_id = 'artwork-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Artists can upload to own folder in models"
    on storage.objects for insert
    with check (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Artists can upload to own folder in targets"
    on storage.objects for insert
    with check (bucket_id = 'targets' and (storage.foldername(name))[1] = auth.uid()::text);
