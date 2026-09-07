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
  };

  function showStep(stepName) {
    Object.values(els.steps).forEach((el) => el.classList.remove("active"));
    els.steps[stepName].classList.add("active");
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
    const best = state.bestCandidate;
    state.currentEditor = new PDFViewer.StampEditor(
      els.stampEditorContainer,
      state.merged.mergedPdfjsDocument,
      state.stamp,
      best.mergedPageIndex,
      state.placements.find((p) => p.mergedPageIndex === best.mergedPageIndex) || best.result
    );
    state.currentEditor.render();
  }

  async function applyStampChanges() {
    if (!state.currentEditor) return;
    const newNormalized = state.currentEditor.getCurrentNormalized();
    const best = state.bestCandidate;

    state.placements = state.placements.map((p) =>
      p.mergedPageIndex === best.mergedPageIndex
        ? { mergedPageIndex: best.mergedPageIndex, ...newNormalized }
        : p
    );

    await generateFinalPdf();
    await showReview();
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
    if (state.currentEditor && state.originalGeminiResult) {
      state.currentEditor.reset(state.originalGeminiResult);
    }
  });
  els.cancelEdit.addEventListener("click", showReview);
  els.applyChanges.addEventListener("click", applyStampChanges);
  els.backToUploadReview.addEventListener("click", backToUpload);
  els.backToUploadEdit.addEventListener("click", backToUpload);
})();
