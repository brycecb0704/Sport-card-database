-- Catalog cards are readable by authenticated users,
-- but only profiles with role = 'admin' may update them.

drop policy if exists "Authenticated users can update catalog cards"
on public.cards;

create policy "Administrators can update catalog cards"
on public.cards
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.role = 'admin'
  )
);
