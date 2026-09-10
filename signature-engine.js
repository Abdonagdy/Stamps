/**
 * Signature Engine
 * Finds signature/subconsultant labels in a single PDF and places a
 * signature/logo image and a stamp image on the corresponding line/area.
 */

const SignatureEngine = (function () {
  const SIGNATURE_LABELS = [
    "subconsultant",
    "signed by",
    "signature",
    "توقيع",
    "الاستشاري",
  ];

  function normalizeText(text) {
    return (text || "").toLowerCase().trim();
  }

  function isSignatureLabel(text) {
    const normalized = normalizeText(text);
    return SIGNATURE_LABELS.some((label) => normalized.includes(label));
  }

  /**
   * Compute the bounding box of a PDF.js text item in PDF points.
   * PDF.js text items use a transform matrix; x/y is the baseline origin.
   */
  function getItemBounds(item) {
    const width = item.width || 0;
    const height = item.height || (item.fontSize || 12);
    const x = item.transform[4];
    const y = item.transform[5];
    return {
      x,
      y,
      width,
      height,
      right: x + width,
      top: y + height,
    };
  }

  /**
   * Group PDF.js text items into lines based on their y-coordinate.
   * Returns an array of lines; each line has { text, items }.
   */
  function groupItemsIntoLines(items) {
    const tolerance = 2; // points
    const lines = [];

    for (const item of items) {
      if (!item.str) continue;
      const bounds = getItemBounds(item);
      const line = lines.find((l) => Math.abs(l.y - bounds.y) <= tolerance);
      if (line) {
        line.items.push({ item, bounds });
        line.y = (line.y * line.items.length + bounds.y) / (line.items.length + 1);
      } else {
        lines.push({ y: bounds.y, items: [{ item, bounds }] });
      }
    }

    // Sort each line left-to-right and build its full text.
    for (const line of lines) {
      line.items.sort((a, b) => a.bounds.x - b.bounds.x);
      line.text = line.items.map((entry) => entry.item.str).join(" ");
    }

    return lines;
  }

  /**
   * Compute the bounds of a substring within a line of merged items.
   */
  function computeLabelBounds(line, searchStart, labelLength) {
    let currentIndex = 0;
    let minX = Infinity;
    let maxRight = -Infinity;
    let minY = Infinity;
    let maxTop = -Infinity;

    for (const entry of line.items) {
      const itemText = entry.item.str;
      const itemStart = currentIndex;
      const itemEnd = currentIndex + itemText.length;

      // Check if this item overlaps the searched substring.
      if (itemEnd > searchStart && itemStart < searchStart + labelLength) {
        minX = Math.min(minX, entry.bounds.x);
        maxRight = Math.max(maxRight, entry.bounds.right);
        minY = Math.min(minY, entry.bounds.y);
        maxTop = Math.max(maxTop, entry.bounds.top);
      }

      currentIndex = itemEnd + 1; // +1 for the space we joined with
    }

    if (minX === Infinity) return null;

    return {
      x: minX,
      y: minY,
      width: maxRight - minX,
      height: maxTop - minY,
      right: maxRight,
      top: maxTop,
    };
  }

  /**
   * Score a match: higher is better.
   * Full phrase matches score higher than single-word matches,
   * and matches closer to the bottom of the page score higher.
   */
  function scoreMatch(match, pageHeight) {
    const fullPhrases = ["signed by the subconsultant", "signed by", "subconsultant"];
    const normalizedLine = normalizeText(match.lineText);
    const isFullPhrase = fullPhrases.some((phrase) => normalizedLine.includes(phrase));
    const phraseBonus = isFullPhrase ? 1000 : 0;

    // Lower y means closer to the bottom in PDF coordinates.
    // Normalize to 0-1 where 0 is bottom and 1 is top, then invert.
    const relativeHeight = Math.max(0, Math.min(1, match.bounds.y / pageHeight));
    const bottomBonus = (1 - relativeHeight) * 500;

    return phraseBonus + bottomBonus;
  }

  /**
   * Find the best label on the page, scanning lines of text.
   * Prefers full phrases (e.g. "Signed by the Subconsultant") and matches
   * near the bottom of the page.
   */
  async function findSignatureText(pdfjsDocument, pageIndex) {
    const page = await pdfjsDocument.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const lines = groupItemsIntoLines(textContent.items);

    const matches = [];
    for (const line of lines) {
      const normalizedLine = normalizeText(line.text);
      for (const label of SIGNATURE_LABELS) {
        const index = normalizedLine.indexOf(label);
        if (index !== -1) {
          const bounds = computeLabelBounds(line, index, label.length);
          if (bounds) {
            matches.push({
              label,
              lineText: line.text,
              bounds,
              item: line.items[0].item, // for direction detection
            });
          }
        }
      }
    }

    if (matches.length === 0) {
      return null;
    }

    matches.forEach((m) => {
      m.score = scoreMatch(m, viewport.height);
    });
    matches.sort((a, b) => b.score - a.score);
    return matches[0];
  }

  /**
   * Find the signature area on the requested page.
   * Places the signature/logo next to the label and the stamp at the far end
   * of the signature line (LTR: logo on the left, stamp on the right).
   */
  async function findSignatureArea(pdfjsDocument, pageIndex) {
    const page = await pdfjsDocument.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    const match = await findSignatureText(pdfjsDocument, pageIndex);
    if (!match) {
      return {
        found: false,
        reason: 'No "Signed by the Subconsultant", "Signature" or "توقيع" label found on the page.',
      };
    }

    const textBounds = match.bounds;
    const isRtl = match.item.dir === "rtl";
    const margin = 40;
    const padding = 12;
    const leftGap = 30; // small gap between label and stamp to push stamp right
    const lineHeight = 65; // stamp radius; stamp diameter will be up to 2*lineHeight
    const signatureHeight = 60;
    const signatureAboveLine = 8; // signature sits this many points above the line

    // Available horizontal space on the signature line.
    let availableX, availableWidth;
    if (isRtl) {
      availableX = margin;
      availableWidth = Math.max(60, textBounds.x - padding - margin);
    } else {
      availableX = textBounds.right + padding;
      availableWidth = Math.max(60, pageWidth - textBounds.right - padding - margin);
    }

    // Split the available line into stamp area (centered on the line) and
    // signature/logo area (above the line, to the right of the stamp).
    const stampRatio = 0.48;
    const signatureRatio = 0.40;

    let logoArea, stampArea;
    if (isRtl) {
      // RTL: [Signature/Logo] [Stamp] Label
      logoArea = {
        x: availableX,
        y: textBounds.y + signatureAboveLine,
        width: availableWidth * signatureRatio,
        height: signatureHeight,
      };
      stampArea = {
        x: logoArea.x + logoArea.width + padding + leftGap,
        y: textBounds.y - lineHeight,
        width: availableWidth * stampRatio,
        height: lineHeight * 2,
      };
    } else {
      // LTR: Label [Stamp] [Signature/Logo]
      stampArea = {
        x: availableX + leftGap,
        y: textBounds.y - lineHeight,
        width: availableWidth * stampRatio,
        height: lineHeight * 2,
      };
      logoArea = {
        x: stampArea.x + stampArea.width + padding,
        y: textBounds.y + signatureAboveLine,
        width: availableWidth * signatureRatio,
        height: signatureHeight,
      };
    }

    return {
      found: true,
      pageIndex,
      pageWidth,
      pageHeight,
      textBounds,
      logoArea,
      stampArea,
      isRtl,
    };
  }

  /**
   * Fit an image into a target rectangle while preserving aspect ratio.
   */
  function fitImageInArea(imageWidth, imageHeight, area, hAlign = "center", vAlign = "center") {
    const aspectRatio = imageWidth / imageHeight;
    let width = area.width;
    let height = width / aspectRatio;

    if (height > area.height) {
      height = area.height;
      width = height * aspectRatio;
    }

    let x = area.x;
    if (hAlign === "center") {
      x = area.x + (area.width - width) / 2;
    } else if (hAlign === "right") {
      x = area.x + area.width - width;
    }

    let y = area.y;
    if (vAlign === "center") {
      y = area.y + (area.height - height) / 2;
    } else if (vAlign === "top") {
      y = area.y + area.height - height;
    }

    return { x, y, width, height };
  }

  /**
   * Place the logo/signature and stamp images on the pdf-lib document.
   */
  async function placeSignatureAndStamp(pdfDoc, logoStamp, stampStamp, area) {
    const page = pdfDoc.getPage(area.pageIndex);

    const embeddedLogo = await StampEngine.embedStampImage(pdfDoc, logoStamp);
    const embeddedStamp = await StampEngine.embedStampImage(pdfDoc, stampStamp);

    const logoDims = fitImageInArea(
      logoStamp.width,
      logoStamp.height,
      area.logoArea,
      area.isRtl ? "right" : "left",
      "bottom"
    );

    const stampDims = fitImageInArea(
      stampStamp.width,
      stampStamp.height,
      area.stampArea,
      "center",
      "center"
    );

    page.drawImage(embeddedLogo, {
      x: logoDims.x,
      y: logoDims.y,
      width: logoDims.width,
      height: logoDims.height,
    });

    page.drawImage(embeddedStamp, {
      x: stampDims.x,
      y: stampDims.y,
      width: stampDims.width,
      height: stampDims.height,
    });

    return {
      logo: logoDims,
      stamp: stampDims,
    };
  }

  /**
   * Build a preview overlay showing where the logo and stamp will go.
   */
  function createOverlay(area, scale) {
    const overlay = document.createElement("div");
    overlay.className = "signature-overlay";
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = `${area.pageWidth * scale}px`;
    overlay.style.height = `${area.pageHeight * scale}px`;
    overlay.style.pointerEvents = "none";

    const logoBox = document.createElement("div");
    logoBox.className = "signature-overlay-box";
    logoBox.style.left = `${area.logoArea.x * scale}px`;
    logoBox.style.top = `${(area.pageHeight - area.logoArea.y - area.logoArea.height) * scale}px`;
    logoBox.style.width = `${area.logoArea.width * scale}px`;
    logoBox.style.height = `${area.logoArea.height * scale}px`;
    logoBox.textContent = "Logo";

    const stampBox = document.createElement("div");
    stampBox.className = "stamp-overlay-box";
    stampBox.style.left = `${area.stampArea.x * scale}px`;
    stampBox.style.top = `${(area.pageHeight - area.stampArea.y - area.stampArea.height) * scale}px`;
    stampBox.style.width = `${area.stampArea.width * scale}px`;
    stampBox.style.height = `${area.stampArea.height * scale}px`;
    stampBox.textContent = "Stamp";

    overlay.appendChild(logoBox);
    overlay.appendChild(stampBox);
    return overlay;
  }

  return {
    findSignatureArea,
    placeSignatureAndStamp,
    createOverlay,
  };
})();
