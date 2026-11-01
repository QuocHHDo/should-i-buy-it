// Small DOM helpers shared by the app and the extension's pages (the store-page content script keeps its own, narrower
// one). `el("p", { class: "x", text: "Hi", onclick: f }, child…)`: "text" sets textContent; "html" is only for the
// app's own fixed SVG icons, never for text from users, lookups or pages.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckDom = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  /** @param {string} tag @param {Record<string, any>} [attrs] @param {...any} kids @returns {any} */
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids) if (c != null && c !== false) e.append(c);
    return e;
  };
  /** @type {(id: string) => any} */
  const $ = id => document.getElementById(id);
  return { el, $ };
});
