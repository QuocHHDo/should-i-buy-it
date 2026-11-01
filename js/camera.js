// Barcode scanning with the device camera: the bundled html5-qrcode library, loaded only when needed. Every step has a
// way out: no camera API, a denied or unanswered permission prompt, a busy camera, or a scanner script that won't
// load all end in a clear message with the typed-barcode box focused.
//
// SelfCheckCamera.create({ ui, onCode, readyText, timeouts }) → { open(), close(), running() }
//   ui: { panel, message, button, code, reader } — the scanner's elements (reader is the id html5-qrcode draws into)
//   onCode(code): called once with each decoded barcode (the scanner is closed first)
//   readyText(): what to say once the camera is running ("Point your camera at the barcode…")
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SelfCheckCamera = factory();
})(/** @type {any} */ (typeof self !== "undefined" ? self : this), function () {
  // html5-qrcode sometimes rejects with a plain string ("… NotAllowedError: Permission denied"), so read the name from either.
  const CAMERA_ERRORS = /(NotAllowedError|PermissionDeniedError|SecurityError|NotFoundError|DevicesNotFoundError|OverconstrainedError|NotReadableError|TrackStartError|AbortError)/;
  const errName = e => (e && e.name && e.name !== "Error" ? e.name : (String(e && (e.message || e)).match(CAMERA_ERRORS) || [])[1]);
  function message(e) {
    switch (errName(e)) {
      case "NoCameraApi": return "This browser can't use the camera here (it needs a secure https page). Type the barcode number below.";
      case "NotAllowedError": case "PermissionDeniedError": case "SecurityError": return "Camera access is blocked for this site. Allow it in your browser's site settings (the icon left of the address), then tap Scan barcode again. Or type the number below.";
      case "NotFoundError": case "OverconstrainedError": case "DevicesNotFoundError": return "No camera was found on this device. Type the barcode number below.";
      case "NotReadableError": case "TrackStartError": case "AbortError": return "The camera is in use by another app or tab. Close it and tap Scan barcode again, or type the number below.";
      case "TimeoutError": return "The camera didn't start. Tap Scan barcode to try again, or type the number below.";
      case "ScriptError": return "The scanner couldn't load (are you offline?). Type the barcode number below.";
      default: return "The camera couldn't start. Type the barcode number below.";
    }
  }
  const withTimeout = (promise, ms) => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
    promise.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); fail(e); });
  });
  const stopStream = st => { try { (st && st.getTracks ? st.getTracks() : []).forEach(t => t.stop()); } catch {} };
  function loadScript(src) {
    return new Promise((ok, fail) => {
      if (/** @type {any} */ (window).Html5Qrcode) return ok(undefined);
      const s = document.createElement("script"); s.src = src; s.onload = () => ok(undefined);
      s.onerror = () => fail(Object.assign(new Error("script"), { name: "ScriptError" }));
      document.head.append(s);
    });
  }

  /** @param {{ ui: { panel: HTMLElement, message: HTMLElement, button: HTMLElement, code: HTMLElement, reader: string }, onCode: (code: string) => void, readyText?: () => string, script?: string, timeouts?: { wait?: number, permission?: number, start?: number } }} opts */
  function create({ ui, onCode, readyText = () => "Point your camera at the barcode and move closer until it fills the box.", script = "vendor/html5-qrcode.min.js", timeouts = {} }) {
    const WAIT_MS = timeouts.wait || 3000, PERMISSION_MS = timeouts.permission || 60000, START_MS = timeouts.start || 15000;
    let scanner = null, attempts = 0;
    const say = t => { ui.message.textContent = t; };
    function failed(e) {
      attempts++;
      say(message(e));
      ui.button.removeAttribute("aria-busy");
      const s = scanner; scanner = null;
      try { if (s) { if (s.isScanning) s.stop().catch(() => {}); s.clear(); } } catch {}
      ui.code.focus();
    }
    async function open() {
      const attempt = ++attempts;
      ui.panel.hidden = false; say("Starting the camera…");
      ui.button.setAttribute("aria-busy", "true");
      ui.code.focus();
      if (!window.isSecureContext || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return failed({ name: "NoCameraApi" });
      // Already blocked for this site: say so now instead of waiting on a prompt that won't appear.
      try { const st = navigator.permissions && await navigator.permissions.query({ name: /** @type {any} */ ("camera") }); if (st && st.state === "denied") return failed({ name: "NotAllowedError" }); } catch {}
      if (attempt !== attempts) return;
      // While the browser's permission prompt is up, explain what we're waiting for.
      const waiting = setTimeout(() => { if (attempt === attempts) say("Waiting for camera permission. Allow it in your browser, or type the number below."); }, WAIT_MS);
      try {
        // Ask for the camera ourselves first, so the browser's own error (NotAllowedError, NotFoundError,
        // NotReadableError) comes back intact, and the wait for the prompt isn't cut short.
        const gum = navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        gum.then(st => { if (attempt !== attempts) stopStream(st); }, () => {}); // answered after we gave up: release it
        stopStream(await withTimeout(gum, PERMISSION_MS));
        clearTimeout(waiting);
        if (attempt !== attempts) return;
        say("Starting the camera…");
        await withTimeout((async () => {
          await loadScript(script);
          const w = /** @type {any} */ (window), lib = w.__Html5QrcodeLibrary__ || {};
          const F = w.Html5QrcodeSupportedFormats || lib.Html5QrcodeSupportedFormats;
          const Scanner = w.Html5Qrcode || lib.Html5Qrcode;
          // Decoding uses the browser's BarcodeDetector when it has one, and the bundled ZXing decoder otherwise
          // (desktop Chrome on Windows/Linux, Firefox, older Safari).
          const sc = new Scanner(ui.reader, { verbose: false, formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
          scanner = sc;
          await sc.start({ facingMode: "environment" }, { fps: 10, qrbox: (w2, h) => ({ width: Math.floor(w2 * 0.95), height: Math.floor(Math.max(h * 0.6, Math.min(h, 120))) }) },
            async decoded => { await close(); onCode(decoded); }, () => {});
          // Started after we gave up (timeout) or the panel was closed: turn the camera back off.
          if (attempt !== attempts) { try { await sc.stop(); sc.clear(); } catch {} }
        })(), START_MS);
        if (attempt !== attempts) return; // closed or restarted meanwhile
        ui.button.removeAttribute("aria-busy");
        say(readyText());
      } catch (e) {
        clearTimeout(waiting);
        if (attempt === attempts) failed(e);
      }
    }
    async function close() {
      attempts++;
      try { if (scanner) { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } } catch {}
      scanner = null; ui.panel.hidden = true; ui.button.removeAttribute("aria-busy");
    }
    return { open, close, running: () => !!scanner && !ui.panel.hidden };
  }

  return { create, message, errName };
});
