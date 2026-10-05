-- ============================================================
-- GOOGLE SHEETS MASTER CATALOG OWNERSHIP FIX
--
-- The live card catalog is maintained in Google Sheets.
-- card_ownership must therefore store the catalog's stable
-- text card_id instead of referencing the legacy Supabase
-- public.cards UUID.
--
-- This keeps one master catalog record while allowing every
-- user to own that catalog card independently.
-- ============================================================

alter table public.card_ownership
drop constraint if exists card_ownership_card_id_fkey;

alter table public.card_ownership
alter column card_id type text
using card_id::text;

comment on column public.card_ownership.card_id is
'Stable card_id from the Google Sheets master catalog.';
