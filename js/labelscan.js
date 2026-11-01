// Reads a photo of a Nutrition Facts label in the browser and lets the person check the numbers before anything is
// scored. Shared by the app (vendor/tesseract/) and the extension's side panel (extension/ocr/).
//
// Tesseract.js runs on the device: the photo isn't uploaded anywhere. It's loaded only when someone asks for it (about
// 7 MB the first time). Three passes over the same photo, then the numbers most passes agree on (js/labelocr.js). On 17
// real label photos in Chromium (Oct 2026) that read 109 of 165 numbers right (66%); 3 of the 89 it left unmarked were
// wrong, and 10 more wrong ones were marked "check it". Each photo took 3 to 8 seconds.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./labelocr.js"));
  else root.SelfCheckLabelScan = factory(root.SelfCheckLabelOcr);
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function (L) {
  // Big phone photos are scaled down first: OCR time grows with pixels, and label type is still large enough.
  const MAX_SIDE = 2000;
  // The passes: as-is in block mode; grayscale with its contrast stretched; the same at 1.5x in sparse mode.
  const PASSES = [{ prep: "raw", psm: "6" }, { prep: "gray", psm: "3" }, { prep: "gray", scale: 1.5, psm: "11" }];

  let loading = null;
  function loadScript(src) {
    if (loading) return loading;
    loading = new Promise((ok, no) => {
      if (typeof Tesseract !== "undefined") return ok();
      const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { loading = null; no(new Error("Couldn't load the label reader.")); };
      document.head.append(s);
    });
    return loading;
  }

  // A photo (File, Blob or image URL already fetched as a Blob) as a canvas no bigger than MAX_SIDE.
  async function toCanvas(blob) {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }
  // Grayscale with the darkest and lightest 2% clipped and the rest stretched; light-on-dark labels turned dark-on-light.
  function gray(src, scale = 1) {
    const c = document.createElement("canvas"); c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length / 4, hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < n * 0.02) lo++;
    acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.02) hi--;
    const span = Math.max(1, hi - lo);
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span)) | 0; d[i] = g; if (g < 110) dark++; }
    const inv = dark > n / 2;
    for (let i = 0; i < d.length; i += 4) { const g = inv ? 255 - d[i] : d[i]; d[i] = d[i + 1] = d[i + 2] = g; }
    x.putImageData(img, 0, 0);
    return c;
  }

  // Reads the photo. `base` is where the Tesseract files are; onStep(text) reports progress for a screen reader-friendly
  // status line. Returns the merged result from js/labelocr.js.
  /** @param {Blob} blob @param {{ base: string, onStep?: (text: string) => void }} opts */
  async function read(blob, { base, onStep = () => {} }) {
    onStep("Loading the label reader…");
    await loadScript(base + "tesseract.min.js");
    const worker = await Tesseract.createWorker("eng", 1, {
      workerPath: base + "worker.min.js", corePath: base, langPath: base, gzip: true,
      workerBlobURL: false, // extension pages can't start workers from blob: URLs
      cacheMethod: "none", // the files are local (extension) or cached by the app's service worker
    });
    try {
      const photo = await toCanvas(blob);
      const results = [];
      for (let i = 0; i < PASSES.length; i++) {
        const p = PASSES[i];
        onStep(`Reading the label (${i + 1} of ${PASSES.length})…`);
        await worker.setParameters({ tessedit_pageseg_mode: p.psm, preserve_interword_spaces: "1" });
        const img = p.prep === "raw" ? photo : gray(photo, p.scale || 1);
        const { data } = await worker.recognize(img);
        results.push(L.parse(data.text));
      }
      return L.merge(results);
    } finally {
      worker.terminate();
    }
  }

  // The form where the person checks what was read. `el` is the page's element helper; onSubmit(values, serving).
  // Every number can be changed or cleared; blank ones stay unknown. Numbers to check are marked in words, not only color.
  function form(r, { el, name = "", askName = false, onSubmit, onCancel, idPrefix = "lf" }) {
    const rows = L.KEYS.map(k => {
      const id = `${idPrefix}-${k}`, h = r.how[k], mark = r.values[k] != null ? L.HOW[h] || "" : "";
      const flag = h === "doubt" || h === "once" || h === "fixed";
      return el("div", { class: "lrow" + (flag ? " check" : "") + (k === "sat" || k === "trans" || k === "fib" || k === "sug" || k === "add" ? " sub" : "") },
        el("label", { for: id, text: L.LABEL[k] }),
        el("span", { class: "lin" }, el("input", { id, name: k, type: "number", inputmode: "decimal", min: "0", step: "any", value: r.values[k] != null ? String(r.values[k]) : "", "aria-describedby": mark ? id + "-m" : null }),
          el("span", { class: "lunit", text: L.UNIT[k] || "kcal" })),
        mark ? el("span", { class: "lmark", id: id + "-m", text: mark }) : null);
    });
    const servingId = idPrefix + "-serving";
    const read = L.KEYS.filter(k => r.values[k] != null).length;
    const f = el("form", { class: "lform", onsubmit: e => {
      e.preventDefault();
      const values = {};
      for (const k of L.KEYS) { const v = f.elements[k].value.trim(); if (v !== "") values[k] = Number(v); }
      onSubmit(values, f.elements.serving.value.trim(), askName ? f.elements.pname.value.trim() : name);
    } },
      el("p", { class: "lsum", text: read ? `Read ${read} of ${L.KEYS.length} numbers. Check them against the label, fix any that are wrong, and fill in what's blank if you can.` : "Couldn't read numbers from this photo. Type them from the label, or try a sharper, straight-on photo of just the Nutrition Facts." }),
      r.notes.length ? el("ul", { class: "lnotes" }, ...r.notes.map(n => el("li", { text: n }))) : null,
      askName ? el("div", { class: "lrow" }, el("label", { for: idPrefix + "-name", text: "Product" }), el("span", { class: "lin wide" }, el("input", { id: idPrefix + "-name", name: "pname", type: "text", value: name, placeholder: "Name (optional)" }))) : null,
      el("div", { class: "lrow" }, el("label", { for: servingId, text: "Serving size" }), el("span", { class: "lin wide" }, el("input", { id: servingId, name: "serving", type: "text", value: r.serving || "" }))),
      ...rows,
      el("p", { class: "lhint", text: "Leave a number blank if the label doesn't show it; the verdict then leaves it out." }),
      el("div", { class: "lbtns" }, el("button", { type: "submit", class: "primary", text: "Show the verdict" }), onCancel ? el("button", { type: "button", text: "Cancel", onclick: onCancel }) : null));
    return f;
  }

  return { read, form, PASSES, MAX_SIDE };
});
