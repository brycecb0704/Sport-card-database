# Sports Card Database — Living Project Reference

**Last updated:** 2026-10-21  
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

## 11. Product direction clarified 2026-10-21 (requested, not yet implemented)

- User has ChatGPT Pro and asks whether ChatGPT can manage the site and identify cards. ChatGPT subscription does not include website OpenAI API usage; website needs a separate API account/billing and secure server-side integration. Existing Gemini identification may remain for free-first use. Connected GitHub assistant can manage source code when authorized, but does not autonomously operate the deployed app.
- **Add Card should be web-first**: users upload a photo or type a short search; first de-duplicate against exact existing shared catalog identity, then query permitted external card sources and AI-assisted recognition. If truly absent, securely create one new shared master card through an authorized backend after identity/conflict checks, rather than requiring collectors to enter extensive fields. Unverified/ambiguous details should be flagged for review. This supersedes the prior product assumption that all new cards must await admin creation, but not the security rule that public clients cannot write shared tables directly.
- **One shared master card image only**, not personal front/back photos per owner. Remove personal card-image upload/storage fields from the planned collector UI, while allowing an uploaded identification image to be used transiently or retained only with explicit consent. Image licensing/provenance must be respected.
- Card activity should be action-led: Bought, Sold, Traded, For Sale, Graded, etc.; reveal only relevant details per action. Keep user-owned transaction and grade data separate from shared catalog identity.
- Remove unnecessary subtitles, verbose instructional text, repeated page explanations and excess form fields. Prefer compact, polished UI.
- **Pricing is currently not working satisfactorily.** Treat it as P0: inspect source availability, identity matching, caching, function deployment, UI refresh and collection totals. Never fabricate prices or display unknown as $0. Pricing source file was inspected on 2026-10-21; header says active eBay listing research, while reference earlier mentions CardPricer preference. Verify complete function code and actual deployed version before claiming source behavior.
- These are new requirements/decisions, **not yet shipped changes**. Plan migrations/authorization carefully, protect API keys, limit abuse and deduplicate shared catalog entries.

## 12. 2026-10-21 pricing-on-identification priority

- User wants to remain free-first and says existing Gemini card identification is generally working. Do not add paid OpenAI API integration at this time.
- User specifically wants a price fetched **when a card is identified**, ideally displayed in the identification review before adding ownership. Once identity is matched to an existing shared catalog card, reuse a fresh shared cached price; if stale/missing, request a single guarded background refresh using the resolved Supabase card UUID. If identity is new, securely create/deduplicate the shared catalog card first, then price it. Do not attempt price refresh on an unverified AI guess or Sheet string ID.
- Existing `index.html` was inspected: `identifyNewCardPhoto()` calls `identifyCardFromImage()`, renders AI review, and searches the catalog; it currently does **not** request a price at identification time. `saveCardFromForm` already triggers an automatic price lookup **after adding** when `needsCardPriceRefresh` is true. The user requests earlier pricing; do not misrepresent the existing post-save trigger as meeting this requirement.
- Keep source accuracy, missing-price labeling, cache cooldown, and quota protections. Pricing accuracy and successful end-to-end display remain unverified. This is a requested implementation, not yet shipped.

## 13. Implementation 2026-10-21 — automatic price after exact identification

- Commit `1d5977554668621239039e837dd153ae49762c25` modifies `index.html` so `identifyNewCardPhoto()` calls `priceIdentifiedCatalogMatch(data)` after AI identification and local catalog search.
- The helper requires a unique exact normalized player/name, year, card number, set/series, and parallel match against loaded catalog; only calls existing `refreshCardPrice` when it resolves to a Supabase UUID and `needsCardPriceRefresh` is true. In-flight UUID requests deduplicated. It displays estimate/source or 'Price unavailable'. Does not create new catalog cards or price guesses.
- Limitations: fresh cached prices aren't displayed by this helper; UI rerender may remove the injected status node; live behavior and pricing accuracy need testing. This is not verified end-to-end.

## 14. 2026-10-21 follow-up fixes and remaining blockers

- Commit `a2ce15ea8f0286fe56a4d233b76d0e37687d3266`: `priceIdentifiedCatalogMatch` now immediately shows usable cached price/source; if no refresh is due it reports unavailable rather than staying blank. A persistent status selector (`identifiedCardPriceStatus`) is re-created after review-panel re-renders, and the async completion is gated against stale identification data. Matching includes brand when supplied. It does not yet create new shared cards; a unique exact match and existing Supabase bridge UUID are still needed to request refresh.
- Commit `9ff867af9e47362da75f24131d9805c67658d2df`: fixed a real escaping bug in `refresh-card-price/index.ts` where a JavaScript string used `\\s` incorrectly for the regex constructor's intended whitespace pattern; corrected source string escaping. This pricing Edge Function must be deployed to Supabase separately; a GitHub commit does not deploy it.
- Still unresolved: end-to-end browser/Supabase verification, accurate live pricing source validation, external web-first card discovery, secure shared new-card creation with deduplication, master image sourcing/licensing, user activity action buttons, removing personal card photos, and unnecessary UI instructions. Avoid weakening RLS or auto-publishing unverified AI guesses. No live card lookup test was performed during this turn.

## 15. 2026-10-21 major UX and shared-card creation upgrade

User explicitly reported that pricing mostly fails, appearance needs substantial modernization, and genuinely new cards must be creatable. Implementation commits:

- `a3ea73aa`: made `findOrCreateSet` read-only in collector paths; missing sets no longer trigger forbidden RLS writes. Existing card bridging still has other write permissions to test.
- `4f2f524b`: streamlined Add Card choice cards and text, added compact styling and action-led ownership editor. Activity buttons: In Collection, Bought, For Sale, Sold, Traded, Graded. Relevant ownership fields are shown based on activity; personal front/back photo inputs are hidden. Existing ownership photo records are not deleted. Responsive modal refinements. The modal is not yet end-to-end browser tested.
- `a9fe6419`: created `supabase/functions/create-identified-card/index.ts`, a signed-in server-side creation flow using service-role secret, rate limit 20/day/user, required identity fields, set creation/reuse, shared-card identity uniqueness, unverified source/flag, and conflict fallback. No paid OpenAI API. Card images are not automatically copied or sourced from the web. It is an AI-assisted **unverified** shared catalog creation flow, not verified external web research.
- `c71315b3`: added GitHub Actions deploy workflow for `create-identified-card`; `4d7e3f9c` refined existing-card matching to require matching set identity and triggered function deployment. Check actual GitHub Action result and Supabase availability before claiming deployed.
- `c5ea3cd`: connected AI identification review to an explicit 'Add as new card' action invoking new Edge Function; reloads catalog, opens ownership editor, and triggers pricing if stale. Removed transfer of identification photos into per-owner storage.
- `4fe2cdb`: new-card action is shown only when no unique exact local catalog match exists.
- `b19d992`: `refreshCardPrice` no longer claims a successful refresh when the returned estimate is missing/nonpositive. This corrects misleading UI success, not underlying provider data.

**Critical limitations / follow-up:** no end-to-end browser/Edge Function test yet; inspect deploy workflow. Source accuracy of CardPricer/eBay asking is not solved by these commits; users may still see no prices. External web-first search integrated into Add Card is NOT implemented yet; it still searches the local shared catalog and uses Gemini photo identification. New shared entries remain unverified and need eventual admin moderation; do not label them verified. Avoid weakening RLS. The front-end currently retains legacy ownership photo upload code/fields, but the new UI hides inputs and no longer transfers AI photos. Remove obsolete backend/storage handling later after verifying no dependencies. Need confirm Google Sheet + Supabase-only cards load and shared image rights.

- `fce7a34d`: manual no-match result now offers an external Google web-search link. This is **not** in-app external catalog discovery and should not be presented as such.
- `22a75737` + `0111467c`: raw-card CardPricer reference filtering now excludes graded rows/graded titles. Pricing function deploy is handled by existing GitHub workflow; verify run outcome. No live accuracy proof; actual sold comps remain unavailable.
- New-card Edge Function deployment workflow completed with GitHub Actions success at commit `4d7e3f9c`, but user-level creation/save still needs live authentication and RLS tests. Note existing migration `003_catalog_bridge_policies.sql` permits authenticated inserts into cards; a future audited RLS migration is needed to fully enforce backend-only shared-card creation. Do not claim globally secured write policies based solely on the new function.

## 16. 2026-10-21 final polish and pricing match improvements

- `5323948e`: global visual refresh in `index.html`: cleaner typography, calmer colors, refined card tiles/nav/buttons/inputs, accessible focus, responsive and reduced-motion handling. CSS committed; visual browser review not yet performed.
- `8a29bc02` + `3627daba`: AI identification-to-catalog price matching accepts equivalent set wording (e.g. names with extra year/sport terms) while still requiring unique match on subject, year, card number, brand when provided, and parallel. Corrected regex year-token exclusion. This may help previously missed prices but needs live verification.
- Important: user still reports that most pricing is bad/unavailable. No verified sold-comps source has been implemented; eBay active asking fallback and CardPricer references remain imperfect. Do not claim pricing accuracy solved. Compare actual function logs and a set of known cards with source prices before further tuning. Confirm new-card backend creation with signed-in test account and shared-catalog permissions. No new paid OpenAI API.

## 17. 2026-10-21 batch-build phase: defer manual testing

User requests implementing as much as possible before a single comprehensive test session. Do not repeatedly ask for individual card tests; complete changes and check automated CI first.

- `11caf7e5`: tightened AI new-card action availability to complete identities and corrected a library selection declaration; introduced an accidental duplicate `async` keyword detected by GitHub Actions.
- `df1c0448`: removed duplicate `async` and restored syntax. Verify new CI pass before release.
- `50e50ba8`: newly created shared cards and sets now link to existing `sports` lookup rows, improving sport display and filtering. The function deployment is automatic; verify GitHub Action.

**Before user acceptance testing:** finish external discovery/in-app workflow, backend-only catalog insert RLS with an audited migration, single shared image provenance, pricing provider diagnostics and source accuracy, UI form cleanup, and verify deployed workflows. Automated JS syntax checks are necessary but insufficient.

## 18. 2026-10-21 implementation batch — no manual tests requested yet

- `abf41bde`: automatic `refreshCardPrice(cardId, false, true)` is silent and no longer reloads the entire Google Sheets catalog for each price; updates the returned shared-price record in client state and re-renders. Manual refresh retains messages. This reduces network/free-tier load; UI end-to-end behavior still needs checking.
- `4edb980c`: obsolete `ebay_sold_comps` rows from the removed SoldGraph integration no longer override active supported pricing sources in `getPrice`. This removes misleading stale sold data; does not provide new verified sold comps.
- `6b119087` and `ae7e1c82`: structural workflow regression checks added and wired into GitHub Actions, in addition to JS syntax validation. CI success for `ae7e1c82`. Checks are structural only, not API/browser integration tests.
- `0aaa53db`: when manual catalog search has no match, user can open a compact missing-card form (name, year, sport, brand, set, number, optional parallel); its data is reviewed in the existing AI review panel, checked for exact matches, and only written to shared catalog via explicit confirmation and authenticated Edge Function. Web search remains an external Google search, not automatic data import.

**Outstanding:** Price quality and coverage still constrained by CardPricer reference + eBay active asking fallback, no confirmed sold feed; no licensed shared master photo acquisition; no automated real browser test with signed-in account; Supabase RLS still allows existing client-side catalog bridge inserts and should be hardened only after moving bridge creation server-side. The user asked to defer manual testing until bulk work is ready; do not misrepresent remaining items as completed.

## 19. 2026-10-21 backend catalog write hardening preparation

- `2ebf8727`: authenticated `create-identified-card` Edge Function now supports `mode: bridge` to create/reuse Supabase cards for existing Google Sheets catalog IDs. This avoids browser direct writes, but the bridge mode currently accepts client-supplied card facts and does not independently verify those facts against the Google Sheet; harden validation before considering it trusted.
- `e6d0232a`: `ensureSupabaseCard` now delegates missing Sheets bridge creation to the Edge Function. Existing bridge rows are read-only from client. Do not assume user ownership or pricing are live-tested.
- `25ba3e68`: added `007_restrict_catalog_client_writes.sql` to drop permissive authenticated insert/update policies. **Migration not applied** because the project has a known remote migration version mismatch and applying blindly risks disruption. Admin policy remains. Deploy the function and verify all relevant flows before manually applying the migration.
- No live card image source/license or sold-comps feed has been integrated. Pricing quality remains unresolved. Do not ask the user to test until broader batch is ready.

## 20. 2026-10-21 further hardening / automated checks

- `5e1289b2`: server-side AI creation now refuses near-duplicate cards already present as Sheets bridge rows without set UUID, returning HTTP 409 and candidate IDs for review. Sheets bridge accepts incomplete legacy card number/brand fields instead of breaking ownership on older catalog rows. **Caveat:** the bridge still trusts client-supplied identity; requires authoritative Google Sheets validation to be a fully trusted import path.
- `8ced59e1`: CI workflow now performs `deno check` for both Supabase Edge Functions, in addition to inline JavaScript syntax and structural regression checks. Inspect first Deno run; no live API tests.
- `78d4bd8f`: active eBay asking-price fallback now suppresses an estimate when the range is more than twice the median (or fewer than three matches). This improves truthfulness, but can reduce the number of cards with a displayed price. This does not replace confirmed sold comps.
- Existing SQL migration `007_restrict_catalog_client_writes.sql` is still **staged, not applied**. No user acceptance testing requested until a larger batch is ready.

## 21. 2026-10-21 pricing UUID bridge and auto-retry protections

- `87974199`: price refresh now calls `resolveOwnershipCardId` if a Sheets catalog slug has not been mapped to a Supabase UUID. This calls the authenticated server bridge, avoiding the Edge Function rejecting a slug with HTTP 400. Also removed dead `soldPrice` variable.
- `ff38b538`: automatic price errors are locally cooled down for 30 minutes to avoid repeatedly hitting limited free pricing APIs; manual refresh remains possible.
- `4a7f2176`: regression checks cover the new UUID bridge, retry cooldown and backend duplicate conflict behavior.
- No signed-in browser testing yet. RLS hardening migration remains staged/unapplied, and a free verified sold-comps source and licensed shared images remain unresolved.

## 22. 2026-10-21 data completeness and UI consistency

- `7f6b8d03`: card detail pricing no longer hides the latest insufficient active-asking evidence behind an older positive estimate; current CardPricer reference marks still take precedence.
- `52665591`: `safeTableLoad` pages PostgREST SELECT results in 1,000-row chunks (up to 30,000) to avoid silently truncating user ownership and price data at default 1,000 rows. This is an interim approach; long-term use filtered server-side reads for scaling.
- `c11dde56`, `902aa797`: newly created and previously existing Supabase bridge rows are immediately indexed by both UUID and Sheets catalog slug. This should let fresh pricing appear without requiring full page reload.
- `6e9af4d7`, `b4e41c2c`: structural CI checks cover pagination, latest evidence precedence, and new bridge indexing.

**Release/testing gate:** All CI jobs and latest Pages deployment must complete successfully. Database RLS migration 007 remains unapplied pending live bridge validation. No real signed-in browser integration test has been performed, and free sold-comps and shared image acquisition are not solved. Do not claim final completion until those limits are acknowledged and an acceptance test is scheduled.

## 23. 2026-10-21 catalog relationship and handler safety fixes

- `b64fc409`: authenticated Sheets bridge resolves sport and exact card set on the server, creating a shared unverified set when necessary. This gives new bridge cards a `sport_id` and `card_set_id` instead of dropping crucial set metadata needed for pricing and navigation. Edge Function deploy passed. **Existing bridge rows are not automatically backfilled**, so legacy rows may still lack these relationships.
- `b84d4ff3`: browser passes Sheets sport and set name to the bridge.
- `96afde37`: simultaneous bridge requests for the same Sheets card share one promise and new/existing rows are indexed without a full catalog reload.
- `fd217e64`, `aab4e561`: inline click handlers now JSON-encode card/set IDs before HTML attribute escaping, preventing apostrophes in IDs from breaking JavaScript string literals and reducing injection risk.
- `baa46a04`, `ecc96eed`: CI regression checks cover relationship bridging, request coalescing and click-handler encoding.

**Important outstanding issues:** The Sheets bridge still trusts the browser's provided catalog data rather than verifying it against a trusted server-side catalog; the unverified AI card create flow has no authoritative photo source; sold comps are unavailable; RLS migration 007 remains staged due to migration drift. CI checks are not live signed-in acceptance tests. Keep manual test session until backend integration is ready.

## 24. 2026-10-21 collection-first UI redesign

User supplied screenshots of SetScribe, CollX, Market Movers, and Wayne Collection as visual references. Redesign is original styling, not a copy of their copyrighted UI or card images. The main requested patterns were: mobile two-column card gallery, image-forward tiles, short player/set labels, clear valuation and quantity, quick grid/list selection, mobile bottom navigation, and prominent Add action.

- `b68aa235`: updated light/dark palette, typography, card image aspect ratio, dense two-column mobile card grids, search/filter controls, card metadata, price hierarchy, and accessible grid/list toggle for My Collection. CSS is appended at end of existing stylesheet to override earlier rules without changing application data logic.
- `69fdb1e6`: added mobile-only bottom navigation (Home, Catalog, Add, Collection, Community) that uses existing `showScreen` and `openAddCardModal` actions, including selected tab styling and mobile safe-area padding.
- `8d17f64f`: CI structural checks for new navigation and grid/list controls.

**Visual testing is still required** on actual mobile/desktop browsers. Check sticky navigation does not obscure content, two-column tile overflow, list-view selection, image fallbacks, modal stacking, and dark theme. No third-party reference screenshot or third-party card image is embedded in the site. Desktop remains sidebar-driven.
