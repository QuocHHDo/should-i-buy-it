// Copies the shared app code into extension/lib (Chrome can't load files from outside the extension's folder).
//   node scripts/sync-extension.mjs
// tests/extension.test.js fails when a copy is out of date.
import fs from "node:fs";
import path from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
export const LIB = ["foods.js", "additives-data.js", "additive-notes.js", "additives.js", "ingredients.js", "supplement.js", "verdict.js", "sources.js", "search.js", "walmart.js", "costco.js", "backup.js", "card.js", "labelocr.js", "labelscan.js", "dom.js"];
// The label-photo reader, vendored in vendor/tesseract/. Chrome 116+ has WebAssembly SIMD, so only that core ships.
export const OCR = ["tesseract.min.js", "worker.min.js", "tesseract-core-simd-lstm.wasm.js", "eng.traineddata.gz", "LICENSE-tesseract.js.md", "LICENSE-tesseract.js-core", "README.md"];
for (const f of LIB) fs.copyFileSync(path.join(ROOT, "js", f), path.join(ROOT, "extension/lib", f));
fs.mkdirSync(path.join(ROOT, "extension/ocr"), { recursive: true });
for (const f of OCR) fs.copyFileSync(path.join(ROOT, "vendor/tesseract", f), path.join(ROOT, "extension/ocr", f));
console.log(`Copied ${LIB.length} files to extension/lib and ${OCR.length} to extension/ocr`);
