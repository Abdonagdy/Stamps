/**
 * Gemini API layer
 * Sends rendered page images to Gemini for visual stamp placement analysis.
 */

const Gemini = (function () {
  // Ordered list of models to try. Earlier entries are preferred.
  // "gemini-1.5-flash-latest" is intentionally avoided because it is no
  // longer available and returns a 404 NOT_FOUND error.
  const FALLBACK_MODELS = [
    "gemini-3.6-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-1.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-8b",
  ];

  const SYSTEM_PROMPT = `Return ONLY valid compact JSON. Find the best empty rectangular area for an official stamp/seal on this document page. Avoid text, signatures, tables, images, logos, existing stamps, fields, borders, and handwriting. Prefer designated stamp areas, empty space, and locations near signatures. Use normalized coordinates 0-1.

Return exactly:
{"found":true,"x":0.0,"y":0.0,"width":0.0,"height":0.0,"confidence":0.0,"reason":""}

If no safe area:
{"found":false,"x":null,"y":null,"width":null,"height":null,"confidence":0,"reason":""}`;

  function buildApiUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
  }

  function dataUrlToGenerativePart(dataUrl) {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data URL");
    }
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    };
  }

  async function analyzePage(dataUrl, apiKey) {
    const imagePart = dataUrlToGenerativePart(dataUrl);

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: SYSTEM_PROMPT }, imagePart],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    };

    let lastError = null;

    for (const model of FALLBACK_MODELS) {
      const url = buildApiUrl(model, apiKey);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          // If the model is not found, try the next fallback model.
          if (response.status === 404 && text.includes("is not found")) {
            lastError = new Error(`Gemini API error (${response.status}) with model ${model}: ${text}`);
            console.warn(lastError.message);
            continue;
          }
          throw new Error(`Gemini API error (${response.status}) with model ${model}: ${text}`);
        }

        const json = await response.json();
        const candidate = json.candidates && json.candidates[0];
        const content = candidate && candidate.content;
        const text = content && content.parts && content.parts[0] && content.parts[0].text;

        if (!text) {
          throw new Error("Gemini returned an empty response.");
        }

        return parseGeminiResponse(text);
      } catch (err) {
        // Network errors or non-404 API errors stop the fallback loop
        // so they can be reported to the user.
        if (err.message && err.message.includes("is not found")) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error("All Gemini models failed. Please check your API key and model availability.");
  }

  function parseGeminiResponse(rawText) {
    // Log the raw response so we can diagnose malformed JSON in the browser console.
    console.log("[Gemini] raw response:\n", rawText);

    let cleaned = rawText.trim();
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    // Try to parse the cleaned text directly.
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      // If direct parsing fails, try to extract the largest valid JSON object.
      parsed = extractJsonObject(cleaned);
      if (!parsed) {
        throw new Error(`Gemini returned invalid JSON: ${err.message}\n\nRaw response:\n${rawText}`);
      }
    }

    if (typeof parsed.found !== "boolean") {
      parsed.found = Boolean(parsed.found);
    }

    return {
      found: parsed.found,
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      reason: parsed.reason || "",
    };
  }

  /**
   * Attempt to extract a valid JSON object from a string that may contain
   * extra text or a truncated object. It scans from the first '{' and tries
   * progressively shorter substrings until JSON.parse succeeds. It also
   * attempts common truncation fixes (missing closing quote and/or brace).
   */
  function extractJsonObject(text) {
    const firstBrace = text.indexOf("{");
    if (firstBrace === -1) return null;

    const lastBrace = text.lastIndexOf("}");

    // Case 1: response ends inside a string with no closing brace at all.
    if (lastBrace === -1 || lastBrace <= firstBrace) {
      const candidates = [
        text.substring(firstBrace) + '"}',
        text.substring(firstBrace) + '}',
      ];
      for (const candidate of candidates) {
        try {
          return JSON.parse(candidate);
        } catch {
          // continue
        }
      }
      return null;
    }

    // Case 2: response has a closing brace but may be missing a closing quote.
    let end = lastBrace;
    while (end > firstBrace) {
      const slice = text.substring(firstBrace, end + 1);
      const fixes = [slice, slice + '"'];
      for (const candidate of fixes) {
        try {
          return JSON.parse(candidate);
        } catch {
          // continue
        }
      }
      end = text.lastIndexOf("}", end - 1);
    }
    return null;
  }

  function scoreCandidate(candidate) {
    let score = candidate.confidence;
    if (candidate.reason) {
      const lower = candidate.reason.toLowerCase();
      if (lower.includes("designated") || lower.includes("stamp") || lower.includes("seal") || lower.includes("ختم")) {
        score += 0.15;
      }
      if (lower.includes("signature") || lower.includes("توقيع")) {
        score += 0.08;
      }
    }
    const area = (candidate.width || 0) * (candidate.height || 0);
    score += Math.min(area * 0.5, 0.1);
    return score;
  }

  function pickBest(candidates) {
    const valid = candidates.filter((c) => c.result.found && typeof c.result.x === "number");
    if (valid.length === 0) return null;

    valid.forEach((c) => {
      c.score = scoreCandidate(c.result);
    });

    valid.sort((a, b) => b.score - a.score);
    return valid[0];
  }

  return {
    analyzePage,
    parseGeminiResponse,
    pickBest,
  };
})();
