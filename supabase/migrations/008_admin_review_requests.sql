-- Admin review queue and verified-card moderation.
-- Apply in Supabase SQL editor after reviewing existing migration state.
create table if not exists public.support_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 card_id uuid references public.cards(id) on delete set null,
 category text not null check (category in ('bug','card_correction','price_review','new_card_review','feature_request','other')),
 subject text not null check (char_length(subject) between 3 and 160),
 details text not null check (char_length(details) between 3 and 4000),
 status text not null default 'open' check (status in ('open','in_review','resolved','rejected')),
 admin_note text not null default '',
 reviewed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists support_requests_status_created_idx on public.support_requests(status,created_at desc);
create index if not exists support_requests_user_created_idx on public.support_requests(user_id,created_at desc);
create index if not exists support_requests_card_idx on public.support_requests(card_id);
create or replace function public.is_catalog_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') $$;
revoke all on function public.is_catalog_admin() from public;
grant execute on function public.is_catalog_admin() to authenticated;
alter table public.support_requests enable row level security;
drop policy if exists support_requests_read on public.support_requests;
create policy support_requests_read on public.support_requests for select to authenticated
using (user_id = auth.uid() or public.is_catalog_admin());
drop policy if exists support_requests_insert on public.support_requests;
create policy support_requests_insert on public.support_requests for insert to authenticated
with check (user_id = auth.uid() and status = 'open' and reviewed_by is null and admin_note = '');
drop policy if exists support_requests_admin_update on public.support_requests;
create policy support_requests_admin_update on public.support_requests for update to authenticated
using (public.is_catalog_admin()) with check (public.is_catalog_admin());
-- Restrict client grants so users cannot alter request status or admin notes.
revoke all on public.support_requests from anon, authenticated;
grant select on public.support_requests to authenticated;
grant insert (user_id,card_id,category,subject,details) on public.support_requests to authenticated;
grant update (status,admin_note,reviewed_by,updated_at) on public.support_requests to authenticated;

-- The card already has a verified column; only administrators may set it.
-- SECURITY DEFINER RPC restricts mutable catalog fields to an explicit allowlist.
create or replace function public.admin_review_card(
 p_card_id uuid,
 p_verified boolean default null,
 p_name text default null,
 p_card_number text default null,
 p_parallel text default null,
 p_card_brand text default null,
 p_card_series text default null
) returns void language plpgsql security definer set search_path = public
as $$
begin
 if not public.is_catalog_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
 if not exists (select 1 from public.cards where id = p_card_id) then raise exception 'Card not found'; end if;
 if p_name is not null and (length(trim(p_name)) < 2 or length(p_name) > 120) then raise exception 'Invalid card name'; end if;
 if p_card_number is not null and length(p_card_number) > 36 then raise exception 'Invalid card number'; end if;
 if p_parallel is not null and length(p_parallel) > 80 then raise exception 'Invalid parallel'; end if;
 if p_card_brand is not null and length(p_card_brand) > 80 then raise exception 'Invalid brand'; end if;
 if p_card_series is not null and length(p_card_series) > 120 then raise exception 'Invalid series'; end if;
 update public.cards set
  verified = coalesce(p_verified,verified),
  name = coalesce(nullif(trim(p_name),''),name),
  card_number = coalesce(p_card_number,card_number),
  parallel = coalesce(p_parallel,parallel),
  card_brand = coalesce(p_card_brand,card_brand),
  card_series = coalesce(p_card_series,card_series)
 where id = p_card_id;
end $$;
revoke all on function public.admin_review_card(uuid,boolean,text,text,text,text,text) from public;
grant execute on function public.admin_review_card(uuid,boolean,text,text,text,text,text) to authenticated;

-- New shared catalog cards remain usable immediately, but enter admin review.
create or replace function public.queue_new_catalog_card_review()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
 if new.created_by is not null and coalesce(new.verified,false) = false then
  insert into public.support_requests(user_id,card_id,category,subject,details)
  values(new.created_by,new.id,'new_card_review','Review newly added card',
    'New catalog card: ' || coalesce(new.name,'Unknown') || ' #' || coalesce(new.card_number,'') ||
    '. Review identity, set, variant, image and price.');
 end if;
 return new;
end $$;
drop trigger if exists trg_queue_new_catalog_card_review on public.cards;
create trigger trg_queue_new_catalog_card_review after insert on public.cards
for each row execute function public.queue_new_catalog_card_review();
