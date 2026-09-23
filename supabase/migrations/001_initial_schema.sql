-- ============================================================
-- SPORTS CARD DATABASE
-- Initial Supabase Database Schema
-- File: supabase/migrations/001_initial_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------

create extension if not exists pgcrypto;


-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

do $$
begin
    create type public.user_role as enum (
        'user',
        'admin'
    );
exception
    when duplicate_object then null;
end $$;


do $$
begin
    create type public.possession_status as enum (
        'Collection',
        'For Sale',
        'Sold',
        'Traded'
    );
exception
    when duplicate_object then null;
end $$;


-- ============================================================
-- HELPER FUNCTION: UPDATED_AT
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


-- ============================================================
-- PROFILES
-- One profile per Supabase Auth user
-- ============================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,

    username text not null unique,
    display_name text,

    role public.user_role not null default 'user',

    xp integer not null default 0,
    level integer not null default 1,

    avatar_path text,

    bio text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


create index if not exists profiles_username_idx
on public.profiles (lower(username));


-- ============================================================
-- SPORTS
-- ============================================================

create table if not exists public.sports (
    id uuid primary key default gen_random_uuid(),

    name text not null unique,

    created_at timestamptz not null default now()
);


-- ============================================================
-- LEAGUES
-- ============================================================

create table if not exists public.leagues (
    id uuid primary key default gen_random_uuid(),

    name text not null,
    sport_id uuid references public.sports(id) on delete set null,

    created_at timestamptz not null default now(),

    unique (sport_id, name)
);


create index if not exists leagues_sport_idx
on public.leagues (sport_id);


-- ============================================================
-- TEAMS
-- ============================================================

create table if not exists public.teams (
    id uuid primary key default gen_random_uuid(),

    name text not null,
    abbreviation text,

    sport_id uuid references public.sports(id) on delete set null,
    league_id uuid references public.leagues(id) on delete set null,

    city text,
    nickname text,

    active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (sport_id, name)
);


create index if not exists teams_sport_idx
on public.teams (sport_id);

create index if not exists teams_league_idx
on public.teams (league_id);


-- ============================================================
-- PLAYERS
-- ============================================================

create table if not exists public.players (
    id uuid primary key default gen_random_uuid(),

    name text not null,

    first_name text,
    last_name text,

    sport_id uuid references public.sports(id) on delete set null,
    team_id uuid references public.teams(id) on delete set null,

    position text,
    weight_division text,

    headshot_path text,
    bio text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


create index if not exists players_name_idx
on public.players (lower(name));

create index if not exists players_sport_idx
on public.players (sport_id);

create index if not exists players_team_idx
on public.players (team_id);


-- ============================================================
-- CARD SETS
-- A set exists independently of card ownership.
-- This allows the database to contain cards nobody owns.
-- ============================================================

create table if not exists public.card_sets (
    id uuid primary key default gen_random_uuid(),

    name text not null,

    year integer,

    sport_id uuid references public.sports(id) on delete set null,
    league_id uuid references public.leagues(id) on delete set null,

    brand text,
    series text,

    total_cards integer,

    set_number text,

    description text,

    front_image_path text,
    back_image_path text,

    source text,
    source_url text,

    verified boolean not null default false,

    identity_key text not null unique,

    created_by uuid references public.profiles(id) on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


create index if not exists card_sets_name_idx
on public.card_sets (lower(name));

create index if not exists card_sets_year_idx
on public.card_sets (year);

create index if not exists card_sets_sport_idx
on public.card_sets (sport_id);


-- ============================================================
-- CARD CATALOG
--
-- IMPORTANT:
-- This is the master card catalog.
--
-- There is ONE row here for each unique card/variant.
-- Ownership is stored separately below.
--
-- A card can exist here even when nobody owns it.
-- ============================================================

create table if not exists public.cards (
    id uuid primary key default gen_random_uuid(),

    card_id text not null unique,

    name text not null,

    card_number text,

    card_set_id uuid references public.card_sets(id) on delete set null,

    sport_id uuid references public.sports(id) on delete set null,
    league_id uuid references public.leagues(id) on delete set null,

    player_id uuid references public.players(id) on delete set null,
    team_id uuid references public.teams(id) on delete set null,

    position text,
    weight_division text,

    year_made integer,

    card_series text,
    card_brand text,

    parallel text,

    variant_type text,

    numbered boolean not null default false,
    print_run integer,

    serial_numbering text,

    rookie boolean not null default false,
    patch boolean not null default false,
    relic boolean not null default false,
    autographed boolean not null default false,

    insert_card boolean not null default false,
    short_print boolean not null default false,
    variation boolean not null default false,

    barcode text unique,

    front_image_path text,
    back_image_path text,

    description text,
    note text,

    source text,
    source_url text,

    verified boolean not null default false,

    -- Used by the recognition/import system to prevent duplicate cards.
    identity_key text not null unique,

    created_by uuid references public.profiles(id) on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


create index if not exists cards_name_idx
on public.cards (lower(name));

create index if not exists cards_number_idx
on public.cards (lower(card_number));

create index if not exists cards_year_idx
on public.cards (year_made);

create index if not exists cards_sport_idx
on public.cards (sport_id);

create index if not exists cards_team_idx
on public.cards (team_id);

create index if not exists cards_player_idx
on public.cards (player_id);

create index if not exists cards_set_idx
on public.cards (card_set_id);

create index if not exists cards_parallel_idx
on public.cards (lower(parallel));


-- ============================================================
-- USER CARD OWNERSHIP
--
-- This is separate from the catalog.
--
-- Example:
--
-- cards
--   Albert Pujols 2020 Topps Holiday
--
-- ownership
--   Bryce -> quantity 2
--   John  -> quantity 1
--
-- This lets everyone see community ownership without creating
-- duplicate catalog cards.
-- ============================================================

create table if not exists public.card_ownership (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    card_id uuid not null
        references public.cards(id)
        on delete cascade,

    quantity integer not null default 1
        check (quantity >= 0),

    possession public.possession_status not null default 'Collection',

    -- Current card value estimate
    value numeric(12,2),

    total_value numeric(14,2)
        generated always as (
            coalesce(value, 0) * quantity
        ) stored,

    -- Grade
    grade text,
    grading_company text,

    -- For Sale
    for_sale_price numeric(12,2),

    -- Purchase information
    purchase_price numeric(12,2),
    purchase_date date,
    purchase_source text,
    purchase_seller text,
    purchase_notes text,

    -- Sale information
    sold_price numeric(12,2),
    sold_date date,
    sold_buyer text,
    sold_source text,
    sold_notes text,

    -- Trade information
    trade_date date,
    traded_with text,
    trade_given text,
    trade_received text,
    trade_notes text,

    -- User's own photographs of the physical card
    front_photo_path text,
    back_photo_path text,

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (user_id, card_id)
);


create index if not exists card_ownership_user_idx
on public.card_ownership (user_id);

create index if not exists card_ownership_card_idx
on public.card_ownership (card_id);

create index if not exists card_ownership_possession_idx
on public.card_ownership (possession);

create index if not exists card_ownership_user_possession_idx
on public.card_ownership (user_id, possession);


-- ============================================================
-- CARD PRICE DATA
--
-- One current price record per card/source.
--
-- This does NOT create a giant price-history table.
-- Prices can be refreshed when requested.
-- ============================================================

create table if not exists public.card_prices (
    id uuid primary key default gen_random_uuid(),

    card_id uuid not null
        references public.cards(id)
        on delete cascade,

    source text not null,

    estimated_value numeric(12,2),

    asking_median numeric(12,2),

    low_price numeric(12,2),
    high_price numeric(12,2),

    listing_count integer,

    confidence numeric(5,2),

    price_note text,

    source_url text,

    fetched_at timestamptz not null default now(),

    unique (card_id, source)
);


create index if not exists card_prices_card_idx
on public.card_prices (card_id);

create index if not exists card_prices_source_idx
on public.card_prices (source);


-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

create table if not exists public.achievements (
    id uuid primary key default gen_random_uuid(),

    achievement_key text not null unique,

    name text not null,

    description text,

    xp_reward integer not null default 0,

    icon text,

    created_at timestamptz not null default now()
);


-- ============================================================
-- USER ACHIEVEMENTS
-- ============================================================

create table if not exists public.user_achievements (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    achievement_id uuid not null
        references public.achievements(id)
        on delete cascade,

    earned_at timestamptz not null default now(),

    unique (user_id, achievement_id)
);


create index if not exists user_achievements_user_idx
on public.user_achievements (user_id);


-- ============================================================
-- ACTIVITY LOG
-- Useful for XP, achievements, administration and future
-- notifications.
-- ============================================================

create table if not exists public.activity_log (
    id uuid primary key default gen_random_uuid(),

    user_id uuid references public.profiles(id) on delete set null,

    action text not null,

    card_id uuid references public.cards(id) on delete set null,

    details jsonb,

    created_at timestamptz not null default now()
);


create index if not exists activity_log_user_idx
on public.activity_log (user_id);

create index if not exists activity_log_card_idx
on public.activity_log (card_id);

create index if not exists activity_log_created_idx
on public.activity_log (created_at desc);


-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

drop trigger if exists profiles_updated_at
on public.profiles;

create trigger profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


drop trigger if exists teams_updated_at
on public.teams;

create trigger teams_updated_at
before update on public.teams
for each row
execute function public.set_updated_at();


drop trigger if exists players_updated_at
on public.players;

create trigger players_updated_at
before update on public.players
for each row
execute function public.set_updated_at();


drop trigger if exists card_sets_updated_at
on public.card_sets;

create trigger card_sets_updated_at
before update on public.card_sets
for each row
execute function public.set_updated_at();


drop trigger if exists cards_updated_at
on public.cards;

create trigger cards_updated_at
before update on public.cards
for each row
execute function public.set_updated_at();


drop trigger if exists card_ownership_updated_at
on public.card_ownership;

create trigger card_ownership_updated_at
before update on public.card_ownership
for each row
execute function public.set_updated_at();


-- ============================================================
-- AUTOMATIC PROFILE CREATION
--
-- When someone creates a Supabase Auth account, create their
-- application profile automatically.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    generated_username text;
begin

    generated_username :=
        coalesce(
            nullif(new.raw_user_meta_data->>'username', ''),
            split_part(coalesce(new.email, 'user'), '@', 1)
        );

    insert into public.profiles (
        id,
        username,
        display_name
    )
    values (
        new.id,
        generated_username,
        coalesce(
            nullif(new.raw_user_meta_data->>'display_name', ''),
            generated_username
        )
    )
    on conflict (id) do nothing;

    return new;
end;
$$;


drop trigger if exists on_auth_user_created
on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.sports enable row level security;
alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.card_sets enable row level security;
alter table public.cards enable row level security;
alter table public.card_ownership enable row level security;
alter table public.card_prices enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.activity_log enable row level security;


-- ============================================================
-- PROFILES POLICIES
-- ============================================================

drop policy if exists "Profiles are visible to authenticated users"
on public.profiles;

create policy "Profiles are visible to authenticated users"
on public.profiles
for select
to authenticated
using (true);


drop policy if exists "Users can update their own profile"
on public.profiles;

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);


-- ============================================================
-- REFERENCE DATA POLICIES
-- ============================================================

drop policy if exists "Authenticated users can view sports"
on public.sports;

create policy "Authenticated users can view sports"
on public.sports
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can view leagues"
on public.leagues;

create policy "Authenticated users can view leagues"
on public.leagues
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can view teams"
on public.teams;

create policy "Authenticated users can view teams"
on public.teams
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can view players"
on public.players;

create policy "Authenticated users can view players"
on public.players
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can view sets"
on public.card_sets;

create policy "Authenticated users can view sets"
on public.card_sets
for select
to authenticated
using (true);


-- ============================================================
-- CARD CATALOG POLICIES
--
-- Everyone signed into the application can read the catalog.
--
-- Catalog creation/changes will be handled by the application
-- backend rather than allowing unrestricted client writes.
-- ============================================================

drop policy if exists "Authenticated users can view cards"
on public.cards;

create policy "Authenticated users can view cards"
on public.cards
for select
to authenticated
using (true);


-- ============================================================
-- OWNERSHIP POLICIES
--
-- All authenticated users can SEE community ownership.
--
-- Users may only create/change/delete their own ownership rows.
-- ============================================================

drop policy if exists "Authenticated users can view community ownership"
on public.card_ownership;

create policy "Authenticated users can view community ownership"
on public.card_ownership
for select
to authenticated
using (true);


drop policy if exists "Users can add their own cards"
on public.card_ownership;

create policy "Users can add their own cards"
on public.card_ownership
for insert
to authenticated
with check (auth.uid() = user_id);


drop policy if exists "Users can update their own cards"
on public.card_ownership;

create policy "Users can update their own cards"
on public.card_ownership
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);


drop policy if exists "Users can delete their own cards"
on public.card_ownership;

create policy "Users can delete their own cards"
on public.card_ownership
for delete
to authenticated
using (auth.uid() = user_id);


-- ============================================================
-- PRICE POLICIES
-- ============================================================

drop policy if exists "Authenticated users can view prices"
on public.card_prices;

create policy "Authenticated users can view prices"
on public.card_prices
for select
to authenticated
using (true);


-- ============================================================
-- ACHIEVEMENT POLICIES
-- ============================================================

drop policy if exists "Authenticated users can view achievements"
on public.achievements;

create policy "Authenticated users can view achievements"
on public.achievements
for select
to authenticated
using (true);


drop policy if exists "Authenticated users can view earned achievements"
on public.user_achievements;

create policy "Authenticated users can view earned achievements"
on public.user_achievements
for select
to authenticated
using (true);


-- ============================================================
-- ACTIVITY POLICIES
-- ============================================================

drop policy if exists "Authenticated users can view activity"
on public.activity_log;

create policy "Authenticated users can view activity"
on public.activity_log
for select
to authenticated
using (true);


drop policy if exists "Users can create their own activity"
on public.activity_log;

create policy "Users can create their own activity"
on public.activity_log
for insert
to authenticated
with check (auth.uid() = user_id);


-- ============================================================
-- STORAGE BUCKETS
--
-- Separate storage areas:
--
-- catalog-images
--     Reference images belonging to the card catalog.
--
-- card-photos
--     Photos uploaded by users of cards they possess.
--
-- profile-images
--     User profile/avatar images.
--
-- other-files
--     Miscellaneous files.
-- ============================================================

insert into storage.buckets (
    id,
    name,
    public
)
values
    ('catalog-images', 'catalog-images', true),
    ('card-photos', 'card-photos', true),
    ('profile-images', 'profile-images', true),
    ('other-files', 'other-files', false)
on conflict (id) do nothing;


-- ============================================================
-- STORAGE POLICIES: CATALOG IMAGES
-- ============================================================

drop policy if exists "Anyone can view catalog images"
on storage.objects;

create policy "Anyone can view catalog images"
on storage.objects
for select
using (
    bucket_id = 'catalog-images'
);


-- Catalog images are uploaded by trusted backend functions.
-- No unrestricted browser upload policy is created here.


-- ============================================================
-- STORAGE POLICIES: CARD PHOTOS
-- ============================================================

drop policy if exists "Anyone can view card photos"
on storage.objects;

create policy "Anyone can view card photos"
on storage.objects
for select
using (
    bucket_id = 'card-photos'
);


drop policy if exists "Users can upload card photos"
on storage.objects;

create policy "Users can upload card photos"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can update their card photos"
on storage.objects;

create policy "Users can update their card photos"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can delete their card photos"
on storage.objects;

create policy "Users can delete their card photos"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'card-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- STORAGE POLICIES: PROFILE IMAGES
-- ============================================================

drop policy if exists "Anyone can view profile images"
on storage.objects;

create policy "Anyone can view profile images"
on storage.objects
for select
using (
    bucket_id = 'profile-images'
);


drop policy if exists "Users can upload profile images"
on storage.objects;

create policy "Users can upload profile images"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can update profile images"
on storage.objects;

create policy "Users can update profile images"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can delete profile images"
on storage.objects;

create policy "Users can delete profile images"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- STORAGE POLICIES: OTHER FILES
-- ============================================================

drop policy if exists "Users can view their other files"
on storage.objects;

create policy "Users can view their other files"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'other-files'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can upload other files"
on storage.objects;

create policy "Users can upload other files"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'other-files'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can update their other files"
on storage.objects;

create policy "Users can update their other files"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'other-files'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'other-files'
    and (storage.foldername(name))[1] = auth.uid()::text
);


drop policy if exists "Users can delete their other files"
on storage.objects;

create policy "Users can delete their other files"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'other-files'
    and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- STARTER SPORTS
-- ============================================================

insert into public.sports (name)
values
    ('Baseball'),
    ('Basketball'),
    ('Football'),
    ('Hockey'),
    ('Soccer'),
    ('UFC'),
    ('Boxing'),
    ('Wrestling'),
    ('Racing'),
    ('Golf'),
    ('Tennis'),
    ('Other')
on conflict (name) do nothing;


-- ============================================================
-- STARTER ACHIEVEMENTS
-- ============================================================

insert into public.achievements (
    achievement_key,
    name,
    description,
    xp_reward,
    icon
)
values
    (
        'first_card',
        'First Card',
        'Add your first card to the database.',
        100,
        '🃏'
    ),
    (
        'ten_cards',
        '10 Cards',
        'Have 10 cards in your collection.',
        250,
        '📚'
    ),
    (
        'fifty_cards',
        '50 Cards',
        'Have 50 cards in your collection.',
        500,
        '🏆'
    ),
    (
        'hundred_cards',
        '100 Cards',
        'Have 100 cards in your collection.',
        1000,
        '💯'
    ),
    (
        'first_sale',
        'First Sale',
        'Record your first sold card.',
        250,
        '💰'
    ),
    (
        'first_trade',
        'First Trade',
        'Record your first card trade.',
        250,
        '🔄'
    )
on conflict (achievement_key) do nothing;


-- ============================================================
-- USEFUL INDEX FOR COMMUNITY SEARCH
-- ============================================================

create index if not exists cards_search_idx
on public.cards (
    lower(name),
    lower(card_number),
    lower(parallel),
    year_made
);


-- ============================================================
-- DONE
-- ============================================================
