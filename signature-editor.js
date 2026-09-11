/**
 * Signature Editor
 * Interactive editor for positioning and resizing the signature and stamp
 * images on a PDF page before finalising the document.
 */

const SignatureEditor = (function () {
  class Editor {
    constructor(container, pdfjsDocument, pageIndex, signatureStamp, stampStamp, initialArea) {
      this.container = container;
      this.pdfjsDocument = pdfjsDocument;
      this.pageIndex = pageIndex;
      this.signatureStamp = signatureStamp;
      this.stampStamp = stampStamp;
      this.initialArea = initialArea;
      this.scale = 1.5;
      this.viewport = null;
      this.wrapper = null;
      this.elements = new Map(); // name -> { el, area, aspectRatio }
      this.dragState = null;
    }

    async render() {
      this.container.innerHTML = "";
      this.elements.clear();

      const page = await this.pdfjsDocument.getPage(this.pageIndex + 1);
      this.viewport = page.getViewport({ scale: this.scale });

      this.wrapper = document.createElement("div");
      this.wrapper.className = "pdf-page-wrapper";
      this.wrapper.style.position = "relative";
      this.wrapper.style.width = `${this.viewport.width}px`;
      this.wrapper.style.height = `${this.viewport.height}px`;
      this.wrapper.dataset.pageIndex = this.pageIndex;

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.width = this.viewport.width;
      canvas.height = this.viewport.height;

      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport: this.viewport,
      }).promise;

      this.wrapper.appendChild(canvas);
      this.container.appendChild(this.wrapper);

      this.createElement("signature", this.signatureStamp, this.initialArea.logoArea, "Signature");
      this.createElement("stamp", this.stampStamp, this.initialArea.stampArea, "Stamp");
    }

    createElement(name, stamp, area, label) {
      const el = document.createElement("div");
      el.className = "editor-stamp";
      el.dataset.name = name;

      const img = document.createElement("img");
      img.src = stamp.dataUrl;
      img.alt = label;
      el.appendChild(img);

      const handle = document.createElement("div");
      handle.className = "resize-handle";
      el.appendChild(handle);

      const labelEl = document.createElement("span");
      labelEl.className = "editor-stamp-label";
      labelEl.textContent = label;
      el.appendChild(labelEl);

      this.wrapper.appendChild(el);

      const screen = this.areaToScreen(area);
      el.style.left = `${screen.x}px`;
      el.style.top = `${screen.y}px`;
      el.style.width = `${screen.width}px`;
      el.style.height = `${screen.height}px`;

      this.elements.set(name, {
        el,
        stamp,
        area: { ...area },
        aspectRatio: stamp.width / stamp.height,
      });

      this.attachInteractions(el, name);
    }

    areaToScreen(area) {
      return {
        x: area.x * this.scale,
        y: (this.initialArea.pageHeight - area.y - area.height) * this.scale,
        width: area.width * this.scale,
        height: area.height * this.scale,
      };
    }

    screenToArea(screen) {
      return {
        x: screen.x / this.scale,
        y: this.initialArea.pageHeight - (screen.y + screen.height) / this.scale,
        width: screen.width / this.scale,
        height: screen.height / this.scale,
      };
    }

    getAreaFromElement(name) {
      const entry = this.elements.get(name);
      const el = entry.el;
      const screen = {
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
      };
      return this.screenToArea(screen);
    }

    attachInteractions(el, name) {
      const handle = el.querySelector(".resize-handle");
      el.addEventListener("pointerdown", (e) => this.onDragStart(e, name));
      handle.addEventListener("pointerdown", (e) => this.onResizeStart(e, name));
      this.wrapper.addEventListener("pointermove", (e) => this.onPointerMove(e));
      window.addEventListener("pointerup", () => this.onPointerUp());
    }

    getPointerPos(e) {
      const rect = this.wrapper.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    onDragStart(e, name) {
      if (e.target.classList.contains("resize-handle")) return;
      e.preventDefault();
      const entry = this.elements.get(name);
      const el = entry.el;
      el.setPointerCapture(e.pointerId);
      const pos = this.getPointerPos(e);
      this.dragState = {
        name,
        type: "drag",
        startX: pos.x,
        startY: pos.y,
        initialLeft: parseFloat(el.style.left),
        initialTop: parseFloat(el.style.top),
      };
      el.classList.add("is-dragging");
    }

    onResizeStart(e, name) {
      e.preventDefault();
      e.stopPropagation();
      const entry = this.elements.get(name);
      const el = entry.el;
      el.setPointerCapture(e.pointerId);
      const pos = this.getPointerPos(e);
      this.dragState = {
        name,
        type: "resize",
        startX: pos.x,
        startY: pos.y,
        initialWidth: parseFloat(el.style.width),
        initialHeight: parseFloat(el.style.height),
        initialLeft: parseFloat(el.style.left),
        initialTop: parseFloat(el.style.top),
      };
      el.classList.add("is-resizing");
    }

    onPointerMove(e) {
      if (!this.dragState) return;
      e.preventDefault();
      const entry = this.elements.get(this.dragState.name);
      const el = entry.el;
      const pos = this.getPointerPos(e);

      if (this.dragState.type === "drag") {
        let newLeft = this.dragState.initialLeft + (pos.x - this.dragState.startX);
        let newTop = this.dragState.initialTop + (pos.y - this.dragState.startY);
        const width = parseFloat(el.style.width);
        const height = parseFloat(el.style.height);
        newLeft = Math.max(0, Math.min(newLeft, this.viewport.width - width));
        newTop = Math.max(0, Math.min(newTop, this.viewport.height - height));
        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
      } else if (this.dragState.type === "resize") {
        const deltaX = pos.x - this.dragState.startX;
        const deltaY = pos.y - this.dragState.startY;
        const initialWidth = this.dragState.initialWidth;
        const scaleFactor = Math.max(deltaX / initialWidth, deltaY / (initialWidth / entry.aspectRatio));
        let newWidth = initialWidth * (1 + scaleFactor);
        newWidth = Math.max(20, Math.min(newWidth, this.viewport.width - this.dragState.initialLeft));
        let newHeight = newWidth / entry.aspectRatio;
        newHeight = Math.max(20, Math.min(newHeight, this.viewport.height - this.dragState.initialTop));
        newWidth = newHeight * entry.aspectRatio;
        el.style.width = `${newWidth}px`;
        el.style.height = `${newHeight}px`;
      }
    }

    onPointerUp() {
      if (!this.dragState) return;
      const entry = this.elements.get(this.dragState.name);
      if (entry) {
        entry.el.classList.remove("is-dragging", "is-resizing");
      }
      this.dragState = null;
    }

    reset() {
      for (const [name, entry] of this.elements) {
        const area = name === "signature" ? this.initialArea.logoArea : this.initialArea.stampArea;
        entry.area = { ...area };
        const screen = this.areaToScreen(entry.area);
        entry.el.style.left = `${screen.x}px`;
        entry.el.style.top = `${screen.y}px`;
        entry.el.style.width = `${screen.width}px`;
        entry.el.style.height = `${screen.height}px`;
      }
    }

    getCurrentArea() {
      const signatureArea = this.getAreaFromElement("signature");
      const stampArea = this.getAreaFromElement("stamp");
      return {
        ...this.initialArea,
        logoArea: signatureArea,
        stampArea: stampArea,
      };
    }
  }

  return { Editor };
})();
