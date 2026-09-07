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
    constructor(container, pdfjsDocument, stamp, mergedPageIndex, normalized) {
      this.container = container;
      this.pdfjsDocument = pdfjsDocument;
      this.stamp = stamp;
      this.mergedPageIndex = mergedPageIndex;
      this.normalized = { ...normalized };
      this.scale = 1.5;
      this.page = null;
      this.viewport = null;
      this.stage = null;
      this.stampEl = null;
      this.canvas = null;
      this.dragState = null;
    }

    async render() {
      this.container.innerHTML = "";
      this.page = await this.pdfjsDocument.getPage(this.mergedPageIndex + 1);
      this.viewport = this.page.getViewport({ scale: this.scale });

      this.stage = document.createElement("div");
      this.stage.className = "editor-stage";
      this.stage.style.width = `${this.viewport.width}px`;
      this.stage.style.height = `${this.viewport.height}px`;

      this.canvas = document.createElement("canvas");
      this.canvas.width = this.viewport.width;
      this.canvas.height = this.viewport.height;
      this.stage.appendChild(this.canvas);

      await this.page.render({
        canvasContext: this.canvas.getContext("2d"),
        viewport: this.viewport,
      }).promise;

      this.stampEl = document.createElement("div");
      this.stampEl.className = "editor-stamp";
      const img = document.createElement("img");
      img.src = this.stamp.dataUrl;
      img.alt = "Stamp";
      this.stampEl.appendChild(img);

      const handle = document.createElement("div");
      handle.className = "resize-handle";
      this.stampEl.appendChild(handle);
      this.stage.appendChild(this.stampEl);
      this.container.appendChild(this.stage);

      this.updateStampElementFromNormalized();
      this.attachInteractions(handle);
    }

    updateStampElementFromNormalized() {
      const x = this.normalized.x * this.viewport.width;
      const y = this.normalized.y * this.viewport.height;
      const width = this.normalized.width * this.viewport.width;
      const height = this.normalized.height * this.viewport.height;
      this.stampEl.style.left = `${x}px`;
      this.stampEl.style.top = `${y}px`;
      this.stampEl.style.width = `${width}px`;
      this.stampEl.style.height = `${height}px`;
    }

    getNormalizedFromElement() {
      const x = parseFloat(this.stampEl.style.left) / this.viewport.width;
      const y = parseFloat(this.stampEl.style.top) / this.viewport.height;
      const width = parseFloat(this.stampEl.style.width) / this.viewport.width;
      const height = parseFloat(this.stampEl.style.height) / this.viewport.height;
      return { x, y, width, height };
    }

    attachInteractions(handle) {
      this.stampEl.addEventListener("pointerdown", (e) => this.onDragStart(e));
      handle.addEventListener("pointerdown", (e) => this.onResizeStart(e));
      this.stage.addEventListener("pointermove", (e) => this.onPointerMove(e));
      window.addEventListener("pointerup", () => this.onPointerUp());
    }

    getPointerPos(e) {
      const rect = this.stage.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    }

    onDragStart(e) {
      if (e.target.classList.contains("resize-handle")) return;
      e.preventDefault();
      this.stampEl.setPointerCapture(e.pointerId);
      this.dragState = {
        type: "drag",
        startX: this.getPointerPos(e).x,
        startY: this.getPointerPos(e).y,
        initialLeft: parseFloat(this.stampEl.style.left),
        initialTop: parseFloat(this.stampEl.style.top),
      };
      this.stampEl.classList.add("is-dragging");
    }

    onResizeStart(e) {
      e.preventDefault();
      e.stopPropagation();
      this.stampEl.setPointerCapture(e.pointerId);
      this.dragState = {
        type: "resize",
        startX: this.getPointerPos(e).x,
        startY: this.getPointerPos(e).y,
        initialWidth: parseFloat(this.stampEl.style.width),
        initialHeight: parseFloat(this.stampEl.style.height),
        initialLeft: parseFloat(this.stampEl.style.left),
        initialTop: parseFloat(this.stampEl.style.top),
      };
      this.stampEl.classList.add("is-resizing");
    }

    onPointerMove(e) {
      if (!this.dragState) return;
      e.preventDefault();
      const pos = this.getPointerPos(e);

      if (this.dragState.type === "drag") {
        let newLeft = this.dragState.initialLeft + (pos.x - this.dragState.startX);
        let newTop = this.dragState.initialTop + (pos.y - this.dragState.startY);
        const width = parseFloat(this.stampEl.style.width);
        const height = parseFloat(this.stampEl.style.height);
        newLeft = Math.max(0, Math.min(newLeft, this.viewport.width - width));
        newTop = Math.max(0, Math.min(newTop, this.viewport.height - height));
        this.stampEl.style.left = `${newLeft}px`;
        this.stampEl.style.top = `${newTop}px`;
      } else if (this.dragState.type === "resize") {
        const deltaX = pos.x - this.dragState.startX;
        const deltaY = pos.y - this.dragState.startY;
        const initialWidth = this.dragState.initialWidth;
        const scaleFactor = Math.max(deltaX / initialWidth, deltaY / (initialWidth / this.stamp.aspectRatio));
        let newWidth = initialWidth * (1 + scaleFactor);
        newWidth = Math.max(20, Math.min(newWidth, this.viewport.width - this.dragState.initialLeft));
        let newHeight = newWidth / this.stamp.aspectRatio;
        newHeight = Math.max(20, Math.min(newHeight, this.viewport.height - this.dragState.initialTop));
        newWidth = newHeight * this.stamp.aspectRatio;
        this.stampEl.style.width = `${newWidth}px`;
        this.stampEl.style.height = `${newHeight}px`;
      }
    }

    onPointerUp() {
      if (!this.dragState) return;
      this.stampEl.classList.remove("is-dragging", "is-resizing");
      this.dragState = null;
    }

    reset(normalized) {
      this.normalized = { ...normalized };
      this.updateStampElementFromNormalized();
    }

    getCurrentNormalized() {
      return this.getNormalizedFromElement();
    }
  }

  return {
    CompleteViewer,
    StampEditor,
  };
})();
