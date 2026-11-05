// Settings: goals for the product-page card, typed in or brought over from the app's backup or transfer link.
(() => {
  "use strict";
  const V = self.SelfCheckVerdict, B = self.SelfCheckBackup, AL = self.SelfCheckAllergens;
  /** @type {(id: string) => any} */
  const $ = id => document.getElementById(id);
  const NUM = ["cal", "pro", "sat", "na", "add", "fib"];
  const status = (text, ok = true) => { $("status").textContent = text; $("status").className = ok ? "ok" : "err"; };
  const get = keys => new Promise(r => chrome.storage.local.get(keys, v => r(v || {})));
  const set = obj => new Promise(r => chrome.storage.local.set(obj, r));

  function fill(p, usdaKey) {
    for (const k of NUM) $(k).value = p[k];
    $("skip").value = p.skip || ""; $("mild").checked = !!p.mild; $("usdaKey").value = usdaKey || "";
    for (const x of AL.LIST) $("al-" + x.id).checked = (x.diet ? p.diets || [] : p.allergies || []).includes(x.id);
    $("alOther").value = p.allergyOther || "";
  }
  // One checkbox per allergen, from js/allergens.js.
  const box = x => { const l = document.createElement("label"); l.className = "check"; l.title = x.hint;
    const i = Object.assign(document.createElement("input"), { type: "checkbox", id: "al-" + x.id }); l.append(i, " " + x.label); return l; };
  $("alBoxes").replaceChildren(...AL.LIST.filter(x => !x.diet).map(box));
  $("dietBoxes").replaceChildren(...AL.LIST.filter(x => x.diet).map(box));
  async function load() { const s = await get(["profile", "usdaKey"]); fill({ ...V.DEFAULT_PROFILE, ...(s.profile || {}) }, s.usdaKey); }

  $("goals").addEventListener("submit", async e => {
    e.preventDefault();
    if (!$("goals").reportValidity()) return;
    const p = Object.fromEntries(NUM.map(k => [k, Number($(k).value)]));
    // The same checks a restored backup gets.
    const checked = B.KEYS.profile({ ...p, skip: $("skip").value.slice(0, 500), mild: $("mild").checked,
      allergies: AL.LIST.filter(x => !x.diet && $("al-" + x.id).checked).map(x => x.id), diets: AL.LIST.filter(x => x.diet && $("al-" + x.id).checked).map(x => x.id),
      allergyOther: $("alOther").value.slice(0, 200) });
    await set({ profile: checked, usdaKey: $("usdaKey").value.trim().slice(0, 100) });
    status("Saved. Open product pages update right away.");
  });
  $("reset").addEventListener("click", async () => { await set({ profile: null }); await load(); status("Back to the default goals."); });

  $("importBtn").addEventListener("click", async () => {
    const text = $("paste").value.trim();
    if (!text) return status("Paste the backup text or transfer link first.", false);
    const m = text.match(/#import=([A-Za-z0-9_.-]+)/);
    const r = m ? await B.decode(m[1]) : B.parse(text);
    if (!r.ok) return status(r.error, false);
    if (!r.data.profile) return status("That backup has no goals in it. Save your goals in the app first.", false);
    await set({ profile: r.data.profile });
    await load();
    $("paste").value = "";
    status("Goals imported from the app.");
  });

  // Search badges switch.
  get(["searchBadges"]).then(s => { $("searchBadges").checked = !!s.searchBadges; });
  $("searchBadges").addEventListener("change", async () => { await set({ searchBadges: $("searchBadges").checked }); status($("searchBadges").checked ? "Search badges on. Reload Walmart search pages to see them." : "Search badges off."); });

  // Card position.
  get(["corner"]).then(s => { (s.corner === "right" ? $("cornerRight") : $("cornerLeft")).checked = true; });
  for (const id of ["cornerLeft", "cornerRight"]) $(id).addEventListener("change", async e => { await set({ corner: e.target.value }); status(e.target.value === "right" ? "The pill now sits bottom right." : "The pill now sits bottom left."); });

  // Items waiting to be sent to the app's grocery list.
  const SITE = "https://quochhdo.github.io/should-i-buy-it/";
  async function showList() {
    const { toApp = [] } = await get(["toApp"]);
    $("listItems").replaceChildren(...toApp.map(i => Object.assign(document.createElement("li"), { textContent: i.n })));
    $("listInfo").textContent = toApp.length ? `${toApp.length} item${toApp.length === 1 ? "" : "s"} waiting:` : "Nothing yet. Use “+ Add to list” on a product page.";
    $("sendList").hidden = $("clearList").hidden = !toApp.length;
    if (toApp.length) $("sendList").href = SITE + "#add=" + await B.encode(B.packAdd(toApp));
  }
  $("sendList").addEventListener("click", () => setTimeout(async () => { await set({ toApp: [] }); showList(); }, 300));
  $("clearList").addEventListener("click", async () => { await set({ toApp: [] }); showList(); });
  chrome.storage.onChanged.addListener(c => { if (c.toApp) showList(); });
  showList();

  load();
})();
