/**
 * Stamp Engine
 * Handles stamp image loading, coordinate conversion, and pdf-lib placement.
 */

const StampEngine = (function () {
  function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr + dg * dg + db * db;
  }

  /**
   * Detect the dominant background color by sampling pixels along the image border.
   * This is more robust than corners alone: it handles images with transparent
   * corners but an opaque background (e.g. a circular stamp saved with a white
   * square background).
   */
  function detectBackgroundColor(data, width, height) {
    const colorCounts = new Map();
    const step = 4; // sample every 4th pixel along the border

    function recordColor(r, g, b) {
      // Round to the nearest multiple of 8 to group similar colours.
      const key = `${Math.round(r / 8) * 8},${Math.round(g / 8) * 8},${Math.round(b / 8) * 8}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }

    // Top and bottom borders.
    for (let x = 0; x < width; x += step) {
      const top = (0 * width + x) * 4;
      const bottom = ((height - 1) * width + x) * 4;
      if (data[top + 3] > 0) recordColor(data[top], data[top + 1], data[top + 2]);
      if (data[bottom + 3] > 0) recordColor(data[bottom], data[bottom + 1], data[bottom + 2]);
    }

    // Left and right borders.
    for (let y = 0; y < height; y += step) {
      const left = (y * width + 0) * 4;
      const right = (y * width + (width - 1)) * 4;
      if (data[left + 3] > 0) recordColor(data[left], data[left + 1], data[left + 2]);
      if (data[right + 3] > 0) recordColor(data[right], data[right + 1], data[right + 2]);
    }

    if (colorCounts.size === 0) {
      return { r: 255, g: 255, b: 255 };
    }

    let bestKey = null;
    let bestCount = -1;
    for (const [key, count] of colorCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }

    const [r, g, b] = bestKey.split(",").map(Number);
    return { r, g, b };
  }

  /**
   * Check whether the image is already mostly transparent.
   * Only skip processing if more than half the image is transparent.
   */
  function hasLargeTransparency(data) {
    let transparentPixels = 0;
    const totalPixels = data.length / 4;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) {
        transparentPixels++;
      }
    }
    return transparentPixels / totalPixels > 0.50;
  }

  /**
   * Remove the detected background colour from the image.
   * This removes the background everywhere (including isolated patches),
   * which is more reliable for stamps and signatures that often have a
   * solid-colour background that may not be cleanly connected to the edges.
   * The result is always a PNG.
   */
  function removeBackground(sourceDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;

        // If the image is already mostly transparent, keep it as-is.
        if (hasLargeTransparency(data)) {
          resolve(canvas.toDataURL("image/png"));
          return;
        }

        const bg = detectBackgroundColor(data, width, height);
        // Tolerance for background colour matching.
        const tolerance = 55;
        const toleranceSq = tolerance * tolerance;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 0) continue;
          const dr = data[i] - bg.r;
          const dg = data[i + 1] - bg.g;
          const db = data[i + 2] - bg.b;
          if (dr * dr + dg * dg + db * db <= toleranceSq) {
            data[i + 3] = 0; // make transparent
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Failed to process stamp image."));
      img.src = sourceDataUrl;
    });
  }

  async function loadStampImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const transparentDataUrl = await removeBackground(reader.result);
          const img = new Image();
          img.onload = () => {
            resolve({
              dataUrl: transparentDataUrl,
              file,
              width: img.width,
              height: img.height,
              aspectRatio: img.width / img.height,
            });
          };
          img.onerror = () => reject(new Error("Failed to load processed stamp image."));
          img.src = transparentDataUrl;
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function getImageExtension(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".png")) return "png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
    return "png";
  }

  async function embedStampImage(pdfDoc, stamp) {
    // loadStampImage now always returns a PNG with transparency removed,
    // so we always embed it as PNG to preserve the alpha channel.
    const bytes = dataUrlToUint8Array(stamp.dataUrl);
    return pdfDoc.embedPng(bytes);
  }

  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Gemini returns top-left normalized coordinates.
   * PDF-lib uses bottom-left coordinates.
   */
  function convertGeminiToPdfLib(page, normalized) {
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const pdfX = normalized.x * pageWidth;
    const pdfY = pageHeight - (normalized.y + normalized.height) * pageHeight;
    const pdfWidth = normalized.width * pageWidth;
    const pdfHeight = normalized.height * pageHeight;
    return { x: pdfX, y: pdfY, width: pdfWidth, height: pdfHeight };
  }

  /**
   * Place a stamp on a specific merged page using normalized top-left coords.
   */
  async function placeStampOnPage(mergedPdf, stamp, mergedPageIndex, normalized) {
    const embedded = await embedStampImage(mergedPdf, stamp);
    const page = mergedPdf.getPage(mergedPageIndex);
    const coords = convertGeminiToPdfLib(page, normalized);
    page.drawImage(embedded, {
      x: coords.x,
      y: coords.y,
      width: coords.width,
      height: coords.height,
    });
    return coords;
  }

  /**
   * Place the stamp on every provided merged page index.
   * Uses a fixed physical stamp size so the stamp looks the same on every page
   * regardless of the normalized width/height returned by Gemini.
   */
  async function placeStampOnPages(mergedPdf, stamp, placements) {
    const embedded = await embedStampImage(mergedPdf, stamp);
    const results = [];

    // Fixed stamp width in PDF points. Height is derived from the stamp's aspect ratio.
    const STAMP_WIDTH_PTS = 150;
    const STAMP_HEIGHT_PTS = STAMP_WIDTH_PTS / stamp.aspectRatio;

    for (const placement of placements) {
      const page = mergedPdf.getPage(placement.mergedPageIndex);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      // Use Gemini's x/y only for positioning; use a fixed stamp size.
      const pdfX = placement.x * pageWidth;
      const pdfY = pageHeight - placement.y * pageHeight - STAMP_HEIGHT_PTS;

      page.drawImage(embedded, {
        x: pdfX,
        y: pdfY,
        width: STAMP_WIDTH_PTS,
        height: STAMP_HEIGHT_PTS,
      });
      results.push({
        mergedPageIndex: placement.mergedPageIndex,
        coords: { x: pdfX, y: pdfY, width: STAMP_WIDTH_PTS, height: STAMP_HEIGHT_PTS },
      });
    }

    return results;
  }

  /**
   * Convert pdf-lib bottom-left coords back to normalized top-left.
   */
  function convertPdfLibToNormalized(page, pdfX, pdfY, pdfWidth, pdfHeight) {
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const x = pdfX / pageWidth;
    const y = (pageHeight - pdfY - pdfHeight) / pageHeight;
    const width = pdfWidth / pageWidth;
    const height = pdfHeight / pageHeight;
    return { x, y, width, height };
  }

  return {
    loadStampImage,
    embedStampImage,
    convertGeminiToPdfLib,
    convertPdfLibToNormalized,
    placeStampOnPage,
    placeStampOnPages,
  };
})();
