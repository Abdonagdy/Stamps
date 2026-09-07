/**
 * PDF Handler
 * Loads PDFs, merges PDF 1 + PDF 2 + PDF 3, and maintains a page mapping.
 */

const PDFHandler = (function () {
  // Use the locally downloaded PDF.js worker for maximum compatibility.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";

  async function fileToArrayBuffer(file) {
    if (typeof file.arrayBuffer === "function") {
      return file.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function logPdfHeader(bytes) {
    if (bytes.length === 0) {
      console.log("[PDF Debug] File is empty (0 bytes).");
      return;
    }
    const header = new TextDecoder().decode(bytes.slice(0, 20));
    console.log(`[PDF Debug] File header: "${header.replace(/\n/g, "\\n")}" | Size: ${bytes.length} bytes`);
  }

  async function loadDocument(file) {
    const arrayBuffer = await fileToArrayBuffer(file);
    const bytes = new Uint8Array(arrayBuffer);

    logPdfHeader(bytes);

    const pdfDocument = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pdfLibDoc = await PDFLib.PDFDocument.load(bytes.slice());
    return {
      file,
      bytes,
      pageCount: pdfDocument.numPages,
      pdfjsDocument: pdfDocument,
      pdfLibDocument: pdfLibDoc,
    };
  }

  async function mergeDocuments(doc1, doc2, doc3) {
    const merged = await PDFLib.PDFDocument.create();
    const copied1 = await merged.copyPages(doc1.pdfLibDocument, doc1.pdfLibDocument.getPageIndices());
    const copied2 = await merged.copyPages(doc2.pdfLibDocument, doc2.pdfLibDocument.getPageIndices());
    const copied3 = await merged.copyPages(doc3.pdfLibDocument, doc3.pdfLibDocument.getPageIndices());

    copied1.forEach((page) => merged.addPage(page));
    copied2.forEach((page) => merged.addPage(page));
    copied3.forEach((page) => merged.addPage(page));

    const pageMapping = [];
    let globalPage = 1;

    for (let i = 0; i < copied1.length; i++) {
      pageMapping.push({
        mergedPage: globalPage++,
        sourcePdfIndex: 1,
        sourcePageIndex: i,
        sourcePageNumber: i + 1,
      });
    }
    for (let i = 0; i < copied2.length; i++) {
      pageMapping.push({
        mergedPage: globalPage++,
        sourcePdfIndex: 2,
        sourcePageIndex: i,
        sourcePageNumber: i + 1,
      });
    }
    for (let i = 0; i < copied3.length; i++) {
      pageMapping.push({
        mergedPage: globalPage++,
        sourcePdfIndex: 3,
        sourcePageIndex: i,
        sourcePageNumber: i + 1,
      });
    }

    const mergedBytes = await merged.save();
    const mergedPdfjsDoc = await pdfjsLib.getDocument({ data: mergedBytes }).promise;

    return {
      mergedPdfLibDocument: merged,
      mergedBytes,
      mergedPdfjsDocument: mergedPdfjsDoc,
      pageMapping,
      totalPages: pageMapping.length,
    };
  }

  function getCandidatePageIndices(pageMapping) {
    return pageMapping
      .filter((entry) => entry.sourcePdfIndex === 2 || entry.sourcePdfIndex === 3)
      .map((entry) => entry.mergedPage - 1);
  }

  function getPageInfo(pageMapping, mergedPageIndex) {
    return pageMapping[mergedPageIndex];
  }

  async function renderPage(pdfjsDocument, pageIndex, canvas, scale = 1.0) {
    const page = await pdfjsDocument.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    return { page, viewport };
  }

  async function renderPageToImage(pdfjsDocument, pageIndex, scale = 1.5) {
    const page = await pdfjsDocument.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      width: viewport.width,
      height: viewport.height,
    };
  }

  async function reloadMergedFromOriginals(doc1, doc2, doc3) {
    const doc1Reloaded = await PDFLib.PDFDocument.load(doc1.bytes.slice(), {
      updateMetadata: false,
    });
    const doc2Reloaded = await PDFLib.PDFDocument.load(doc2.bytes.slice(), {
      updateMetadata: false,
    });
    const doc3Reloaded = await PDFLib.PDFDocument.load(doc3.bytes.slice(), {
      updateMetadata: false,
    });

    const merged = await PDFLib.PDFDocument.create();
    const copied1 = await merged.copyPages(doc1Reloaded, doc1Reloaded.getPageIndices());
    const copied2 = await merged.copyPages(doc2Reloaded, doc2Reloaded.getPageIndices());
    const copied3 = await merged.copyPages(doc3Reloaded, doc3Reloaded.getPageIndices());

    copied1.forEach((page) => merged.addPage(page));
    copied2.forEach((page) => merged.addPage(page));
    copied3.forEach((page) => merged.addPage(page));

    return merged;
  }

  return {
    loadDocument,
    mergeDocuments,
    getCandidatePageIndices,
    getPageInfo,
    renderPage,
    renderPageToImage,
    reloadMergedFromOriginals,
  };
})();
