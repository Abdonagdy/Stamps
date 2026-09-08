/**
 * PDF Viewer
 * Renders the complete merged PDF and provides an interactive stamp editor.
 */

const PDFViewer = (function () {
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3.0;
  const ZOOM_STEP = 0.25;
  const DEFAULT_ZOOM = 1.0;

  class CompleteViewer {
    constructor(container, pdfjsDocument) {
      this.container = container;
      this.pdfjsDocument = pdfjsDocument;
      this.zoom = DEFAULT_ZOOM;
      this.canvases = [];
      this.pageWrappers = [];
      this.init();
    }

    init() {
      this.container.innerHTML = "";
      this.viewer = document.createElement("div");
      this.viewer.className = "pdf-viewer";
      this.toolbar = this.createToolbar();
      this.container.appendChild(this.toolbar);
      this.container.appendChild(this.viewer);
    }

    createToolbar() {
      const toolbar = document.createElement("div");
      toolbar.className = "viewer-toolbar";

      const zoomOut = document.createElement("button");
      zoomOut.textContent = "−";
      zoomOut.title = "Zoom out";
      zoomOut.addEventListener("click", () => this.setZoom(this.zoom - ZOOM_STEP));

      const zoomIn = document.createElement("button");
      zoomIn.textContent = "+";
      zoomIn.title = "Zoom in";
      zoomIn.addEventListener("click", () => this.setZoom(this.zoom + ZOOM_STEP));

      const fitWidth = document.createElement("button");
      fitWidth.textContent = "Fit Width";
      fitWidth.addEventListener("click", () => this.fitWidth());

      const zoomLevel = document.createElement("span");
      zoomLevel.className = "zoom-level";
      zoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;
      this.zoomLevelEl = zoomLevel;

      const firstPage = document.createElement("button");
      firstPage.textContent = "First";
      firstPage.addEventListener("click", () => this.scrollToPage(0));

      const prevPage = document.createElement("button");
      prevPage.textContent = "Prev";
      prevPage.addEventListener("click", () => this.scrollToPrevious());

      const nextPage = document.createElement("button");
      nextPage.textContent = "Next";
      nextPage.addEventListener("click", () => this.scrollToNext());

      const lastPage = document.createElement("button");
      lastPage.textContent = "Last";
      lastPage.addEventListener("click", () => this.scrollToPage(this.canvases.length - 1));

      toolbar.append(zoomOut, zoomLevel, zoomIn, fitWidth, firstPage, prevPage, nextPage, lastPage);
      return toolbar;
    }

    async renderAll() {
      this.viewer.innerHTML = "";
      this.canvases = [];
      this.pageWrappers = [];
      const pageCount = this.pdfjsDocument.numPages;

      for (let i = 0; i < pageCount; i++) {
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page-wrapper";

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";

        const label = document.createElement("span");
        label.className = "page-label";
        label.textContent = `Page ${i + 1}`;

        wrapper.appendChild(canvas);
        wrapper.appendChild(label);
        this.viewer.appendChild(wrapper);

        this.canvases.push(canvas);
        this.pageWrappers.push(wrapper);
      }

      for (let i = 0; i < pageCount; i++) {
        await PDFHandler.renderPage(this.pdfjsDocument, i, this.canvases[i], this.zoom);
      }
    }

    setZoom(value) {
      let newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
      newZoom = Math.round(newZoom / ZOOM_STEP) * ZOOM_STEP;
      this.zoom = newZoom;
      this.zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
      this.renderAll();
    }

    fitWidth() {
      const containerWidth = this.container.clientWidth - 48;
      this.pdfjsDocument.getPage(1).then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / viewport.width;
        this.setZoom(scale);
      });
    }

    scrollToPage(index) {
      if (index < 0 || index >= this.pageWrappers.length) return;
      this.pageWrappers[index].scrollIntoView({ behavior: "smooth", block: "start" });
    }

    scrollToPrevious() {
      const current = this.getCurrentPageIndex();
      if (current > 0) this.scrollToPage(current - 1);
    }

    scrollToNext() {
      const current = this.getCurrentPageIndex();
      if (current < this.canvases.length - 1) this.scrollToPage(current + 1);
    }

    getCurrentPageIndex() {
      const containerRect = this.container.getBoundingClientRect();
      let best = 0;
      let bestDistance = Infinity;
      this.pageWrappers.forEach((wrapper, index) => {
        const rect = wrapper.getBoundingClientRect();
        const distance = Math.abs(rect.top - containerRect.top);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    }

    highlightPage(index) {
      this.pageWrappers.forEach((wrapper, i) => {
        wrapper.style.boxShadow = i === index ? "0 0 0 3px var(--primary)" : "var(--shadow)";
      });
    }
  }

  class StampEditor {
    constructor(container, pdfjsDocument, stamp, activePageIndex, placements) {
      this.container = container;
      this.pdfjsDocument = pdfjsDocument;
      this.stamp = stamp;
      this.activePageIndex = activePageIndex;
      this.placements = placements.map((p) => ({ ...p }));
      this.originalPlacements = placements.map((p) => ({ ...p }));
      this.scale = 1.5;
      this.pageWrappers = [];
      this.viewports = [];
      this.stampEls = new Map(); // mergedPageIndex -> stamp element
      this.dragState = null;
    }

    async render() {
      this.container.innerHTML = "";
      this.pageWrappers = [];
      this.viewports = [];
      this.stampEls.clear();

      const viewer = document.createElement("div");
      viewer.className = "pdf-viewer";
      this.container.appendChild(viewer);

      const numPages = this.pdfjsDocument.numPages;
      for (let i = 0; i < numPages; i++) {
        const page = await this.pdfjsDocument.getPage(i + 1);
        const viewport = page.getViewport({ scale: this.scale });

        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page-wrapper";
        wrapper.dataset.pageIndex = i;

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport: viewport,
        }).promise;

        const label = document.createElement("span");
        label.className = "page-label";
        label.textContent = `Page ${i + 1}`;

        wrapper.appendChild(canvas);
        wrapper.appendChild(label);
        viewer.appendChild(wrapper);

        this.pageWrappers[i] = wrapper;
        this.viewports[i] = viewport;

        const placement = this.placements.find((p) => p.mergedPageIndex === i);
        if (placement) {
          const stampEl = this.createStampElement(i);
          wrapper.appendChild(stampEl);
          this.updateStampElementFromNormalized(i, placement);
          this.attachInteractions(stampEl, i);
        }
      }
    }

    createStampElement(pageIndex) {
      const stampEl = document.createElement("div");
      stampEl.className = "editor-stamp";
      stampEl.dataset.pageIndex = pageIndex;

      const img = document.createElement("img");
      img.src = this.stamp.dataUrl;
      img.alt = "Stamp";
      stampEl.appendChild(img);

      const handle = document.createElement("div");
      handle.className = "resize-handle";
      stampEl.appendChild(handle);

      this.stampEls.set(pageIndex, stampEl);
      return stampEl;
    }

    getViewport(pageIndex) {
      return this.viewports[pageIndex];
    }

    getWrapper(pageIndex) {
      return this.pageWrappers[pageIndex];
    }

    updateStampElementFromNormalized(pageIndex, normalized) {
      const stampEl = this.stampEls.get(pageIndex);
      if (!stampEl) return;
      const viewport = this.getViewport(pageIndex);
      const x = normalized.x * viewport.width;
      const y = normalized.y * viewport.height;
      const width = normalized.width * viewport.width;
      const height = normalized.height * viewport.height;
      stampEl.style.left = `${x}px`;
      stampEl.style.top = `${y}px`;
      stampEl.style.width = `${width}px`;
      stampEl.style.height = `${height}px`;
    }

    getNormalizedFromElement(pageIndex) {
      const stampEl = this.stampEls.get(pageIndex);
      if (!stampEl) return null;
      const viewport = this.getViewport(pageIndex);
      const x = parseFloat(stampEl.style.left) / viewport.width;
      const y = parseFloat(stampEl.style.top) / viewport.height;
      const width = parseFloat(stampEl.style.width) / viewport.width;
      const height = parseFloat(stampEl.style.height) / viewport.height;
      return { x, y, width, height };
    }

    attachInteractions(stampEl, pageIndex) {
      const handle = stampEl.querySelector(".resize-handle");

      stampEl.addEventListener("pointerdown", (e) => this.onDragStart(e, pageIndex));
      handle.addEventListener("pointerdown", (e) => this.onResizeStart(e, pageIndex));
      this.getWrapper(pageIndex).addEventListener("pointermove", (e) => this.onPointerMove(e));
      window.addEventListener("pointerup", () => this.onPointerUp());
    }

    getPointerPos(e, pageIndex) {
      const rect = this.getWrapper(pageIndex).getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    }

    onDragStart(e, pageIndex) {
      if (e.target.classList.contains("resize-handle")) return;
      e.preventDefault();
      const stampEl = this.stampEls.get(pageIndex);
      stampEl.setPointerCapture(e.pointerId);
      this.dragState = {
        pageIndex,
        type: "drag",
        startX: this.getPointerPos(e, pageIndex).x,
        startY: this.getPointerPos(e, pageIndex).y,
        initialLeft: parseFloat(stampEl.style.left),
        initialTop: parseFloat(stampEl.style.top),
      };
      stampEl.classList.add("is-dragging");
    }

    onResizeStart(e, pageIndex) {
      e.preventDefault();
      e.stopPropagation();
      const stampEl = this.stampEls.get(pageIndex);
      stampEl.setPointerCapture(e.pointerId);
      this.dragState = {
        pageIndex,
        type: "resize",
        startX: this.getPointerPos(e, pageIndex).x,
        startY: this.getPointerPos(e, pageIndex).y,
        initialWidth: parseFloat(stampEl.style.width),
        initialHeight: parseFloat(stampEl.style.height),
        initialLeft: parseFloat(stampEl.style.left),
        initialTop: parseFloat(stampEl.style.top),
      };
      stampEl.classList.add("is-resizing");
    }

    onPointerMove(e) {
      if (!this.dragState) return;
      e.preventDefault();
      const { pageIndex } = this.dragState;
      const pos = this.getPointerPos(e, pageIndex);
      const stampEl = this.stampEls.get(pageIndex);
      const viewport = this.getViewport(pageIndex);

      if (this.dragState.type === "drag") {
        let newLeft = this.dragState.initialLeft + (pos.x - this.dragState.startX);
        let newTop = this.dragState.initialTop + (pos.y - this.dragState.startY);
        const width = parseFloat(stampEl.style.width);
        const height = parseFloat(stampEl.style.height);
        newLeft = Math.max(0, Math.min(newLeft, viewport.width - width));
        newTop = Math.max(0, Math.min(newTop, viewport.height - height));
        stampEl.style.left = `${newLeft}px`;
        stampEl.style.top = `${newTop}px`;
      } else if (this.dragState.type === "resize") {
        const deltaX = pos.x - this.dragState.startX;
        const deltaY = pos.y - this.dragState.startY;
        const initialWidth = this.dragState.initialWidth;
        const scaleFactor = Math.max(deltaX / initialWidth, deltaY / (initialWidth / this.stamp.aspectRatio));
        let newWidth = initialWidth * (1 + scaleFactor);
        newWidth = Math.max(20, Math.min(newWidth, viewport.width - this.dragState.initialLeft));
        let newHeight = newWidth / this.stamp.aspectRatio;
        newHeight = Math.max(20, Math.min(newHeight, viewport.height - this.dragState.initialTop));
        newWidth = newHeight * this.stamp.aspectRatio;
        stampEl.style.width = `${newWidth}px`;
        stampEl.style.height = `${newHeight}px`;
      }
    }

    onPointerUp() {
      if (!this.dragState) return;
      const stampEl = this.stampEls.get(this.dragState.pageIndex);
      if (stampEl) {
        stampEl.classList.remove("is-dragging", "is-resizing");
      }
      this.dragState = null;
    }

    reset() {
      this.placements = this.originalPlacements.map((p) => ({ ...p }));
      this.placements.forEach((p) => {
        this.updateStampElementFromNormalized(p.mergedPageIndex, p);
      });
    }

    getCurrentNormalized() {
      const result = [];
      this.placements.forEach((p) => {
        const updated = this.getNormalizedFromElement(p.mergedPageIndex);
        if (updated) {
          result.push({ mergedPageIndex: p.mergedPageIndex, ...updated });
        }
      });
      return result;
    }
  }

  return {
    CompleteViewer,
    StampEditor,
  };
})();
