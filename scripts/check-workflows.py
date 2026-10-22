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
