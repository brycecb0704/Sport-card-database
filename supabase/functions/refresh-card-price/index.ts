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
const MAX_SEARCH_RESULTS = 50;

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
  return Number.isFinite(n) && n > 0 && n < 100000000 ? n : null;
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
    "case break", "break spot", "digital card", "custom card", "reprint",
    "proxy card", "facsimile", "replica card", "or best offer lot",
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
  } else if (card.numbered || card.print_run) {
    const printRun = Number(card.print_run);
    const serialMentioned = /\b\d+\s*\/\s*\d+\b/.test(title) ||
      (printRun > 0 && new RegExp("\\b/\\s*" + printRun + "\\b").test(title));
    if (!serialMentioned) return { matched: false, score: 0, reasons: [] as string[] };
    score += 5;
    reasons.push("serial-number evidence");
  }

  const brand = String(card.card_brand ?? card.card_sets?.brand ?? "").trim();
  if (brand && phraseInTitle(title, brand)) {
    score += 5;
    reasons.push("brand");
  }

  if (setName && phraseInTitle(title, setName)) {
    score += 10;
    reasons.push("set");
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
  else if (setName) parts.push(setName);
  if (playerName) parts.push(playerName);
  if (number) parts.push("#" + number);
  if (parallel) parts.push(parallel);
  return [...new Set(parts.filter(Boolean))].join(" ").slice(0, 180);
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

  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "The pricing service is missing its Supabase server configuration." }, 503);
  if (!ebayClientId || !ebayClientSecret) {
    return jsonResponse({
      error: "Pricing is not configured yet. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Supabase Edge Function secrets.",
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

    const token = await getEbayAccessToken(ebayClientId, ebayClientSecret);
    const searchUrl = "https://api.ebay.com/buy/browse/v1/item_summary/search?q=" +
      encodeURIComponent(query) + "&limit=" + MAX_SEARCH_RESULTS +
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
      console.error("eBay Browse API error", ebayResponse.status, ebayText.slice(0, 700));
      const message = ebayResponse.status === 401 || ebayResponse.status === 403
        ? "eBay denied Browse API access. Check your production keyset and API permissions."
        : ebayResponse.status === 429
        ? "eBay rate limit reached. Wait a bit before refreshing this card again."
        : "eBay's active-listing search failed. Please try again later.";
      return jsonResponse({ error: message }, ebayResponse.status === 429 ? 429 : 502);
    }

    const ebayData = JSON.parse(ebayText);
    const summaries = Array.isArray(ebayData.itemSummaries) ? ebayData.itemSummaries : [];
    const matches: Array<{ title: string; price: number; url: string; score: number; reasons: string[] }> = [];

    for (const item of summaries) {
      const title = String(item.title ?? "");
      const evaluation = evaluateListing(title, cardForMatch, playerName || String(card.name ?? ""), setName);
      if (!evaluation.matched) continue;
      const price = parseMoney(item.price?.value);
      if (price === null || String(item.price?.currency ?? item.price?.currencyId ?? "USD").toUpperCase() !== "USD") continue;
      matches.push({
        title,
        price,
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
    const confidence = filtered.length === 0
      ? 0
      : Math.round(Math.max(10, Math.min(95, avgScore - (filtered.length < 3 ? 25 : filtered.length < 5 ? 12 : 0))));

    // Only publish an estimated value when there are at least three plausible
    // matches and the matching evidence is reasonably strong. Otherwise the
    // asking median remains visible, but the catalog value stays unset.
    const estimatedValue = filtered.length >= 3 && confidence >= 65 ? askingMedian : null;
    const priceNote = filtered.length === 0
      ? "No sufficiently close active eBay listings matched this card. No value was estimated. This search covers active asking prices, not completed sales."
      : "Based on " + filtered.length + " matching active eBay listing(s). Median asking price excludes shipping; active listings are not confirmed sales. " +
        (estimatedValue === null
          ? "Too few reliable matches to publish an estimated value; verify the exact set, card number, and parallel."
          : "Estimated value is a rough asking-price indicator, not a sold-comps valuation.") +
        (effectiveYear ? " Year checked: " + effectiveYear + "." : "");

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
      estimated_value: estimatedValue,
      asking_median: askingMedian,
      low_price: lowPrice,
      high_price: highPrice,
      listing_count: filtered.length,
      confidence,
      price_note: priceNote,
      source_url: record.source_url,
      matches: filtered.slice(0, 10).map((item) => ({ title: item.title, price: item.price, url: item.url, score: item.score })),
    });
  } catch (error) {
    console.error("refresh-card-price error", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "An unexpected pricing error occurred.",
    }, 500);
  }
});
