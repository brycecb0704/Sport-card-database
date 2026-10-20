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

  const prompt = `You are reading a sports/trading card from photo(s). Return ONLY a JSON object, no other text, no markdown fences.

Fields to return (use "" for anything you cannot determine, never guess):
{
  "Name": "player's full name",
  "Sport": "Baseball | Football | Basketball | Hockey | Soccer | UFC | Boxing | Racing | Wrestling | Other",
  "Team": "team name if shown",
  "Position": "player's position if shown on the card, e.g. Outfielder, Quarterback, Point Guard",
  "Card Number": "the card number, usually preceded by # on the card",
  "Card Series": "the specific product line, e.g. Chrome, Prizm, Optic",
  "Card Brand": "Topps, Panini, Upper Deck, etc.",
  "Year Made": "the year printed on the card, numbers only",
  "Parallel": "e.g. Refractor, Aqua Refractor, Silver, Gold, Base - leave blank if it's a plain base card",
  "Numbered": "Yes/No/Unknown, only Yes when serial numbering is printed",
  "Serial Numbering": "exact stamped numbering such as 12/99 or 1/1, blank if none visible",
  "Print Run": "numeric total print run only if explicitly known from visible numbering",
  "Rookie": "Yes, No, or Unknown - only Yes if an RC logo or rookie marking is visible",
  "Patch": "Yes, No, or Unknown - Yes only if a fabric/jersey patch is visible",
  "Relic": "Yes, No, or Unknown - Yes only if a memorabilia piece is part of the card",
  "Autographed": "Yes, No, or Unknown - Yes only if an autograph or autograph label is visible",
  "Variant Type": "specific image/variation type if identifiable, otherwise blank",
  "Insert Card": "Yes/No/Unknown only when the card is visibly an insert/subset",
  "Short Print": "Yes/No/Unknown only when supported by the card or reliable visible markings",
  "Variation": "Yes/No/Unknown only when supported by visible evidence",
  "Barcode": "barcode text only if readable on the back",
  "Weight Division": "combat sports division only if printed or clearly identifiable",
  "Confidence": "high, medium, or low",
  "Notes": "briefly state uncertain fields; do not guess"
}`;


  try {
    let aiResult: any = null;
    let lastStatus = 0;
    let lastError = "";
    // The old working Apps Script retried temporary Gemini busy/rate-limit errors.
    // Keep that resilience here without changing the website's API contract.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const aiResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        {
          method: "POST",
          signal: AbortSignal.timeout(30000),
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
                  { text: "This is the BACK of the SAME card. Use it to read the printed number/year/set:" },
                  { inline_data: { mime_type: backMimeType, data: backImage } },
                ] : []),
              ],
            }],
            generationConfig: {
              maxOutputTokens: 2048,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );

      lastStatus = aiResponse.status;
      const responseText = await aiResponse.text();
      try { aiResult = JSON.parse(responseText); } catch { aiResult = { raw_response: responseText.slice(0, 1000) }; }
      if (aiResponse.ok) break;

      lastError = String(aiResult?.error?.message || aiResult?.message || "Gemini request failed");
      console.error("Gemini identification request failed:", lastStatus, lastError.slice(0, 400));
      if ((lastStatus === 429 || lastStatus === 503) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      if (lastStatus === 429) {
        return jsonResponse({ error: "Gemini is rate-limiting card identification right now. Wait briefly and try again." }, 429);
      }
      return jsonResponse({ error: "Gemini request failed (" + lastStatus + "): " + lastError.slice(0, 220) }, 502);
    }

    const generatedText = aiResult?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    if (!generatedText) {
      const finishReason = String(aiResult?.candidates?.[0]?.finishReason || "");
      console.error("Gemini returned no identification text. Finish reason:", finishReason);
      return jsonResponse({ error: "Gemini returned no card details" + (finishReason ? " (reason: " + finishReason + ")" : "") + ". Try a clear, straight-on photo." }, 422);
    }

    let card: Record<string, unknown>;
    try {
      card = JSON.parse(generatedText);
    } catch {
      console.error("Gemini returned non-JSON identification output:", generatedText.slice(0, 500));
      return jsonResponse({ error: "Gemini returned card details in an unreadable format. Please try again." }, 502);
    }

    // Normalize values to the exact shape expected by the existing website form.
    const textValue = (...values: unknown[]) => {
      const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
      return value === undefined ? "" : String(value).trim();
    };
    const yes = (...values: unknown[]) => {
      const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
      return value === true || /^(yes|true|1|y)$/i.test(String(value ?? "").trim());
    };
    const serialNumbering = textValue(card["Serial Numbering"], card.serial_numbering, card.serialNumbering);
    const numberedLabel = textValue(card["Numbered"], card.numbered);
    const numberedText = serialNumbering || (/^(?:\d+\/\d+|\/\d+)$/i.test(numberedLabel) ? numberedLabel : "");
    const normalized = {
      name: textValue(card["Name"], card.name, card["Player Name"], card.player_name),
      sport: textValue(card["Sport"], card.sport),
      team: textValue(card["Team"], card.team, card["Team Name"], card.team_name),
      position: textValue(card["Position"], card.position),
      weight_division: textValue(card["Weight Division"], card.weight_division, card.weightDivision),
      card_number: textValue(card["Card Number"], card.card_number, card.cardNumber),
      card_series: textValue(card["Card Series"], card.card_series, card.series),
      card_brand: textValue(card["Card Brand"], card.card_brand, card.brand),
      year_made: textValue(card["Year Made"], card.year_made, card.year),
      parallel: textValue(card["Parallel"], card.parallel),
      set_name: textValue(card["Set Name"], card.set_name, card.setName),
      barcode: textValue(card["Barcode"], card.barcode, card.barcode_text),
      variant_type: textValue(card["Variant Type"], card.variant_type, card.variant),
      serial_numbering: numberedText,
      print_run: Number(textValue(card["Print Run"], card.print_run, card.printRun)) || null,
      numbered: yes(card["Numbered"], card.numbered) || !!numberedText,
      rookie: yes(card["Rookie"], card.rookie),
      patch: yes(card["Patch"], card.patch),
      relic: yes(card["Relic"], card.relic),
      insert_card: yes(card["Insert Card"], card.insert_card, card.insertCard),
      short_print: yes(card["Short Print"], card.short_print, card.shortPrint),
      variation: yes(card["Variation"], card.variation),
      autographed: yes(card["Autographed"], card.autographed, card.autograph),
      confidence: ["high", "medium", "low"].includes(textValue(card["Confidence"], card.confidence).toLowerCase())
        ? textValue(card["Confidence"], card.confidence).toLowerCase()
        : "medium",
      notes: textValue(card["Notes"], card.notes),
    };

    if (!normalized.name && !normalized.card_brand && !normalized.set_name && !normalized.card_number) {
      return jsonResponse({
        error: "I couldn't identify enough details from that photo. Try a clear, straight-on photo of the front and back of the card.",
      }, 422);
    }

    return jsonResponse({ card: normalized });
  } catch (error) {
    console.error("Unexpected card-identification error:", error);
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return jsonResponse({
      error: timedOut
        ? "Gemini took too long to identify this card. Try again with a clear front photo and, if needed, a separate back photo."
        : "Card identification hit an unexpected error. Please try again."
    }, timedOut ? 504 : 500);
  }
});
