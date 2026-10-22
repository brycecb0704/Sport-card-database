-- Harden shared catalog: browser clients can read but cannot insert/update
-- catalog records directly. All new cards and Sheets bridge rows use the
-- authenticated create-identified-card Edge Function with service role.
-- Apply only after verifying that Edge Function deployment succeeded.
drop policy if exists "Authenticated users can create catalog cards" on public.cards;
drop policy if exists "Authenticated users can update catalog cards" on public.cards;
-- Existing admin policy remains in place for curated edits.
