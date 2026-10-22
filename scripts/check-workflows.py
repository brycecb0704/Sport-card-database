#!/usr/bin/env python3
"""Regression checks for critical no-cost collection workflows.

These are structural checks, not substitutes for live Supabase/browser tests.
"""
from pathlib import Path

html = Path("index.html").read_text(encoding="utf-8")
pricing = Path("supabase/functions/refresh-card-price/index.ts").read_text(encoding="utf-8")
creation = Path("supabase/functions/create-identified-card/index.ts").read_text(encoding="utf-8")

checks = {
    "AI identification triggers price lookup": "void priceIdentifiedCatalogMatch(data)" in html,
    "AI identification exposes explicit shared-card action": 'onclick="createIdentifiedCard()"' in html,
    "shared creation uses authenticated edge function": 'functions.invoke("create-identified-card"' in html,
    "shared creation requires explicit confirmation": 'const confirmed = confirm(' in html,
    "new shared cards remain unverified": "verified:false" in creation,
    "new card identity has database uniqueness guard": "identity_key:identity" in creation,
    "new card backend verifies auth session": '"/auth/v1/user"' in creation,
    "new card creation is rate limited": "recent.length>=20" in creation,
    "price lookup does not reload whole catalog": "const refreshedPrice = result.data;\n    await loadDatabase();" not in html,
    "silent automatic price lookup supported": "forceRefresh = false,\n  silent = false" in html,
    "raw pricing filters graded references": "titleIsGraded" in pricing and "isRaw" in pricing,
    "collection actions available": all('setOwnershipAction(\''+x+'\')' in html for x in ("Bought","Sold","Traded","Graded","For Sale")),
    "no duplicate async keyword": "async async function" not in html,
    "freshly bridged cards update lookup indexes": "supabaseCardByCatalogId.set(String(linked.card_id), linked)" in html,
    "dynamic card IDs encoded safely in click handlers": "onclick=\"openEditCard('\u0024{escapeHtml(card.card_id)}')\"" not in html and 'escapeHtml(JSON.stringify(String(card.card_id)))' in html,
    "Sheets bridge passes sport and set": "set_name: getSetName(catalogCard)" in html and "sport: catalogCard.sport" in html,
    "Sheets bridge persists shared relationships": "sport_id:sportId,card_set_id:setId" in creation,
    "concurrent bridge requests coalesced": "pendingCatalogBridges.has(key)" in html,
    "responsive mobile navigation": 'class="mobile-collector-nav"' in html and 'data-screen="collection"' in html,
    "collection grid/list controls": 'id="collectionGridView"' in html and 'id="collectionListView"' in html and 'function setCollectionView(view)' in html,
    "paginated Supabase reads": ".range(page * pageSize, (page + 1) * pageSize - 1)" in html,
    "price cache excludes failed or zero valuations": "Number(row.estimated_value) > 0" in pricing and "row.estimated_value !== null" in pricing,
    "pricing cache prefers reference evidence": "sourcePriority(b.source) - sourcePriority(a.source)" in pricing,
    "pricing validates authenticated caller": '"/auth/v1/user"' in pricing,
    "pricing refuses non UUID card IDs": 'A valid catalog card ID is required.' in pricing,
    "AI bridge requires authenticated caller": '"/auth/v1/user"' in creation,
    "AI bridge keeps catalog rows unverified": 'source:"Google Sheets bridge",verified:false' in creation,
    "recent failed asking evidence takes precedence": "if (latestActive) return latestActive;" in html,
    "pricing bridges catalog slug to UUID": "resolvedPriceCardId = await resolveOwnershipCardId(cardId)" in html,
    "automatic pricing failure cooldown": "automaticPricingFailures" in html,
    "backend duplicate guard returns conflict": "possible_duplicates" in creation and "409" in creation,
}
failed = [label for label, ok in checks.items() if not ok]
for label, ok in checks.items():
    print(("PASS" if ok else "FAIL") + ": " + label)
if failed:
    raise SystemExit(1)
print("Structural regression checks passed.")
