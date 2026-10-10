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

  // This catalog prices the raw card variant. Do not mix in graded examples.
  return /\b(psa|bgs|sgc|cgc|beckett|graded|gem mint|pristine|slabbed)\b/i.test(title);
}

function evaluateListing(title: string, card: Record<string, any>, playerName: string, setName: string) {
  if (isExcludedListing(title)) return { matched: false, score: 0, reasons: [] as string[] };

  const person = playerName || String(card.name ?? "");
  if (!person || !phraseInTitle(title, person)) {
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
  if (parallel) {
    if (!phraseInTitle(title, parallel)) return { matched: false, score: 0, reasons: [] as string[] };
    score += 15;
    reasons.push("parallel");
  } else {
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
  const brand = String(card.card_brand ?? card.card_sets?.brand ?? "").trim();
  if (brand) {
    if (!phraseInTitle(title, brand)) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }
    score += 5;
    reasons.push("brand");
  }

  // Series/set names vary across catalog feeds and eBay titles. Accept either
  // the explicit set name or series, but if neither is present, reject the
  // listing instead of silently counting another set.
  const series = String(card.card_series ?? card.card_sets?.series ?? "").trim();
  const setMatched = Boolean(setName && phraseInTitle(title, setName));
  const seriesMatched = Boolean(series && phraseInTitle(title, series));
  if (setName || series) {
    if (!setMatched && !seriesMatched) {
      return { matched: false, score: 0, reasons: [] as string[] };
    }
    score += setMatched ? 10 : 8;
    reasons.push(setMatched ? "set" : "series");
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

async function fetchSoldgraphComps(apiKey: string, query: string) {
  const url = new URL("https://api.soldgraph.com/v1/ebay/sold");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "200");
  url.searchParams.set("item_location", "domestic");

  let response = await fetch(url.toString(), {
    headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
  });
  let payload = await response.json();

  if (!response.ok) {
    console.error("Soldgraph sold-comps error", response.status, JSON.stringify(payload).slice(0, 500));
    throw new Error("The sold-comps provider could not complete this search.");
  }

  // A cache miss starts an asynchronous job. Poll its documented job URL;
  // polling does not consume additional searches/credits.
  const startedAt = Date.now();
  while (payload.status === "pending" && payload.poll_url && Date.now() - startedAt < 45000) {
    const pollUrl = "https://api.soldgraph.com" + String(payload.poll_url) + "?wait=20";
    response = await fetch(pollUrl, {
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
    });
    payload = await response.json();
    if (!response.ok) {
      console.error("Soldgraph job poll error", response.status, JSON.stringify(payload).slice(0, 500));
      throw new Error("The sold-comps search is still processing. Please try again shortly.");
    }
  }

  if (payload.status === "pending") {
    throw new Error("Sold comps are taking longer than expected. Try refreshing this card again shortly.");
  }
  if (payload.status !== "complete" || !payload.result) {
    console.error("Soldgraph job did not complete", JSON.stringify(payload).slice(0, 500));
    throw new Error("The sold-comps provider did not return a completed result.");
  }

  return payload.result;
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
  const soldgraphKey = Deno.env.get("SOLDGRAPH_KEY");
  const hasEbayCredentials = Boolean(ebayClientId && ebayClientSecret);

  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "The pricing service is missing its Supabase server configuration." }, 503);
  if (!soldgraphKey && !hasEbayCredentials) {
    return jsonResponse({
      error: "Pricing is not configured. Add SOLDGRAPH_KEY in Supabase Edge Function secrets, or configure both EBAY_CLIENT_ID and EBAY_CLIENT_SECRET as a fallback.",
    }, 503);
  }

  // Verify the caller's session using the public anon key and their own JWT.
  try {
    const authResponse = await fetch(supabaseUrl + "/auth/v1/user", {
      headers: { Authorization: authorization, apikey: apiKeyHeader },
    });
    if (!authResponse.ok) return jsonResponse({ error: "Your session is invalid or expired. Please sign in again." }, 401);
  } catch {
    return jsonResponse({ error: "Could not verify your sign-in. Please try again." }, 502);
  }

  let body: { card_id?: unknown };
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

    let setName = "";
    let setYear: number | null = null;
    let setBrand = "";
    let setSeries = "";
    if (card.card_set_id) {
      const sets = await fetchJson(
        supabaseUrl + "/rest/v1/card_sets?id=eq." + encodeURIComponent(card.card_set_id) + "&select=name,year,brand,series",
        serviceKey,
      );
      const set = Array.isArray(sets) ? sets[0] : null;
      if (set) {
        setName = String(set.name ?? "");
        setYear = set.year == null ? null : Number(set.year);
        setBrand = String(set.brand ?? "");
        setSeries = String(set.series ?? "");
      }
    }

    const cardForMatch = {
      ...card,
      card_sets: { name: setName, year: setYear, brand: setBrand, series: setSeries },
    };
    const effectiveYear = card.year_made ?? setYear;
    const query = buildSearchQuery(cardForMatch, playerName || String(card.name ?? ""), setName);
    if (!query.trim()) return jsonResponse({ error: "This card does not have enough identifying details to search pricing." }, 422);

    // Prefer actual sold listings when an optional Soldgraph key is configured.
    // This is the stronger valuation signal; eBay Browse API remains the no-extra-
    // service fallback and is always labeled as active asking prices.
    if (soldgraphKey) {
      try {
        const soldResult = await fetchSoldgraphComps(soldgraphKey, query);
        const soldRows = Array.isArray(soldResult.data) ? soldResult.data : [];
        const soldMatches: Array<{ title: string; price: number; soldDate: string; url: string; bestOffer: boolean }> = [];

        for (const item of soldRows) {
          const title = String(item.title ?? "");
          const evaluation = evaluateListing(title, cardForMatch, playerName || String(card.name ?? ""), setName);
          if (!evaluation.matched || isExcludedListing(title)) continue;
          const price = parseMoney(item.displayed_price?.amount);
          if (price === null || String(item.displayed_price?.currency ?? "USD").toUpperCase() !== "USD") continue;
          if (item.displayed_price_range) continue;
          soldMatches.push({
            title,
            price,
            soldDate: String(item.sold_date ?? ""),
            url: String(item.link ?? ""),
            bestOffer: Boolean(item.best_offer_accepted),
          });
        }

        const soldPrices = soldMatches
          .filter((item) => !item.bestOffer)
          .map((item) => item.price)
          .sort((a, b) => a - b);
        const soldMedian = median(soldPrices);
        const soldLow = soldPrices.length ? soldPrices[0] : null;
        const soldHigh = soldPrices.length ? soldPrices[soldPrices.length - 1] : null;
        const soldConfidence = soldPrices.length >= 10 ? 92
          : soldPrices.length >= 5 ? 85
          : soldPrices.length >= 3 ? 72
          : soldPrices.length ? 45 : 0;

        // Only publish a sold-based value with at least three price-readable,
        // title-matched sales after excluding accepted-offer asking prices.
        if (soldPrices.length >= 3 && soldMedian !== null) {
          const soldNote = "Based on " + soldPrices.length +
            " title-matched eBay sold listing(s), excluding listings marked as accepted best offers because their displayed prices may not be the actual sale amount. Sold listing coverage is one provider page, not a complete sales history. Verify exact parallel/condition before relying on this estimate." +
            (effectiveYear ? " Year checked: " + effectiveYear + "." : "");
          const soldRecord = {
            card_id: card.id,
            source: "ebay_sold_comps",
            estimated_value: soldMedian,
            asking_median: null,
            low_price: soldLow,
            high_price: soldHigh,
            listing_count: soldPrices.length,
            confidence: soldConfidence,
            price_note: soldNote,
            source_url: "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query) + "&LH_Sold=1&LH_Complete=1",
            fetched_at: new Date().toISOString(),
          };

          await fetchJson(
            supabaseUrl + "/rest/v1/card_prices?on_conflict=card_id,source",
            serviceKey,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify(soldRecord),
            },
          );

          return jsonResponse({
            success: true,
            source: "ebay_sold_comps",
            source_type: "sold_listings",
            card_id: card.id,
            query,
            estimated_value: soldMedian,
            asking_median: null,
            low_price: soldLow,
            high_price: soldHigh,
            listing_count: soldPrices.length,
            confidence: soldConfidence,
            price_note: soldNote,
            source_url: soldRecord.source_url,
            fetched_at: soldRecord.fetched_at,
            matches: soldMatches.slice(0, 10).map((item) => ({
              title: item.title,
              price: item.price,
              sold_date: item.soldDate,
              url: item.url,
              best_offer_accepted: item.bestOffer,
            })),
          });
        }
        console.info("Sold comps did not provide at least three exact, price-readable matches; falling back to active eBay listings.");
      } catch (soldError) {
        // Keep pricing usable if the optional provider is temporarily unavailable.
        console.warn("Sold-comps lookup unavailable; falling back to active eBay listings.", soldError);
      }
    }

    if (!hasEbayCredentials) {
      return jsonResponse({
        error: "Soldgraph did not return enough reliable matching sales, and eBay fallback is not configured. Check Soldgraph logs and the card's set/year/card number.",
      }, 502);
    }

    const token = await getEbayAccessToken(ebayClientId!, ebayClientSecret!);
    const searchQueries = buildSearchQueries(cardForMatch, playerName || String(card.name ?? ""), setName);
    const summariesById = new Map<string, Record<string, any>>();
    let successfulSearches = 0;
    let lastSearchError: { status: number; text: string } | null = null;

    // Search broad-to-specific and deduplicate items returned by multiple queries.
    for (const searchQuery of searchQueries.slice(0, 5)) {
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
    const confidence = filtered.length === 0
      ? 0
      : Math.round(Math.max(5, Math.min(95,
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
