// Sports Card Database — eBay active-listing price research
// Deploy as Supabase Edge Function: refresh-card-price
// Required Supabase Edge Function secrets:
//   EBAY_CLIENT_ID
//   EBAY_CLIENT_SECRET
// Uses active listings only. It never labels asking prices as completed sales.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRICE_SOURCE = "ebay_active_asking";
const EBAY_MARKETPLACE = "EBAY_US";
const MAX_SEARCH_RESULTS = 100;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseInTitle(title: string, phrase: string): boolean {
  const needle = normalize(phrase);
  if (!needle) return false;
  return (" " + normalize(title) + " ").includes(" " + needle + " ");
}

function numberInTitle(title: string, cardNumber: string): boolean {
  const number = String(cardNumber ?? "").trim();
  if (!number) return true;
  const normalizedTitle = normalize(title);
  const normalizedNumber = normalize(number);
  if (!normalizedNumber) return true;

  // Prefer the full printed card number (including prefixes/suffixes).
  if (phraseInTitle(normalizedTitle, normalizedNumber)) return true;

  // Some sellers omit punctuation or a leading '#'. Require digit boundaries
  // so card #12 does not accidentally match #123.
  const digits = number.match(/[a-z]*\d+[a-z]*/i)?.[0];
  if (!digits) return false;
  const escaped = digits.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])#?\\s*" + escaped + "($|[^a-z0-9])", "i").test(title);
}

function parseMoney(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 100000000
    ? Math.round(n * 100) / 100
    : null;
}

function listingTotalPrice(item: Record<string, any>): number | null {
  const itemPrice = parseMoney(item.price?.value);
  if (itemPrice === null) return null;

  const currency = String(item.price?.currency ?? item.price?.currencyId ?? "USD").toUpperCase();
  if (currency !== "USD") return null;

  // Use the lowest listed shipping option when available, so cards are compared
  // on a more realistic buyer-facing total rather than item price alone.
  const shipping = Array.isArray(item.shippingOptions)
    ? item.shippingOptions
        .map((option: Record<string, any>) => {
          const cost = parseMoney(option?.shippingCost?.value);
          const shippingCurrency = String(option?.shippingCost?.currency ?? currency).toUpperCase();
          return cost !== null && shippingCurrency === "USD" ? cost : null;
        })
        .filter((value: number | null) => value !== null)
    : [];

  const cheapestShipping = shipping.length ? Math.min(...shipping as number[]) : 0;
  return Math.round((itemPrice + cheapestShipping) * 100) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quartile(sorted: number[], fraction: number): number {
  if (sorted.length < 2) return sorted[0] ?? 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function isExcludedListing(title: string): boolean {
  const t = normalize(title);
  const exclusions = [
    "lot of", "card lot", "complete set", "team set", "full set",
    "booster pack", "hobby box", "blaster box", "mega box", "retail box",
    "value box", "fat pack", "hanger box", "case break", "break spot",
    "digital card", "custom card", "reprint", "proxy card", "facsimile",
    "replica card", "or best offer lot", "you pick", "choose your card",
    "pick your card", "read description", "not the card", "empty wrapper",
    "empty pack", "online redemption", "redemption code", "oversized card",
  ];
  if (exclusions.some((term) => (" " + t + " ").includes(" " + term + " "))) return true;

  // Reject multi-card listings even when the seller omits the word "lot".
  if (/\(\s*\d+\s*\)\s*(?:rookie\s+)?cards?\b/i.test(t) ||
      /\b(?:set of|lot of|qty\.?|quantity(?: of)?)\s*\d+\b/i.test(t) ||
      /\b\d+\s+(?:different\s+)?(?:rookie\s+)?cards?\b/i.test(t)) return true;

  // This catalog prices raw cards; do not mix graded examples.
  return /\b(psa|bgs|sgc|cgc|beckett|graded|gem mint|pristine|slabbed)\b/i.test(title);
}

function evaluateListing(title: string, card: Record<string, any>, playerName: string, setName: string) {
  if (isExcludedListing(title)) return { matched: false, score: 0, reasons: [] as string[] };

  const person = playerName || String(card.name ?? "");
  if (!person || !phraseInTitle(title, person)) {
    return { matched: false, score: 0, reasons: [] as string[] };
  }

  // A listing without a card number must at least identify the set or series;
  // otherwise a player's name/year alone is not enough to establish identity.
  if (
    !String(card.card_number ?? "").trim() &&
    !String(setName ?? "").trim() &&
    !String(card.card_series ?? card.card_sets?.series ?? "").trim()
  ) {
    return { matched: false, score: 0, reasons: [] as string[] };
  }

  const reasons: string[] = ["player"];
  let score = 35;

  const year = String(card.year_made ?? card.card_sets?.year ?? "").trim();
  if (year) {
    if (!new RegExp("(^|[^0-9])" + year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^0-9]|$)").test(title)) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }
    score += 15;
    reasons.push("year");
  }

  const cardNumber = String(card.card_number ?? "").trim();
  if (cardNumber) {
    if (!numberInTitle(title, cardNumber)) return { matched: false, score: 0, reasons: [] as string[] };
    score += 25;
    reasons.push("card number");
  }

  const parallel = String(card.parallel ?? "").trim();
  // Resolve brand before the parallel checks because the matcher uses it to
  // distinguish the target product from unrelated variations.
  const brand = String(card.card_brand ?? card.card_sets?.brand ?? "").trim();
  if (parallel) {
    if (!phraseInTitle(title, parallel)) return { matched: false, score: 0, reasons: [] as string[] };
    score += 15;
    reasons.push("parallel");
  } else {
    // For a base-card target, reject titles advertising a parallel/variation.
    // These versions must not be blended into the base card's estimate.
    const productIdentity = normalize([
      String(card.card_brand ?? card.card_sets?.brand ?? ""),
      String(card.card_series ?? card.card_sets?.series ?? ""),
      setName,
    ].join(" "));
    const parallelTerms = /\b(refractor|foilfractor|rainbow foil|gold(?:\s+foil|\s+stars)?|vintage stock|independence day|advanced stats|mother'?s day|father'?s day|memorial day|clear variation|printing plate|platinum|superfractor|orange(?:\s+border)?|purple(?:\s+border)?|yellow border|blue(?:\s+border)?|black(?:\s+border)?|pink(?:\s+parallel)?|sapphire|parallel|variation|image variation|photo variation|short print)\b/i;
    const chromeIsTargetProduct = /\bchrome\b/i.test(productIdentity);
    const chromeMismatch = !chromeIsTargetProduct && /\bchrome\b/i.test(title);
    if (!card.numbered && !card.print_run &&
        (parallelTerms.test(title) || chromeMismatch)) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }

    // Do not mix serial-numbered parallels into a base-card estimate.
    const serialMentioned = /\b\d+\s*\/\s*\d+\b/.test(title);
    if ((card.numbered || card.print_run) && !serialMentioned) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }
    if (!card.numbered && !card.print_run && serialMentioned) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }
    if (card.numbered || card.print_run) {
      score += 5;
      reasons.push("serial-number evidence");
    }
  }

  // Do not price a player's different card from the same year/number as if
  // it were this exact product. Brand must match when the catalog supplies it.
  if (brand) {
    if (!phraseInTitle(title, brand)) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }
    score += 5;
    reasons.push("brand");
  }

  // Set/series wording is inconsistent in sold-listing titles. First accept
  // an explicit set or series match. If a seller omits it, allow a cautious
  // identity-only match only after player, year, card number, and brand have
  // already matched above, and only when the title does not name a different
  // recognizable product/set. This recovers legitimate sales without blending
  // obvious Chrome, Update, Heritage, or other products into a base-card price.
  const series = String(card.card_series ?? card.card_sets?.series ?? "").trim();
  const setMatched = Boolean(setName && phraseInTitle(title, setName));
  const seriesMatched = Boolean(series && phraseInTitle(title, series));
  if (setName || series) {
    if (setMatched || seriesMatched) {
      score += setMatched ? 10 : 8;
      reasons.push(setMatched ? "set" : "series");
    } else {
      // When the listing omits the target set/series, do not use a broad
      // player/year/brand match unless the catalog also supplies a card number.
      // Without that anchor, same-player inserts and memorabilia cards can be
      // mistaken for one another.
      if (!cardNumber) {
        return { matched: false, score: 0, reasons: [] as string[] };
      }
      const targetIdentity = normalize([brand, series, setName].filter(Boolean).join(" "));
      const alternateProducts = [
        "chrome", "update", "heritage", "opening day", "big league", "archives",
        "fire", "gallery", "stadium club", "bowman", "donruss", "prizm",
        "select", "optic", "mosaic", "finest", "gypsy queen", "allen and ginter",
        "allen & ginter", "pro debut", "living set", "heritage minor league",
      ];
      const conflictingProduct = alternateProducts.some((term) =>
        phraseInTitle(title, term) && !phraseInTitle(targetIdentity, term)
      );
      if (conflictingProduct) {
        return { matched: false, score: 0, reasons: [] as string[] };
      }
      // The prior checks guarantee the title contains the exact player, year,
      // card number, and brand. Record that the set name was omitted so callers
      // can distinguish this lower-specificity but still guarded match.
      score += 3;
      reasons.push("set omitted; identity matched");
    }
  }

  return { matched: true, score: Math.min(100, score), reasons };
}

async function getEbayAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const credentials = btoa(clientId + ":" + clientSecret);
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("eBay OAuth error", response.status, detail.slice(0, 500));
    throw new Error(response.status === 401 || response.status === 403
      ? "eBay rejected the API credentials. Check that the production Client ID and Client Secret are correct."
      : "Could not obtain an eBay access token. Try again later.");
  }

  const payload = await response.json();
  if (!payload.access_token) throw new Error("eBay did not return an access token.");
  return payload.access_token;
}

function buildSearchQuery(card: Record<string, any>, playerName: string, setName: string): string {
  const parts: string[] = [];
  const year = String(card.year_made ?? card.card_sets?.year ?? "").trim();
  const brand = String(card.card_brand ?? card.card_sets?.brand ?? "").trim();
  const series = String(card.card_series ?? card.card_sets?.series ?? "").trim();
  const number = String(card.card_number ?? "").trim();
  const parallel = String(card.parallel ?? "").trim();

  if (year) parts.push(year);
  if (brand) parts.push(brand);
  if (series) parts.push(series);
  // Include both the series and the full set name; catalog feeds sometimes
  // use generic series labels that are not specific enough for sold searches.
  if (setName && normalize(setName) !== normalize(series)) parts.push(setName);
  if (playerName) parts.push(playerName);
  if (number) parts.push("#" + number);
  if (parallel) parts.push(parallel);
  return [...new Set(parts.filter(Boolean))].join(" ").slice(0, 180);
}

// Use several complementary searches instead of one over-specific query.
function buildSearchQueries(card: Record<string, any>, playerName: string, setName: string): string[] {
  const year = String(card.year_made ?? card.card_sets?.year ?? "").trim();
  const brand = String(card.card_brand ?? card.card_sets?.brand ?? "").trim();
  const series = String(card.card_series ?? card.card_sets?.series ?? "").trim();
  const number = String(card.card_number ?? "").trim();
  const parallel = String(card.parallel ?? "").trim();
  const person = playerName || String(card.name ?? "");
  const candidates = [
    buildSearchQuery(card, person, setName),
    [year, person, number ? "#" + number : "", parallel].filter(Boolean).join(" "),
    [person, number ? "#" + number : "", parallel].filter(Boolean).join(" "),
    [year, brand, person, number ? "#" + number : "", parallel].filter(Boolean).join(" "),
    [year, series, person, number ? "#" + number : "", parallel].filter(Boolean).join(" "),
  ];
  return [...new Set(candidates.map(q => q.trim().slice(0, 180)).filter(Boolean))];
}

async function fetchJson(url: string, serviceKey: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error("Supabase REST error", response.status, text.slice(0, 500));
    throw new Error("Could not read or save the card's pricing record.");
  }
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Use POST to refresh a card price." }, 405);

  const authorization = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("apikey");
  if (!authorization || !apiKeyHeader) return jsonResponse({ error: "Please sign in before refreshing prices." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ebayClientId = Deno.env.get("EBAY_CLIENT_ID");
  const ebayClientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const hasEbayCredentials = Boolean(ebayClientId && ebayClientSecret);

  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "The pricing service is missing its Supabase server configuration." }, 503);
  // Do not reject the request before trying CardPricer's free reference API.
  // If no reference match exists, the later eBay configuration check returns a
  // specific fallback error without making an unauthenticated marketplace call.

  // Verify the caller's session using the public anon key and their own JWT.
  try {
    const authResponse = await fetch(supabaseUrl + "/auth/v1/user", {
      headers: { Authorization: authorization, apikey: apiKeyHeader },
    });
    if (!authResponse.ok) return jsonResponse({ error: "Your session is invalid or expired. Please sign in again." }, 401);
  } catch {
    return jsonResponse({ error: "Could not verify your sign-in. Please try again." }, 502);
  }

  let body: { card_id?: unknown; force_refresh?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "The request body must be valid JSON." }, 400);
  }

  const cardId = String(body.card_id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId)) {
    return jsonResponse({ error: "A valid catalog card ID is required." }, 400);
  }

  try {
    const cardRows = await fetchJson(
      supabaseUrl + "/rest/v1/cards?id=eq." + encodeURIComponent(cardId) + "&select=*",
      serviceKey,
    );
    const card = Array.isArray(cardRows) ? cardRows[0] : null;
    if (!card) return jsonResponse({ error: "That card could not be found in the Supabase catalog." }, 404);

    let playerName = "";
    if (card.player_id) {
      const players = await fetchJson(
        supabaseUrl + "/rest/v1/players?id=eq." + encodeURIComponent(card.player_id) + "&select=name",
        serviceKey,
      );
      playerName = Array.isArray(players) ? String(players[0]?.name ?? "") : "";
    }

    // Prefer the normalized card_sets row, but preserve identifying metadata
    // stored directly on catalog cards when card_set_id is missing or unmatched.
    let setName = String(card.set_name ?? "");
    let setYear: number | null = card.year_made == null ? null : Number(card.year_made);
    let setBrand = String(card.card_brand ?? "");
    let setSeries = String(card.card_series ?? "");
    if (card.card_set_id) {
      const sets = await fetchJson(
        supabaseUrl + "/rest/v1/card_sets?id=eq." + encodeURIComponent(card.card_set_id) + "&select=name,year,brand,series",
        serviceKey,
      );
      const set = Array.isArray(sets) ? sets[0] : null;
      if (set) {
        setName = String(set.name ?? setName);
        setYear = set.year == null ? setYear : Number(set.year);
        setBrand = String(set.brand ?? setBrand);
        setSeries = String(set.series ?? setSeries);
      }
    }
    // If the catalog has only a series label (e.g. "Series 1"), use it as a
    // minimum set identifier rather than sending a completely generic query.
    if (!setName) setName = setSeries;

    const cardForMatch = {
      ...card,
      card_sets: { name: setName, year: setYear, brand: setBrand, series: setSeries },
    };
    const effectiveYear = card.year_made ?? setYear;
    const query = buildSearchQuery(cardForMatch, playerName || String(card.name ?? ""), setName);
    if (!query.trim()) return jsonResponse({ error: "This card does not have enough identifying details to search pricing." }, 422);

    // Shared price cache: normal/bulk requests reuse a result for 24 hours.
    // Only an explicit detail-screen refresh bypasses the cache.
    const forceRefresh = body.force_refresh === true;
    if (!forceRefresh) {
      const cachedRows = await fetchJson(
        supabaseUrl + "/rest/v1/card_prices?card_id=eq." + encodeURIComponent(String(card.id)) +
          "&select=card_id,source,estimated_value,asking_median,low_price,high_price,listing_count,confidence,price_note,source_url,fetched_at" +
          "&order=fetched_at.desc&limit=10",
        serviceKey,
      );
      const cacheRows = Array.isArray(cachedRows) ? cachedRows : [];
      const freshCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const freshRows = cacheRows.filter((row: Record<string, any>) => {
        const timestamp = Date.parse(String(row.fetched_at ?? ""));
        const supportedSource = ["cardpricer_reference", "ebay_active_asking"].includes(String(row.source ?? ""));
        return supportedSource && Number.isFinite(timestamp) && timestamp >= freshCutoff;
      });
      // Prefer stronger evidence over a newer active-asking fallback.
      const sourcePriority = (source: unknown) => {
        const value = String(source ?? "");
        if (value === "cardpricer_reference") return 2;
        if (value === "ebay_active_asking") return 1;
        return 0;
      };
      const fresh = freshRows.sort((a: Record<string, any>, b: Record<string, any>) =>
        sourcePriority(b.source) - sourcePriority(a.source) ||
        Date.parse(String(b.fetched_at ?? "")) - Date.parse(String(a.fetched_at ?? ""))
      )[0];
      if (fresh) {
        console.info("Pricing cache hit", JSON.stringify({ card_id: card.id, source: fresh.source, fetched_at: fresh.fetched_at }));
        return jsonResponse({ ...fresh, success: true, cached: true, source_type: String(fresh.source).includes("sold") ? "sold_listings" : fresh.source === "cardpricer_reference" ? "third_party_reference_mark" : "active_asking_prices" });
      }
    }

    // SoldGraph has been permanently removed from this pricing path.
    // Pricing uses the free CardPricer reference API when an exact identity
    // match is available, then eBay active listings as a clearly labeled fallback.

    // Free public reference-price fallback. CardPricer has a no-key API;
    // its sports-card marks are snapshots sourced from SportsCardsPro, so this
    // is clearly labeled as a reference mark, not fresh sold-comps evidence.
    try {
      const person = playerName || String(card.name ?? "");
      const year = String(effectiveYear ?? "").trim();
      const cardNumber = String(card.card_number ?? "").trim();
      if (person && year && cardNumber) {
        // Search by player and year first, then enforce exact card identity locally.
        // Combining every identity term into q can over-filter a provider search
        // before we get a chance to compare its returned card-number/set fields.
        const params = new URLSearchParams({
          player: person,
          year,
          limit: "200",
        });
        // Never let an optional free provider stall the entire refresh.
        const referenceAbort = new AbortController();
        const referenceTimeout = setTimeout(() => referenceAbort.abort(), 8000);
        let response: Response;
        try {
          response = await fetch("https://cardpricer.co/api/v1/cards?" + params.toString(), {
            headers: { Accept: "application/json" },
            signal: referenceAbort.signal,
          });
        } finally {
          clearTimeout(referenceTimeout);
        }
        if (response.ok) {
          const payload = await response.json();
          const rows = Array.isArray(payload?.data) ? payload.data : [];
          const matches = rows.filter((row: Record<string, any>) => {
            const rowPlayer = String(row.player_name ?? row.playerName ?? row.player ?? row.player_name_full ?? "");
            const rowTitle = String(row.card_name ?? row.name ?? row.title ?? row.full_name ?? "");
            const rowYear = String(row.year ?? "");
            const rowNumber = String(row.cardNumber ?? row.card_number ?? row.card_number_text ?? row.collector_number ?? row.collectorNumber ?? row.number ?? row.card_no ?? "").trim().replace(/^#\s*/, "").replace(/\s+/g, "").toLowerCase();
            const targetNumber = cardNumber.replace(/^#\s*/, "").replace(/\s+/g, "").toLowerCase();
            const rowSet = String(row.set_name ?? row.setName ?? row.set ?? row.series ?? row.card_set ?? "");
            const rowBrand = String(row.manufacturer ?? row.brand ?? "");
            const rowParallel = String(row.parallel ?? row.variation ?? row.variant ?? row.parallel_name ?? row.parallelName ?? "");
            const targetParallel = String(cardForMatch.parallel ?? "").trim();
            const price = parseMoney(row.current_price ?? row.currentPrice ?? row.market_price ?? row.marketPrice ?? row.price_usd ?? row.priceUsd ?? row.estimated_value ?? row.price);
            const playerMatches =
              normalize(rowPlayer) === normalize(person) ||
              (!rowPlayer && phraseInTitle(rowTitle, person));
            const setMatches = !setName && !setSeries
              ? true
              : Boolean(rowSet && (
                  normalize(rowSet) === normalize(setName) ||
                  normalize(rowSet).includes(normalize(setName)) ||
                  normalize(setName).includes(normalize(rowSet)) ||
                  Boolean(setSeries && (
                    normalize(rowSet).includes(normalize(setSeries)) ||
                    normalize(setSeries).includes(normalize(rowSet))
                  ))
                ));
            const brandMatches = !setBrand
              ? true
              : Boolean(rowBrand && (
                  normalize(rowBrand) === normalize(setBrand) ||
                  normalize(rowBrand).includes(normalize(setBrand)) ||
                  normalize(setBrand).includes(normalize(rowBrand))
                ));
            // Never use a known different parallel/variation as the reference
            // price. If this card is a parallel, an unlabelled reference row is
            // not sufficient evidence to claim that it prices that parallel.
            const parallelMatches = targetParallel
              ? Boolean(rowParallel && normalize(rowParallel) === normalize(targetParallel))
              : !rowParallel;
            return price !== null &&
              playerMatches &&
              rowYear === year &&
              rowNumber === targetNumber &&
              brandMatches &&
              setMatches &&
              parallelMatches;
          });
          if (matches.length) {
            const prices = matches.map((row: Record<string, any>) => parseMoney(row.current_price ?? row.currentPrice ?? row.market_price ?? row.marketPrice ?? row.price_usd ?? row.priceUsd ?? row.estimated_value ?? row.price)).filter((p: number | null): p is number => p !== null);
            const referenceValue = median(prices);
            if (referenceValue !== null) {
              const chosen = matches[0];
              const confidenceLabel = String(chosen.provenance?.confidence?.label ?? "unknown");
              const confidenceScore = Number(chosen.provenance?.confidence?.score ?? 0);
              const note = "Free CardPricer reference mark from its public card-price API. This is not a fresh exact-card sold-comps search. Verify condition, parallel, and provenance. Confidence: " + confidenceLabel + ".";
              const referenceRecord = {
                card_id: card.id,
                source: "cardpricer_reference",
                estimated_value: referenceValue,
                asking_median: null,
                low_price: Math.min(...prices),
                high_price: Math.max(...prices),
                listing_count: Number(chosen.provenance?.compCount ?? 0),
                confidence: Number.isFinite(confidenceScore) ? Math.max(0, Math.min(100, confidenceScore)) : 0,
                price_note: note,
                source_url: String(chosen.links?.self ?? chosen.url ?? "https://cardpricer.co"),
                fetched_at: new Date().toISOString(),
              };
              await fetchJson(
                supabaseUrl + "/rest/v1/card_prices?on_conflict=card_id,source",
                serviceKey,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
                  body: JSON.stringify(referenceRecord),
                },
              );
              console.info("CardPricer reference mark saved", JSON.stringify({
                card_id: card.id, year, card_number: cardNumber, match_count: matches.length,
                value: referenceValue, confidence: confidenceLabel,
              }));
              return jsonResponse({
                success: true,
                source: "cardpricer_reference",
                source_type: "third_party_reference_mark",
                card_id: card.id,
                estimated_value: referenceValue,
                asking_median: null,
                low_price: referenceRecord.low_price,
                high_price: referenceRecord.high_price,
                listing_count: referenceRecord.listing_count,
                confidence: referenceRecord.confidence,
                price_note: note,
                source_url: referenceRecord.source_url,
                fetched_at: referenceRecord.fetched_at,
                matches: matches.slice(0, 5).map((row: Record<string, any>) => ({
                  player: row.player, year: row.year, set: row.set, card_number: row.cardNumber,
                  price: row.current_price ?? row.currentPrice ?? row.price ?? row.market_price, provenance: row.provenance ?? null,
                })),
              });
            }
          }
          console.info("CardPricer response and identity audit", JSON.stringify({
            card_id: card.id,
            query: "player=" + person + "&year=" + year,
            api_ok: payload?.ok ?? null,
            api_version: payload?.apiVersion ?? null,
            rows_returned: rows.length,
            candidate_rows: rows.slice(0, 8).map((row: Record<string, any>) => ({
              player: row.player ?? null,
              year: row.year ?? null,
              set: row.set ?? null,
              card_number: row.cardNumber ?? row.card_number ?? row.number ?? null,
              manufacturer: row.manufacturer ?? null,
              price: row.price ?? row.current_price ?? row.currentPrice ?? row.market_price ?? null,
              grade: row.grade ?? null,
              confidence: row.provenance?.confidence?.label ?? null,
            })),
          }));
        } else {
          const errorBody = await response.text();
          console.warn("CardPricer API unavailable", JSON.stringify({
            status: response.status,
            body: errorBody.slice(0, 500),
          }));
        }
      }
    } catch (referenceError) {
      console.warn("CardPricer reference lookup failed; continuing to eBay fallback.", String(referenceError));
    }

    if (!hasEbayCredentials) {
      return jsonResponse({
        error: "CardPricer did not return a verified reference match, and eBay active-listing fallback is not configured. Check the card's year, set, and card number, or configure the eBay credentials.",
      }, 502);
    }

    const token = await getEbayAccessToken(ebayClientId!, ebayClientSecret!);
    const searchQueries = buildSearchQueries(cardForMatch, playerName || String(card.name ?? ""), setName);
    const summariesById = new Map<string, Record<string, any>>();
    let successfulSearches = 0;
    let lastSearchError: { status: number; text: string } | null = null;

    // Search three complementary query shapes, broad-to-specific, and deduplicate results. The fourth/fifth variants are intentionally skipped to limit API usage.
    for (const searchQuery of searchQueries.slice(0, 3)) {
      const searchUrl = "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" +
        encodeURIComponent(searchQuery) + "&limit=" + MAX_SEARCH_RESULTS +
        "&filter=" + encodeURIComponent("buyingOptions:{FIXED_PRICE},itemLocationCountry:US");
      const ebayResponse = await fetch(searchUrl, {
        headers: {
          Authorization: "Bearer " + token,
          "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE,
          Accept: "application/json",
        },
      });
      const ebayText = await ebayResponse.text();
      if (!ebayResponse.ok) {
        lastSearchError = { status: ebayResponse.status, text: ebayText };
        console.error("eBay Browse API search failed", searchQuery, ebayResponse.status, ebayText.slice(0, 500));
        if (ebayResponse.status === 401 || ebayResponse.status === 403 || ebayResponse.status === 429) {
          const message = ebayResponse.status === 401 || ebayResponse.status === 403
            ? "eBay denied Browse API access. Check the production Client ID, Client Secret, and Browse API permissions."
            : "eBay rate limit reached. Wait before refreshing this card again.";
          return jsonResponse({ error: message }, ebayResponse.status === 429 ? 429 : 502);
        }
        continue;
      }
      successfulSearches++;
      const ebayData = JSON.parse(ebayText);
      const rows = Array.isArray(ebayData.itemSummaries) ? ebayData.itemSummaries : [];
      for (const item of rows) {
        const key = String(item.itemId ?? item.legacyItemId ?? item.itemWebUrl ?? item.title ?? "");
        if (key && !summariesById.has(key)) summariesById.set(key, item);
      }
    }

    if (successfulSearches === 0 && lastSearchError) {
      return jsonResponse({ error: "eBay listing searches failed. Check the Edge Function logs and try again." }, 502);
    }
    const summaries = [...summariesById.values()];
    const matches: Array<{ title: string; price: number; itemPrice: number; shipping: number | null; url: string; score: number; reasons: string[] }> = [];

    for (const item of summaries) {
      const title = String(item.title ?? "");
      const evaluation = evaluateListing(title, cardForMatch, playerName || String(card.name ?? ""), setName);
      if (!evaluation.matched) continue;
      const itemPrice = parseMoney(item.price?.value);
      const price = listingTotalPrice(item);
      if (itemPrice === null || price === null) continue;

      const buyingOptions = Array.isArray(item.buyingOptions) ? item.buyingOptions : [];
      if (buyingOptions.length && !buyingOptions.includes("FIXED_PRICE")) continue;
      if (item.itemLocation?.country && String(item.itemLocation.country).toUpperCase() !== "US") continue;

      matches.push({
        title,
        price,
        itemPrice,
        shipping: Math.round((price - itemPrice) * 100) / 100,
        url: String(item.itemWebUrl ?? ""),
        score: evaluation.score,
        reasons: evaluation.reasons,
      });
    }

    // Filter extreme asking-price outliers using the IQR rule when enough
    // comparable listings exist. Small samples are kept intact and confidence
    // is lowered instead of pretending the sample is robust.
    const initialPrices = matches.map((item) => item.price).sort((a, b) => a - b);
    let filtered = matches;
    if (initialPrices.length >= 4) {
      const q1 = quartile(initialPrices, 0.25);
      const q3 = quartile(initialPrices, 0.75);
      const spread = q3 - q1;
      const lower = Math.max(0, q1 - 1.5 * spread);
      const upper = q3 + 1.5 * spread;
      filtered = matches.filter((item) => item.price >= lower && item.price <= upper);
    }

    const prices = filtered.map((item) => item.price);
    const askingMedian = median(prices);
    const lowPrice = prices.length ? Math.min(...prices) : null;
    const highPrice = prices.length ? Math.max(...prices) : null;
    const avgScore = filtered.length
      ? filtered.reduce((sum, item) => sum + item.score, 0) / filtered.length
      : 0;
    const spreadPenalty = prices.length > 1 && askingMedian !== null && askingMedian > 0
      ? Math.min(15, ((Math.max(...prices) - Math.min(...prices)) / askingMedian) * 8)
      : 0;
    // This score measures listing-match quality, not the probability that
    // the asking-price proxy equals market value. Cap it because active asks
    // are weaker evidence than confirmed completed sales.
    const confidence = filtered.length === 0
      ? 0
      : Math.round(Math.max(5, Math.min(60,
          avgScore
          - (filtered.length < 3 ? 30 : filtered.length < 5 ? 18 : filtered.length < 8 ? 10 : 0)
          - spreadPenalty
        )));

    // Active asking prices are seller expectations, not market value. Keep the
    // raw asking median separately and apply a conservative 25% adjustment for
    // the displayed fallback estimate. Do not publish an estimate from fewer
    // than three comparable listings; a tiny sample is too easy to skew.
    const askingBasedEstimate = askingMedian === null ? null : Math.round(askingMedian * 0.75 * 100) / 100;
    const estimatedValue = filtered.length >= 3 ? askingBasedEstimate : null;
    const priceNote = filtered.length === 0
      ? "No sufficiently close active eBay listings matched this card. No value was estimated. This search covers active asking prices, not completed sales."
      : "Active asking prices only—not confirmed sales. " + filtered.length + " matching listing(s); asking median $" +
        (askingMedian === null ? "unknown" : askingMedian.toFixed(2)) + ". " +
        (filtered.length >= 3
          ? "Fallback estimate is 25% below the asking median to account for seller pricing above market; this is only a rough proxy until sold comps are available."
          : "Too few matching listings to estimate market value. Asking median is shown for reference only; no estimated value was published.") +
        (filtered.length < 5 || confidence < 70
          ? " Low confidence: verify the exact set, card number, parallel, and condition."
          : "") +
        (effectiveYear ? " Year checked: " + effectiveYear + "." : "");

    console.info("Active pricing audit", JSON.stringify({
      card_id: card.id,
      query,
      search_queries: searchQueries,
      successful_searches: successfulSearches,
      raw_unique_listing_count: summaries.length,
      set_name: setName,
      player_name: playerName || String(card.name ?? ""),
      card_number: card.card_number ?? null,
      target_parallel: card.parallel ?? null,
      matched_count_before_filter: matches.length,
      matched_count_after_filter: filtered.length,
      asking_median: askingMedian,
      adjusted_estimate: estimatedValue,
      matched_listings: filtered.slice(0, 10).map((item) => ({
        title: item.title, total_price: item.price, item_price: item.itemPrice,
        shipping: item.shipping, score: item.score, match_reasons: item.reasons, url: item.url,
      })),
    }));

    const record = {
      card_id: card.id,
      source: PRICE_SOURCE,
      estimated_value: estimatedValue,
      asking_median: askingMedian,
      low_price: lowPrice,
      high_price: highPrice,
      listing_count: filtered.length,
      confidence,
      price_note: priceNote,
      source_url: "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query),
      fetched_at: new Date().toISOString(),
    };

    await fetchJson(
      supabaseUrl + "/rest/v1/card_prices?on_conflict=card_id,source",
      serviceKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(record),
      },
    );

    return jsonResponse({
      success: true,
      source: PRICE_SOURCE,
      source_type: "active_asking_prices",
      card_id: card.id,
      query,
      search_queries: searchQueries,
      searched_listing_count: summaries.length,
      successful_searches: successfulSearches,
      estimated_value: estimatedValue,
      asking_median: askingMedian,
      low_price: lowPrice,
      high_price: highPrice,
      listing_count: filtered.length,
      confidence,
      price_note: priceNote,
      source_url: record.source_url,
      matches: filtered.slice(0, 10).map((item) => ({
        title: item.title,
        price: item.price,
        item_price: item.itemPrice,
        shipping: item.shipping,
        url: item.url,
        score: item.score,
        match_reasons: item.reasons,
      })),
    });
  } catch (error) {
    console.error("refresh-card-price error", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "An unexpected pricing error occurred.",
    }, 500);
  }
});
