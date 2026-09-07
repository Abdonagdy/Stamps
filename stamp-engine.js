/**
 * Stamp Engine
 * Handles stamp image loading, coordinate conversion, and pdf-lib placement.
 */

const StampEngine = (function () {
  async function loadStampImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          resolve({
            dataUrl: reader.result,
            file,
            width: img.width,
            height: img.height,
            aspectRatio: img.width / img.height,
          });
        };
        img.onerror = () => reject(new Error("Failed to load stamp image."));
        img.src = reader.result;
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
    const extension = getImageExtension(stamp.file);
    const bytes = dataUrlToUint8Array(stamp.dataUrl);
    if (extension === "png") {
      return pdfDoc.embedPng(bytes);
    }
    return pdfDoc.embedJpg(bytes);
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
