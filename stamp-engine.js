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
   * Detect the dominant background color by sampling the four corners.
   * Ignores fully-transparent pixels. Returns an object with r, g, b values.
   */
  function detectBackgroundColor(data, width, height) {
    const corners = [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: 0, y: height - 1 },
      { x: width - 1, y: height - 1 },
    ];

    let r = 0, g = 0, b = 0, count = 0;
    for (const corner of corners) {
      const i = (corner.y * width + corner.x) * 4;
      if (data[i + 3] > 0) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }

    if (count === 0) {
      return { r: 255, g: 255, b: 255 };
    }

    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count),
    };
  }

  /**
   * Check whether the image already has a large transparent area.
   * If most of it is already transparent, we leave it alone to avoid damage.
   * A small amount of transparency (e.g. anti-aliased edges) is ignored.
   */
  function hasLargeTransparency(data) {
    let transparentPixels = 0;
    const totalPixels = data.length / 4;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) {
        transparentPixels++;
      }
    }
    return transparentPixels / totalPixels > 0.30;
  }

  /**
   * Remove only the outer/connected background using flood fill from the edges.
   * This preserves interior parts of the logo that happen to match the
   * background color (e.g. white text inside a coloured circle).
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
        const tolerance = 45;
        const toleranceSq = tolerance * tolerance;

        const visited = new Uint8Array(width * height);
        const stack = [];

        function matchesBackground(x, y) {
          const i = (y * width + x) * 4;
          return (
            data[i + 3] > 0 &&
            colorDistanceSq(data[i], data[i + 1], data[i + 2], bg.r, bg.g, bg.b) <= toleranceSq
          );
        }

        function push(x, y) {
          if (x < 0 || x >= width || y < 0 || y >= height) return;
          const idx = y * width + x;
          if (visited[idx]) return;
          visited[idx] = 1;
          if (matchesBackground(x, y)) {
            stack.push({ x, y });
          }
        }

        // Seed from all edge pixels.
        for (let x = 0; x < width; x++) {
          push(x, 0);
          push(x, height - 1);
        }
        for (let y = 1; y < height - 1; y++) {
          push(0, y);
          push(width - 1, y);
        }

        while (stack.length > 0) {
          const { x, y } = stack.pop();
          const i = (y * width + x) * 4;
          data[i + 3] = 0; // make transparent

          push(x + 1, y);
          push(x - 1, y);
          push(x, y + 1);
          push(x, y - 1);
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
