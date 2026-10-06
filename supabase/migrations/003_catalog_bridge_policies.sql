-- Sports Card Database
-- 003 - allow authenticated users to create/update catalog bridge rows
--
-- Google Sheets remains the master external catalog.
-- Supabase public.cards is the relational bridge required by
-- card_ownership, card_prices, and activity_log.

drop policy if exists "Authenticated users can create catalog cards"
on public.cards;

create policy "Authenticated users can create catalog cards"
on public.cards
for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update catalog cards"
on public.cards;

create policy "Authenticated users can update catalog cards"
on public.cards
for update
to authenticated
using (true)
with check (true);
