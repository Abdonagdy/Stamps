/**
 * Application orchestrator
 * Manages workflow state, file handling, AI analysis, and user actions.
 */

(function () {
  // DOM Elements
  const els = {
    pdf1: document.getElementById("pdf1"),
    pdf2: document.getElementById("pdf2"),
    pdf3: document.getElementById("pdf3"),
    stamp: document.getElementById("stamp"),
    pdf1Name: document.getElementById("pdf1-name"),
    pdf2Name: document.getElementById("pdf2-name"),
    pdf3Name: document.getElementById("pdf3-name"),
    stampName: document.getElementById("stamp-name"),
    stampPreview: document.getElementById("stamp-preview"),
    stampPreviewContainer: document.getElementById("stamp-preview-container"),
    apiKey: document.getElementById("api-key"),
    stampAll: document.getElementById("stamp-all"),
    startProcessing: document.getElementById("start-processing"),
    analysisLog: document.getElementById("analysis-log"),
    reviewSummary: document.getElementById("review-summary"),
    pdfViewerContainer: document.getElementById("pdf-viewer-container"),
    stampEditorContainer: document.getElementById("stamp-editor-container"),
    approveDownload: document.getElementById("approve-download"),
    editStamp: document.getElementById("edit-stamp"),
    resetStamp: document.getElementById("reset-stamp"),
    cancelEdit: document.getElementById("cancel-edit"),
    applyChanges: document.getElementById("apply-changes"),
    backToUploadReview: document.getElementById("back-to-upload-review"),
    backToUploadEdit: document.getElementById("back-to-upload-edit"),
    steps: {
      upload: document.getElementById("step-upload"),
      analysis: document.getElementById("step-analysis"),
      review: document.getElementById("step-review"),
      edit: document.getElementById("step-edit"),
    },
    // Navigation
    navTabs: document.querySelectorAll(".nav-tab"),
    tabContents: document.querySelectorAll(".tab-content"),
    // Signature tab
    sigPdf: document.getElementById("sig-pdf"),
    sigSignature: document.getElementById("sig-signature"),
    sigStamp: document.getElementById("sig-stamp"),
    sigPdfName: document.getElementById("sig-pdf-name"),
    sigSignatureName: document.getElementById("sig-signature-name"),
    sigStampName: document.getElementById("sig-stamp-name"),
    sigSignaturePreview: document.getElementById("sig-signature-preview"),
    sigStampPreview: document.getElementById("sig-stamp-preview"),
    sigSignaturePreviewContainer: document.getElementById("sig-signature-preview-container"),
    sigStampPreviewContainer: document.getElementById("sig-stamp-preview-container"),
    sigProcess: document.getElementById("sig-process"),
    sigPdfViewerContainer: document.getElementById("sig-pdf-viewer-container"),
    sigReviewInfo: document.getElementById("sig-review-info"),
    sigDownload: document.getElementById("sig-download"),
    sigBack: document.getElementById("sig-back"),
    sigSteps: {
      upload: document.getElementById("sig-step-upload"),
      review: document.getElementById("sig-step-review"),
    },
  };

  // Application state
  const state = {
    files: { pdf1: null, pdf2: null, pdf3: null, stamp: null },
    docs: { pdf1: null, pdf2: null, pdf3: null },
    stamp: null,
    merged: null,
    candidates: [],
    bestCandidate: null,
    placements: [],
    finalPdfBytes: null,
    currentViewer: null,
    currentEditor: null,
    originalGeminiResult: null,
    // Signature tab state
    sig: {
      pdfFile: null,
      pdfDoc: null,
      signatureFile: null,
      signatureStamp: null,
      stampFile: null,
      stampStamp: null,
      area: null,
      finalPdfBytes: null,
    },
  };

  function showStep(stepName) {
    Object.values(els.steps).forEach((el) => el.classList.remove("active"));
    els.steps[stepName].classList.add("active");
  }

  function showSigStep(stepName) {
    Object.values(els.sigSteps).forEach((el) => el.classList.remove("active"));
    els.sigSteps[stepName].classList.add("active");
  }

  function switchTab(tabId) {
    els.navTabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabId);
    });
    els.tabContents.forEach((content) => {
      content.classList.toggle("active", content.id === tabId);
    });
  }

  function updateFileName(element, file) {
    element.textContent = file ? file.name : "No file selected";
  }

  function validateUploads() {
    const ready =
      state.docs.pdf1 &&
      state.docs.pdf2 &&
      state.docs.pdf3 &&
      state.stamp &&
      els.apiKey.value.trim().length > 0;
    els.startProcessing.disabled = !ready;
  }

  function validateSignatureUploads() {
    const ready =
      state.sig.pdfDoc &&
      state.sig.signatureStamp &&
      state.sig.stampStamp;
    els.sigProcess.disabled = !ready;
  }

  async function handleFileUpload(key, file) {
    state.files[key] = file;
    validateUploads();

    if (key.startsWith("pdf")) {
      updateFileName(els[`${key}Name`], file);
      state.docs[key] = null;
      validateUploads();
      try {
        const doc = await PDFHandler.loadDocument(file);
        if (state.files[key] === file) {
          state.docs[key] = doc;
        }
      } catch (err) {
        console.error(err);
        let message = `Failed to load ${file.name}:\n${err.message}`;
        if (err.message && err.message.toLowerCase().includes("no pdf header")) {
          message += `\n\nThis means the file is not a valid PDF. It may be corrupt, password-protected, or its extension was changed.`;
        }
        message += `\n\nTo debug: open "debug-upload.html" and select the file. Also press F12 and check the Console.`;
        alert(message);
      }
    } else if (key === "stamp") {
      updateFileName(els.stampName, file);
      state.stamp = null;
      els.stampPreviewContainer.classList.add("hidden");
      validateUploads();
      try {
        const stamp = await StampEngine.loadStampImage(file);
        if (state.files[key] === file) {
          state.stamp = stamp;
          els.stampPreview.src = state.stamp.dataUrl;
          els.stampPreviewContainer.classList.remove("hidden");
        }
      } catch (err) {
        console.error(err);
        alert(`Failed to load stamp ${file.name}: ${err.message}`);
      }
    }
    validateUploads();
  }

  async function handleSignatureFileUpload(key, file) {
    if (key === "pdf") {
      state.sig.pdfFile = file;
      state.sig.pdfDoc = null;
      updateFileName(els.sigPdfName, file);
      validateSignatureUploads();
      try {
        const doc = await PDFHandler.loadDocument(file);
        if (state.sig.pdfFile === file) {
          state.sig.pdfDoc = doc;
        }
      } catch (err) {
        console.error(err);
        let message = `Failed to load ${file.name}:\n${err.message}`;
        if (err.message && err.message.toLowerCase().includes("no pdf header")) {
          message += `\n\nThis means the file is not a valid PDF. It may be corrupt, password-protected, or its extension was changed.`;
        }
        alert(message);
      }
    } else if (key === "signature") {
      state.sig.signatureFile = file;
      state.sig.signatureStamp = null;
      updateFileName(els.sigSignatureName, file);
      els.sigSignaturePreviewContainer.classList.add("hidden");
      validateSignatureUploads();
      try {
        const stamp = await StampEngine.loadStampImage(file);
        if (state.sig.signatureFile === file) {
          state.sig.signatureStamp = stamp;
          els.sigSignaturePreview.src = stamp.dataUrl;
          els.sigSignaturePreviewContainer.classList.remove("hidden");
        }
      } catch (err) {
        console.error(err);
        alert(`Failed to load signature ${file.name}: ${err.message}`);
      }
    } else if (key === "stamp") {
      state.sig.stampFile = file;
      state.sig.stampStamp = null;
      updateFileName(els.sigStampName, file);
      els.sigStampPreviewContainer.classList.add("hidden");
      validateSignatureUploads();
      try {
        const stamp = await StampEngine.loadStampImage(file);
        if (state.sig.stampFile === file) {
          state.sig.stampStamp = stamp;
          els.sigStampPreview.src = stamp.dataUrl;
          els.sigStampPreviewContainer.classList.remove("hidden");
        }
      } catch (err) {
        console.error(err);
        alert(`Failed to load stamp ${file.name}: ${err.message}`);
      }
    }
    validateSignatureUploads();
  }

  function addLog(message, type = "pending") {
    const li = document.createElement("li");
    li.textContent = message;
    li.className = type;
    els.analysisLog.appendChild(li);
    li.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearLog() {
    els.analysisLog.innerHTML = "";
  }

  async function ensureAllLoaded() {
    const missingFiles = [];
    if (!state.files.pdf1) missingFiles.push("PDF 1");
    if (!state.files.pdf2) missingFiles.push("PDF 2");
    if (!state.files.pdf3) missingFiles.push("PDF 3");
    if (!state.files.stamp) missingFiles.push("Stamp");
    if (missingFiles.length > 0) {
      throw new Error(`Please upload: ${missingFiles.join(", ")}`);
    }

    if (!state.docs.pdf1) {
      addLog("Loading PDF 1...", "active");
      state.docs.pdf1 = await PDFHandler.loadDocument(state.files.pdf1);
      markLastLogDone();
    }
    if (!state.docs.pdf2) {
      addLog("Loading PDF 2...", "active");
      state.docs.pdf2 = await PDFHandler.loadDocument(state.files.pdf2);
      markLastLogDone();
    }
    if (!state.docs.pdf3) {
      addLog("Loading PDF 3...", "active");
      state.docs.pdf3 = await PDFHandler.loadDocument(state.files.pdf3);
      markLastLogDone();
    }
    if (!state.stamp) {
      addLog("Loading stamp...", "active");
      state.stamp = await StampEngine.loadStampImage(state.files.stamp);
      markLastLogDone();
    }
  }

  async function runAnalysis() {
    showStep("analysis");
    clearLog();

    try {
      await ensureAllLoaded();

      addLog("Merging documents...", "active");
      const merged = await PDFHandler.mergeDocuments(
        state.docs.pdf1,
        state.docs.pdf2,
        state.docs.pdf3
      );
      state.merged = merged;
      markLastLogDone();

      const candidateIndices = PDFHandler.getCandidatePageIndices(merged.pageMapping);
      addLog(`Found ${candidateIndices.length} candidate pages (PDF 2 & PDF 3).`);

      const apiKey = els.apiKey.value.trim();
      const candidates = [];
      let pdf2Started = false;
      let pdf3Started = false;

      for (const mergedPageIndex of candidateIndices) {
        const info = PDFHandler.getPageInfo(merged.pageMapping, mergedPageIndex);
        if (info.sourcePdfIndex === 2 && !pdf2Started) {
          addLog("Analyzing PDF 2...", "active");
          pdf2Started = true;
        }
        if (info.sourcePdfIndex === 3 && !pdf3Started) {
          markAllActiveDone();
          addLog("Analyzing PDF 3...", "active");
          pdf3Started = true;
        }

        addLog(`Analyzing page ${info.sourcePageNumber} of PDF ${info.sourcePdfIndex}...`, "active");

        const image = await PDFHandler.renderPageToImage(
          merged.mergedPdfjsDocument,
          mergedPageIndex,
          1.5
        );

        const result = await Gemini.analyzePage(image.dataUrl, apiKey);
        candidates.push({ mergedPageIndex, info, result });
        markLastLogDone();

        if (result.found) {
          addLog(`  → Candidate found on merged page ${mergedPageIndex + 1}: confidence ${Math.round(result.confidence * 100)}%`);
        } else {
          addLog(`  → No suitable area on merged page ${mergedPageIndex + 1}.`);
        }
      }

      state.candidates = candidates;

      addLog("Selecting best stamp location...", "active");
      const best = Gemini.pickBest(candidates);
      state.bestCandidate = best;
      markLastLogDone();

      if (!best) {
        throw new Error("No suitable stamp location found in PDF 2 or PDF 3.");
      }

      addLog(`Best location: merged page ${best.mergedPageIndex + 1} (${Math.round(best.result.confidence * 100)}% confidence).`);
      state.originalGeminiResult = { ...best.result };

      // Prepare placements
      const stampAll = els.stampAll.checked;
      if (stampAll) {
        state.placements = candidates
          .filter((c) => c.result.found && typeof c.result.x === "number")
          .map((c) => ({ mergedPageIndex: c.mergedPageIndex, ...c.result }));
      } else {
        state.placements = [{ mergedPageIndex: best.mergedPageIndex, ...best.result }];
      }

      addLog("Applying stamp...", "active");
      await generateFinalPdf();
      markLastLogDone();

      showReview();
    } catch (err) {
      console.error(err);
      addLog(`Error: ${err.message}`, "error");
      let message = `Processing failed:\n${err.message}`;
      if (err.message && err.message.toLowerCase().includes("no pdf header")) {
        message += `\n\nOne of the uploaded PDF files is not valid. It may be corrupt, password-protected, or its extension was changed.`;
      }
      message += `\n\nTip: Open "generate-test-pdfs.html" to create valid test files, or "debug-upload.html" to inspect a file.`;
      alert(message);
      showStep("upload");
    }
  }

  function markLastLogDone() {
    const items = Array.from(els.analysisLog.querySelectorAll("li.active"));
    if (items.length === 0) return;
    const last = items[items.length - 1];
    last.classList.replace("active", "done");
  }

  function markAllActiveDone() {
    const items = Array.from(els.analysisLog.querySelectorAll("li.active"));
    items.forEach((li) => li.classList.replace("active", "done"));
  }

  async function generateFinalPdf() {
    console.log("[generateFinalPdf] started");
    console.log("[generateFinalPdf] placements:", state.placements);
    console.log("[generateFinalPdf] docs:", {
      pdf1: state.docs.pdf1 ? { pages: state.docs.pdf1.pdfLibDocument.getPageCount() } : null,
      pdf2: state.docs.pdf2 ? { pages: state.docs.pdf2.pdfLibDocument.getPageCount() } : null,
      pdf3: state.docs.pdf3 ? { pages: state.docs.pdf3.pdfLibDocument.getPageCount() } : null,
      stamp: state.stamp ? { width: state.stamp.width, height: state.stamp.height } : null,
    });

    // Build the merged PDF directly from the uploaded source documents every time
    // so repeated edits never stack stamps and we never depend on cached bytes.
    const merged = await PDFLib.PDFDocument.create();
    const copied1 = await merged.copyPages(state.docs.pdf1.pdfLibDocument, state.docs.pdf1.pdfLibDocument.getPageIndices());
    const copied2 = await merged.copyPages(state.docs.pdf2.pdfLibDocument, state.docs.pdf2.pdfLibDocument.getPageIndices());
    const copied3 = await merged.copyPages(state.docs.pdf3.pdfLibDocument, state.docs.pdf3.pdfLibDocument.getPageIndices());
    copied1.forEach((page) => merged.addPage(page));
    copied2.forEach((page) => merged.addPage(page));
    copied3.forEach((page) => merged.addPage(page));

    console.log("[generateFinalPdf] merged pages:", merged.getPageCount());

    if (merged.getPageCount() === 0) {
      throw new Error("Merged document has no pages.");
    }

    await StampEngine.placeStampOnPages(merged, state.stamp, state.placements);
    console.log("[generateFinalPdf] stamps placed");

    // Try multiple save strategies to work around pdf-lib edge cases.
    let pdfBytes = await merged.save();
    console.log("[generateFinalPdf] default save length:", pdfBytes ? pdfBytes.length : "null");

    if (!pdfBytes || pdfBytes.length === 0) {
      console.warn("[generateFinalPdf] default save empty, trying useObjectStreams:false");
      pdfBytes = await merged.save({ useObjectStreams: false });
      console.log("[generateFinalPdf] useObjectStreams:false length:", pdfBytes ? pdfBytes.length : "null");
    }

    if (!pdfBytes || pdfBytes.length === 0) {
      console.warn("[generateFinalPdf] still empty, trying saveAsBase64");
      const base64 = await merged.saveAsBase64({ dataUri: false });
      pdfBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      console.log("[generateFinalPdf] saveAsBase64 length:", pdfBytes.length);
    }

    state.finalPdfBytes = pdfBytes;
    console.log("[generateFinalPdf] final length:", state.finalPdfBytes.length);

    if (!state.finalPdfBytes || state.finalPdfBytes.length === 0) {
      throw new Error("Failed to save the final PDF: output is empty after all attempts.");
    }

    // Pass a copy to pdf.js so it cannot mutate or drain the saved bytes.
    state.merged.mergedPdfjsDocument = await pdfjsLib.getDocument({
      data: state.finalPdfBytes.slice(),
    }).promise;
    console.log("[generateFinalPdf] viewer document updated");
    console.log("[generateFinalPdf] finalPdfBytes still:", state.finalPdfBytes.length);
  }

  async function showReview() {
    showStep("review");

    // Safety net: ensure the final PDF exists before showing the review screen.
    if (!state.finalPdfBytes || state.finalPdfBytes.length === 0) {
      console.warn("[showReview] finalPdfBytes is missing or empty; regenerating...");
      try {
        await generateFinalPdf();
      } catch (err) {
        console.error(err);
        addLog(`Error: ${err.message}`, "error");
        alert(`The final PDF could not be generated:\n${err.message}`);
        showStep("upload");
        return;
      }
    }

    const best = state.bestCandidate;
    const stampAll = els.stampAll.checked;
    let summary = `AI Confidence: ${Math.round(best.result.confidence * 100)}%`;
    if (stampAll) {
      const pages = state.placements.map((p) => p.mergedPageIndex + 1).join(", ");
      summary += ` | Stamps placed on pages: ${pages}`;
    } else {
      summary += ` | Stamp placed on page: ${best.mergedPageIndex + 1}`;
    }
    els.reviewSummary.textContent = summary;

    state.currentViewer = new PDFViewer.CompleteViewer(
      els.pdfViewerContainer,
      state.merged.mergedPdfjsDocument
    );
    await state.currentViewer.renderAll();
    state.currentViewer.scrollToPage(best.mergedPageIndex);
  }

  async function downloadFinalPdf() {
    // If the final PDF is not ready, try to generate it on demand.
    if (!state.finalPdfBytes || state.finalPdfBytes.length === 0) {
      console.warn("[Download] finalPdfBytes missing, regenerating on demand...");
      try {
        await generateFinalPdf();
      } catch (err) {
        console.error(err);
        alert(`Failed to generate the PDF for download:\n${err.message}`);
        return;
      }
    }

    if (!state.finalPdfBytes || state.finalPdfBytes.length === 0) {
      alert("No stamped PDF is available to download. Please complete the analysis first.");
      return;
    }

    console.log("[Download] PDF bytes:", state.finalPdfBytes.length);

    const blob = new Blob([state.finalPdfBytes.buffer || state.finalPdfBytes], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stamped-document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Delay revoking the object URL to ensure the browser starts the download.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function openStampEditor() {
    showStep("edit");
    state.currentEditor = new PDFViewer.StampEditor(
      els.stampEditorContainer,
      state.merged.mergedPdfjsDocument,
      state.stamp,
      state.bestCandidate.mergedPageIndex,
      state.placements
    );
    state.currentEditor.render();
  }

  async function applyStampChanges() {
    if (!state.currentEditor) return;
    state.placements = state.currentEditor.getCurrentNormalized();
    await generateFinalPdf();
    await showReview();
  }

  async function runSignatureProcess() {
    if (!state.sig.pdfDoc || !state.sig.signatureStamp || !state.sig.stampStamp) {
      alert("Please upload the PDF, signature, and stamp first.");
      return;
    }

    try {
      const pdfjsDoc = state.sig.pdfDoc.pdfjsDocument;
      const pageCount = pdfjsDoc.numPages;

      const candidates = [];
      for (let i = 0; i < pageCount; i++) {
        const area = await SignatureEngine.findSignatureArea(pdfjsDoc, i);
        if (area.found) {
          candidates.push(area);
        }
      }

      if (candidates.length === 0) {
        alert('Could not find "Signed by the Subconsultant", "Signature" or "توقيع" in the PDF.');
        return;
      }

      // Pick the candidate closest to the bottom of its page (smallest y).
      candidates.sort((a, b) => a.textBounds.y - b.textBounds.y);
      const area = candidates[0];

      state.sig.area = area;
      console.log("[Signature] found area:", area);

      // Build a fresh PDF from the original upload.
      const sourceBytes = state.sig.pdfDoc.bytes.slice();
      const pdfDoc = await PDFLib.PDFDocument.load(sourceBytes);

      await SignatureEngine.placeSignatureAndStamp(
        pdfDoc,
        state.sig.signatureStamp,
        state.sig.stampStamp,
        area
      );

      let pdfBytes = await pdfDoc.save();
      if (!pdfBytes || pdfBytes.length === 0) {
        pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      }
      if (!pdfBytes || pdfBytes.length === 0) {
        const base64 = await pdfDoc.saveAsBase64({ dataUri: false });
        pdfBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      }

      state.sig.finalPdfBytes = pdfBytes;

      if (!state.sig.finalPdfBytes || state.sig.finalPdfBytes.length === 0) {
        throw new Error("Failed to save the signed PDF.");
      }

      await showSignatureReview();
    } catch (err) {
      console.error(err);
      alert(`Signature processing failed:\n${err.message}`);
      showSigStep("upload");
    }
  }

  async function showSignatureReview() {
    showSigStep("review");

    if (!state.sig.finalPdfBytes || state.sig.finalPdfBytes.length === 0) {
      await runSignatureProcess();
      return;
    }

    const viewerDoc = await pdfjsLib.getDocument({
      data: state.sig.finalPdfBytes.slice(),
    }).promise;

    els.sigPdfViewerContainer.innerHTML = "";
    const pageIndex = state.sig.area ? state.sig.area.pageIndex : 0;
    const page = await viewerDoc.getPage(pageIndex + 1);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.style.position = "relative";

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport: viewport,
    }).promise;

    wrapper.appendChild(canvas);

    if (state.sig.area) {
      const overlay = SignatureEngine.createOverlay(state.sig.area, scale);
      wrapper.appendChild(overlay);
    }

    els.sigPdfViewerContainer.appendChild(wrapper);
    els.sigReviewInfo.querySelector("p").textContent = `Large stamp and signature placed on page ${pageIndex + 1}.`;
  }

  async function downloadSignaturePdf() {
    if (!state.sig.finalPdfBytes || state.sig.finalPdfBytes.length === 0) {
      try {
        await runSignatureProcess();
      } catch (err) {
        console.error(err);
        alert(`Failed to generate the signed PDF:\n${err.message}`);
        return;
      }
    }

    const blob = new Blob([state.sig.finalPdfBytes.buffer || state.sig.finalPdfBytes], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signed-document.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function resetSignatureTab() {
    state.sig = {
      pdfFile: null,
      pdfDoc: null,
      signatureFile: null,
      signatureStamp: null,
      stampFile: null,
      stampStamp: null,
      area: null,
      finalPdfBytes: null,
    };

    els.sigPdf.value = "";
    els.sigSignature.value = "";
    els.sigStamp.value = "";
    updateFileName(els.sigPdfName, null);
    updateFileName(els.sigSignatureName, null);
    updateFileName(els.sigStampName, null);
    els.sigSignaturePreviewContainer.classList.add("hidden");
    els.sigStampPreviewContainer.classList.add("hidden");
    els.sigPdfViewerContainer.innerHTML = "";
    els.sigReviewInfo.querySelector("p").textContent = "Large stamp placed next to the label and signature on the right.";
    validateSignatureUploads();
    showSigStep("upload");
  }

  function backToUpload() {
    showStep("upload");
  }

  // Event listeners
  els.pdf1.addEventListener("change", (e) => handleFileUpload("pdf1", e.target.files[0]));
  els.pdf2.addEventListener("change", (e) => handleFileUpload("pdf2", e.target.files[0]));
  els.pdf3.addEventListener("change", (e) => handleFileUpload("pdf3", e.target.files[0]));
  els.stamp.addEventListener("change", (e) => handleFileUpload("stamp", e.target.files[0]));
  els.apiKey.addEventListener("input", validateUploads);

  els.startProcessing.addEventListener("click", runAnalysis);
  els.approveDownload.addEventListener("click", downloadFinalPdf);
  els.editStamp.addEventListener("click", openStampEditor);
  els.resetStamp.addEventListener("click", () => {
    if (state.currentEditor) {
      state.currentEditor.reset();
    }
  });
  els.cancelEdit.addEventListener("click", showReview);
  els.applyChanges.addEventListener("click", applyStampChanges);
  els.backToUploadReview.addEventListener("click", backToUpload);
  els.backToUploadEdit.addEventListener("click", backToUpload);

  // Tab switching
  els.navTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Signature tab listeners
  els.sigPdf.addEventListener("change", (e) => handleSignatureFileUpload("pdf", e.target.files[0]));
  els.sigSignature.addEventListener("change", (e) => handleSignatureFileUpload("signature", e.target.files[0]));
  els.sigStamp.addEventListener("change", (e) => handleSignatureFileUpload("stamp", e.target.files[0]));
  els.sigProcess.addEventListener("click", runSignatureProcess);
  els.sigDownload.addEventListener("click", downloadSignaturePdf);
  els.sigBack.addEventListener("click", resetSignatureTab);
})();
