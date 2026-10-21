# Sports Card Database — Living Project Reference

**Last updated:** 2026-10-20  
**Purpose:** Persistent handoff for future ChatGPT conversations. Update this document whenever project decisions, code changes, bugs, fixes, pricing methods, or architecture change. At chat handoff, use this document plus the latest GitHub state to produce an updated downloadable PDF.

## 1. Product vision and standards

Build a professional, enjoyable sports-card collection app for mobile and desktop. The target is the polish and ease of use of a leading consumer app, not a developer demo. Keep the project free-first wherever possible, but do not sacrifice data integrity or honest pricing just to add features quickly.

Priorities:
1. Reliable core workflows and data integrity.
2. Accurate card identification and catalog matching.
3. Honest pricing with clear evidence/source labels.
4. Sleek, simple My Collection and professional profile.
5. Large, broad shared catalog across sports.
6. Mobile-first responsive design and accessibility.
7. Later: trading/selling, marketplace, achievements, and potential iOS app after web is reliable.

User prefers direct implementation, large useful steps, safe commits, clear practical explanations, and no false claims of testing. User is less experienced with code and needs the assistant to handle code changes wherever connected tools allow.

## 2. Core product/data rule

**Shared catalog describes a card; ownership describes a user's physical copy.**

- A catalog card should exist once and be shared by everyone.
- Selecting an existing catalog card should create/update only the signed-in user's ownership record.
- Quantity represents multiple copies; avoid duplicate ownership rows for the same user/card.
- User-owned data: quantity, possession/status, grade/grading company, personal purchase/sale/trade data, personal notes, and personal front/back photos.
- Shared catalog data: canonical identity, sport, player/team relationships, year, manufacturer, set/series, card number, parallel/variation, and catalog images.
- Ordinary collectors must not create/edit shared reference records (teams, players, shared card facts). Missing catalog cards need a controlled admin/catalog-maintenance path, not silent duplicates.
- Never make a user's attempt to add a card fail just because an optional shared team/player reference is absent. Existing reference records can be linked; absent reference IDs should stay null until curated.
- If a card cannot be found, keep the user's inputs/photos, identify it with AI, search for likely catalog matches, and provide a clear not-found recovery path. Do not pretend an AI guess is a verified catalog card.

## 3. Current architecture

### Website
- GitHub repository: https://github.com/brycecb0704/Sport-card-database
- Branch: `main`
- Website: https://brycecb0704.github.io/Sport-card-database/
- Frontend: plain HTML/CSS/JavaScript; main source `index.html`.
- GitHub Pages deploys the static frontend.
- GitHub Actions workflow `.github/workflows/validate-app.yml` checks inline JavaScript syntax via `scripts/check-inline-js.py`. Syntax success is not a live browser/Supabase test.

### Supabase
- Main app project ref: `nsctktkfwrxgerrjkqij`
- URL: https://nsctktkfwrxgerrjkqij.supabase.co
- A secondary/older project exists: `hwsegdikyvqlyrabsrag`. Do not assume functions and frontend all use the same project; inspect each current configuration.
- Auth, profiles, ownership, bridge tables, cached prices, storage and Edge Functions live here.
- Never expose or commit service-role/API secrets. Gemini and other private API keys belong in Supabase secrets.

Known tables from earlier project setup include: `profiles`, `sports`, `leagues`, `teams`, `players`, `card_sets`, `cards`, `card_ownership`, `card_prices`, `activity_log`, `achievements`, `user_achievements`.

### Google Sheets / Apps Script master catalog
- Spreadsheet ID: `11AXYyiJEzQDKZjIvtz0UppIR_By5aF6vv5-KNqvy4zI`
- Documented Drive organization: Sports Card Database → Catalog → Baseball → Baseball Catalog.
- Sheets + Apps Script are the master catalog ingestion/normalization workflow; website reads the sheet via Google's Visualization endpoint.
- Catalog has been reported at roughly 58,713 cards, primarily baseball; coverage across sports is incomplete.
- Confirm sheet link access if the catalog stops loading; it was previously set to “Anyone with the link — Viewer.”
- Do not copy the full catalog into Supabase. `public.cards` is a relational bridge for ownership/prices/activity, not the complete master catalog.

### Card identification
- Supabase Edge Function: `identify-card` at `supabase/functions/identify-card/index.ts`.
- Uses Gemini with key stored server-side as `GEMINI_API_KEY`.
- Intended flow: front/back photo → Gemini proposes card identity → search master catalog for matching card → user chooses verified match → save only ownership. Do not let Gemini directly overwrite shared catalog identity.
- Confidence/uncertainty must be visible. Never invent year, set, parallel, serial numbering, autograph or relic facts.

### Pricing
- Supabase Edge Function: `refresh-card-price` at `supabase/functions/refresh-card-price/index.ts`.
- Current pricing code documents CardPricer reference prices as preferred when identity matches and eBay active asking prices as a clearly labelled fallback. SoldGraph was removed from the current pricing path; do not tell users current pricing is sold-comps-driven unless verified code/source changes.
- Sources currently include `cardpricer_reference` and `ebay_active_asking`.
- Shared cache in `card_prices` should let one user's successful lookup benefit everyone.
- Never label active asking prices as sold prices or confirmed market value.
- If only active listings are available, label as asking-price fallback, apply conservative adjustment, show source/count/confidence/freshness, and avoid false precision.
- Prefer actual sold transactions when a reliable, legally/technically available source is implemented and validated. Otherwise prefer exact-match third-party reference values; asking prices are fallback only.
- Use identity matching (sport, subject/player, year, set/series, card number, parallel/grade) before accepting a comparable. Exclude obvious mismatches, duplicates, stale results, and implausible outliers. Keep raw source evidence and a transparent price note.
- Respect free-tier/API quotas: cache results, use a per-card cooldown, batch refreshes, avoid duplicate triggers, and never trigger multiple network calls on every render.
- A pricing GitHub Actions deploy success only means deployment succeeded; it does not prove a source returned a correct card match.

## 4. Data integrity and security rules

- Ownership must point to the Supabase UUID in `cards.id`, not a Google Sheet card ID/string. Use the bridge resolver before ownership writes.
- One row per user/card; quantity handles duplicate copies.
- Row-level security is expected. Do not bypass it with public keys or client-side privilege changes.
- User actions must not write to shared `teams`, `players`, sets, or catalog records unless a deliberately authorized admin flow is used.
- Keep user photos in storage and save storage paths in the ownership record; do not put image bytes in database fields.
- No destructive bulk action without a clear confirmation and ownership-only scope.
- Do not apply a database migration blindly. There has been a recurring Supabase message: “Remote migration versions not found in local migrations directory.” Inspect remote/local migration history before any migration reset or destructive fix.

## 5. Pricing strategy and product behavior

Priority order for value display:
1. Verified sold-comparable data from a validated source, if implemented.
2. Exact-match reputable reference-price data.
3. Conservative active-asking fallback with explicit label.
4. “No reliable value yet” rather than $0.00 presented as an actual price.

Display value should include source, freshness, confidence, and whether it is a reference mark, sold-comps estimate, or active asking fallback. Do not use an asking price as if it were a confirmed sale. Store/cache pricing centrally by catalog card identity, not independently per user.

Collection total should multiply the chosen per-copy estimate by owned quantity, excluding cards marked sold/traded where appropriate. Do not count the same catalog card twice because of legacy duplicate ownership rows.

## 6. UI/UX standard

Aim for professional consumer-app quality:
- Strong visual hierarchy, generous but efficient spacing, consistent cards/buttons/fields, restrained color, and polished empty/loading/error states.
- Keep common actions obvious; hide destructive/bulk tools until users intentionally enter selection mode.
- Mobile and desktop must both feel designed, not merely resized.
- Collection should be visually calm: search and useful filters, concise summaries, clear card identity/number, personal quantity/grade/status, price/source, and card detail on demand.
- Avoid huge toolbars, always-visible checkboxes, repeated metadata, too many controls at once, and confusing modal flows.
- Profile should feel like an actual app account page: avatar/initials, display name/handle, collection statistics/value, editable bio, account details, and settings/actions. Keep sensitive account data private.
- Card number should be prominent; secondary identity metadata should be concise.
- Ensure keyboard focus, semantic labels, readable contrast, touch targets and accessible dialog controls.

## 7. Recent implementation history (2026-10-20)

### Previously committed in this chat
- `de5e47c` — polished Add Card modal layout/responsive styling.
- `00cb45f` — ownership editor labels/layout, responsive collection/catalog controls.
- `7d73e69` — AI identification review panel and collection bulk tools.
- `e3735dd` — additional UI/flow work including AI photo review, private ownership photo handling, duplicate automatic price-trigger removal and GitHub Actions validation workflow. The inline JavaScript syntax workflow passed; Pages build also succeeded at that commit.

### Current branch changes made during follow-up
- `b820b6e` — made shared team/player lookup functions non-writing during normal collector actions to avoid RLS-blocked writes; compacted My Collection bulk controls into an intentional “Select cards” mode; redesigned collection summary cards and profile styling.
- `b22b07f` — improved catalog search ranking, added a no-match recovery action to identify by photo, changed profile statistic from XP to collection value.
- `b785cea` — fixed whitespace tokenization in catalog search so multi-word queries split into terms correctly.

These are committed changes. Do not assume every UI interaction is fully browser-tested; check current Actions results and conduct live testing before calling a workflow verified.

### Important bug context
- User reported My Collection became “super jank”; current follow-up reduces always-visible bulk controls/checkboxes by hiding them until selection mode and makes the summary cards more compact.
- User reported adding from Collection fails with: `new row violates row-level security policy for table "teams"`.
- The code previously tried to insert a missing team into shared `teams` during card bridge creation. The current client-side fix is to reuse an existing team only and return null if none exists; it no longer inserts a shared team from a collector action. Existing player records are also read-only from collector workflows.
- Verify that adding from collection now succeeds against Supabase. If a subsequent RLS error names `card_sets`, `players`, or another table, inspect that exact path; do not weaken policies blindly.
- Catalog search had a regex bug: it used `/\\s+/` rather than `/\s+/`, preventing normal multi-word tokenization. This has been fixed in `b785cea`.
- Manual Add Card mode is search-only; no user-facing catalog creation form should be exposed. AI review is read-only and should guide users to matching shared catalog records.
- Photo upload and ownership record integration has been added to the UI/code but still needs a live test with storage permissions and real user data.
- A previous attempt to add a bulk pricing refresh was capped at five cards per batch to protect free/API quotas. Confirm `refreshCardPrice` return semantics before treating UI success count as a verified refresh.

## 8. Latest known code references

- Latest main source path: `index.html` (fetch latest from `main` before editing).
- Validation workflow: `.github/workflows/validate-app.yml`.
- JavaScript syntax checker: `scripts/check-inline-js.py`.
- Shared data reference migrations:
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/003_catalog_bridge_policies.sql`
  - `supabase/migrations/005_admin_catalog_edit_policy.sql`
- AI function: `supabase/functions/identify-card/index.ts`.
- Pricing function: `supabase/functions/refresh-card-price/index.ts`.

## 9. Next priorities / acceptance criteria

### P0 — Verify/fix ownership write path
- Test from My Collection → Add/Edit copy with a signed-in test account.
- Verify no insert/update to shared `teams` or `players` is attempted.
- Verify `card_ownership.card_id` is a valid `cards.id` UUID.
- Verify adding an existing catalog card creates one ownership row, not a new catalog card.
- Check the actual Supabase error details if failure persists; don't infer the next cause.

### P0 — Make catalog search and missing-card path reliable
- Search by player/name, card number, year, set, brand, series, parallel, sport/team, and barcode.
- Search should rank exact card number/name/set/identity matches above broad partial matches and never create duplicates.
- If found: use that exact catalog card and save ownership only.
- If not found: allow photo identification and show candidate facts/confidence; clearly state that an admin/catalog-maintenance step is needed to add a genuinely new card to the master catalog. Preserve the user's entered information/photos where possible. Do not silently create a public shared record or claim the card was added.
- Long term: create a proper catalog-request/review queue using an authorized backend and explicit schema/policy after migration history is reconciled.

### P0 — Polish My Collection
- Keep search and essential filters clean and compact.
- Bulk actions appear only after user taps “Select cards.”
- Show clear cards/copies/collection-value summaries, accurate source-labelled values, and readable card numbers.
- Avoid repeated/duplicated rows; selected actions must be ownership-only.
- Test mobile/desktop, empty state, no-image cards, sold/traded cards, zero/unknown prices, and multiple copies.

### P1 — Professional profile
- Verify profile values and account form populate/save correctly.
- Collection value must be calculated from actual current user's ownership summary, not XP.
- Avatar upload is not yet confirmed; do not display a fake uploaded-photo feature if storage workflow is not implemented.
- Later separate “Profile” from account/security settings if UI scope grows.

### P1 — Pricing verification
- Confirm live Edge Function deployed version and configured secrets without exposing values.
- Validate representative cards with known reference/sold values, including the test card 2020 Topps Series 1 Aaron Civale #223.
- Compare exact identity, source, raw rows, filtering, final estimate, confidence, note, and cache freshness.
- Avoid calling it “sold comps” while current code uses CardPricer reference plus eBay active asking fallback.

### P1 — End-to-end tests
1. Sign in/sign out.
2. Add an existing catalog card from Add Card search.
3. Add an existing catalog card from Catalog details.
4. Edit quantity/condition/value/notes.
5. Add front/back private photos and reopen the editor.
6. Search a multi-word card query.
7. Search a missing card and use photo identification.
8. Bulk select, refresh a capped batch, cancel selection, and remove selected ownership with confirmation.
9. Verify another user's ownership and private notes/photos do not leak.
10. Test responsive UI and run GitHub Actions syntax validation.

## 10. How to continue in a new ChatGPT conversation

Start by reading this living reference and fetching the latest repository state. Check the latest GitHub Actions runs and current source before making changes. Work in meaningful batches, commit changes, and update this document after each significant decision/fix. Keep a changelog of commits, tests actually performed, known failures, pricing/source decisions, and next actions. Do not claim browser/Supabase testing unless it was actually performed.

At chat handoff, produce an updated PDF from the latest version of this reference, including all changes since the previous PDF, and give the user a download link. Keep this Markdown file in the repository as the durable source of truth.
