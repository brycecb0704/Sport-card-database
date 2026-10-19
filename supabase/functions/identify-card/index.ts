// Sports Card Database — secure card-photo identification (front/back support)
// Deploy this file as the Supabase Edge Function named "identify-card".
// Required Edge Function secret: GEMINI_API_KEY
// Keep the Gemini key in Supabase secrets; never place it in index.html.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const cardSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", description: "Player or subject name as printed on the card. Empty if unreadable." },
    sport: { type: "STRING", description: "Sport, such as Baseball, Football, Basketball, Hockey, Soccer, UFC, or Racing. Empty if uncertain." },
    team: { type: "STRING", description: "Team or organization printed on the card. Empty if not visible." },
    position: { type: "STRING", description: "Player position, if printed." },
    weight_division: { type: "STRING", description: "Combat-sports weight division, if printed." },
    card_number: { type: "STRING", description: "Card number exactly as printed, including letters or symbols." },
    card_series: { type: "STRING", description: "Series or subset name, if identifiable." },
    card_brand: { type: "STRING", description: "Manufacturer or brand, such as Topps, Bowman, Panini, or Upper Deck." },
    year_made: { type: "STRING", description: "Printed card year or release year only when reasonably identifiable." },
    parallel: { type: "STRING", description: "Parallel or variation name only when supported by visible evidence." },
    set_name: { type: "STRING", description: "Full set name when identifiable; otherwise empty." },
    barcode: { type: "STRING", description: "Barcode text only if clearly readable; otherwise empty." },
    numbered: { type: "BOOLEAN", description: "True only when serial numbering is visibly printed on the card." },
    rookie: { type: "BOOLEAN", description: "True only when a rookie indicator is visible or unambiguous." },
    patch: { type: "BOOLEAN", description: "True only when a memorabilia patch/relic is visible." },
    autographed: { type: "BOOLEAN", description: "True only when an autograph or autograph label is visibly present." },
    confidence: { type: "STRING", enum: ["high", "medium", "low"], description: "Confidence in the overall identification." },
    notes: { type: "STRING", description: "Briefly note uncertain or unreadable details and what the user should verify." },
  },
  required: [
    "name", "sport", "team", "position", "weight_division", "card_number",
    "card_series", "card_brand", "year_made", "parallel", "set_name",
    "barcode", "numbered", "rookie", "patch", "autographed", "confidence", "notes",
  ],
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Use POST for card identification." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("apikey");
  if (!authorization || !apiKeyHeader) {
    return jsonResponse({ error: "Please sign in before identifying a card." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl) {
    return jsonResponse({ error: "The Supabase URL is not configured for this function." }, 500);
  }
  if (!geminiApiKey) {
    return jsonResponse({ error: "Card identification is not configured yet. Add the GEMINI_API_KEY secret in Supabase." }, 503);
  }

  // Explicitly confirm that the caller has a valid Supabase session.
  try {
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: apiKeyHeader },
    });
    if (!authResponse.ok) {
      return jsonResponse({ error: "Your session is invalid or expired. Please sign in again." }, 401);
    }
  } catch {
    return jsonResponse({ error: "Could not verify your sign-in. Please try again." }, 502);
  }

  let payload: { image?: unknown; mime_type?: unknown; back_image?: unknown; back_mime_type?: unknown; file_name?: unknown; back_file_name?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "The request did not contain valid JSON." }, 400);
  }

  const image = typeof payload.image === "string" ? payload.image : "";
  const mimeType = typeof payload.mime_type === "string" ? payload.mime_type : "image/jpeg";
  const backImage = typeof payload.back_image === "string" ? payload.back_image : "";
  const backMimeType = typeof payload.back_mime_type === "string" ? payload.back_mime_type : "image/jpeg";
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!image) {
    return jsonResponse({ error: "Please select a card photo first." }, 400);
  }
  if (!allowedMimeTypes.includes(mimeType) || (backImage && !allowedMimeTypes.includes(backMimeType))) {
    return jsonResponse({ error: "Please use JPG, PNG, WebP, or GIF photos." }, 415);
  }
  // Bound each image and the combined payload to protect free-tier function limits.
  if (image.length > 5_000_000 || backImage.length > 5_000_000 || image.length + backImage.length > 8_000_000) {
    return jsonResponse({ error: "The photo set is too large to identify. Try smaller photos or screenshots." }, 413);
  }

  const prompt = `You identify sports trading cards from photos for a card catalog.
The first image is the FRONT of one card. If a second image is present, it is the BACK of the SAME card. Use both images together.
Prioritize readable printed text and visible card design over guesses from the player's appearance. Use the back to confirm the card number, copyright/release year, manufacturer, set, and player name when visible.
Read only details supported by the images. Do not invent a set, year, parallel, card number, or player identity.
Use empty strings for unreadable or unknown text. Distinguish the card's printed copyright/release year from statistics seasons.
Distinguish manufacturer/brand from set/series. Identify a parallel only when visibly supported by text or clear visual evidence; do not assume a foil-looking card is a named parallel from lighting alone.
Set numbered, rookie, patch, and autographed to true only when clearly supported by visible evidence; otherwise false.
If details conflict or the photo is unclear, return the readable fields, set confidence to low, and explain what needs checking in notes.
Return only the requested structured JSON. Front filename: ${String(payload.file_name || "").slice(0, 120)}. Back filename: ${String(payload.back_file_name || "").slice(0, 120)}.`;

  try {
    const aiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: image } },
              ...(backImage ? [
                { text: "BACK OF THE SAME CARD:" },
                { inline_data: { mime_type: backMimeType, data: backImage } },
              ] : []),
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: cardSchema,
            temperature: 0.1,
            maxOutputTokens: 700,
          },
        }),
      },
    );

    const aiResult = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error("Gemini identification request failed:", aiResponse.status, aiResult);
      if (aiResponse.status === 429) {
        return jsonResponse({ error: "The free AI request limit was reached. Wait a little and try again." }, 429);
      }
      return jsonResponse({ error: "The card-identification service could not process that photo. Please try a clearer image." }, 502);
    }

    const generatedText = aiResult?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("")
      .trim();

    if (!generatedText) {
      return jsonResponse({ error: "The AI could not read that card. Try a clearer photo with the card filling the frame." }, 422);
    }

    let card: Record<string, unknown>;
    try {
      card = JSON.parse(generatedText);
    } catch {
      console.error("Gemini returned non-JSON identification output.");
      return jsonResponse({ error: "The identification service returned an unreadable result. Please try again." }, 502);
    }

    // Normalize values to the exact shape expected by the existing website form.
    const normalized = {
      name: String(card.name || ""),
      sport: String(card.sport || ""),
      team: String(card.team || ""),
      position: String(card.position || ""),
      weight_division: String(card.weight_division || ""),
      card_number: String(card.card_number || ""),
      card_series: String(card.card_series || ""),
      card_brand: String(card.card_brand || ""),
      year_made: String(card.year_made || ""),
      parallel: String(card.parallel || ""),
      set_name: String(card.set_name || ""),
      barcode: String(card.barcode || ""),
      numbered: card.numbered === true,
      rookie: card.rookie === true,
      patch: card.patch === true,
      autographed: card.autographed === true,
      confidence: ["high", "medium", "low"].includes(String(card.confidence))
        ? String(card.confidence)
        : "low",
      notes: String(card.notes || ""),
    };

    if (!normalized.name && !normalized.card_brand && !normalized.set_name) {
      return jsonResponse({
        error: "I couldn't identify enough details from that photo. Try a clear, straight-on photo of the front of the card.",
      }, 422);
    }

    return jsonResponse({ card: normalized });
  } catch (error) {
    console.error("Unexpected card-identification error:", error);
    return jsonResponse({ error: "Card identification hit an unexpected error. Please try again." }, 500);
  }
});
