(() => {
  const STYLE_ID = "superlevels-darkmode";

  // CSS approach: invert the whole page, then re-invert media so images/videos look normal
  function buildCSS(brightness) {
    const b = brightness / 100;
    return `
      html.superlevels-dark {
        filter: invert(1) hue-rotate(180deg) brightness(${b}) !important;
        background: #fff !important;
      }
      html.superlevels-dark img,
      html.superlevels-dark video,
      html.superlevels-dark canvas,
      html.superlevels-dark svg image,
      html.superlevels-dark picture,
      html.superlevels-dark [style*="background-image"],
      html.superlevels-dark iframe {
        filter: invert(1) hue-rotate(180deg) !important;
      }
      /* Don't double-invert nested media inside iframes - handled by iframe's own injection */
      /* Fix common elements that break */
      html.superlevels-dark input,
      html.superlevels-dark textarea,
      html.superlevels-dark select {
        background-color: inherit !important;
        color: inherit !important;
      }
    `;
  }

  function applyDarkMode(enabled, brightness) {
    withoutSelfMutation(() => {
      let style = document.getElementById(STYLE_ID);
      if (enabled) {
        if (!style) {
          style = document.createElement("style");
          style.id = STYLE_ID;
          (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = buildCSS(brightness);
        document.documentElement.classList.add("superlevels-dark");
      } else {
        document.documentElement.classList.remove("superlevels-dark");
        if (style) style.remove();
      }
    });
  }

  function isDarkApplied() {
    return document.documentElement.classList.contains("superlevels-dark");
  }

  // Get hostname for per-site storage
  const host = location.hostname;
  const storageKey = "darkmode_" + host;
  const globalKey = "darkmode_global";
  const autoKey = "darkmode_auto";
  // Bumped from darkmode_autocache so pre-fix poisoned entries (e.g. Discord
  // oklab or background-tab misses) don't flash white after upgrading.
  const cacheKey = "darkmode_autocache_v2";
  const CACHE_MAX = 400;

  // 3×3 grid covering gutters and interior so a light card/diagram in the
  // middle of a dark page (e.g. GitHub READMEs) can't outvote the real canvas.
  const SAMPLE_POINTS = [
    [0.05, 0.2], [0.5, 0.2], [0.95, 0.2],
    [0.05, 0.5], [0.5, 0.5], [0.95, 0.5],
    [0.05, 0.8], [0.5, 0.8], [0.95, 0.8],
  ];
  const THEME_ATTRS = [
    "class", "style", "data-theme", "data-color-mode", "data-dark-theme", "data-bs-theme",
  ];

  let brightness = 100;
  let autoEnabled = false;
  let siteState; // per-site override: true / false / undefined (= no override)
  let manualOverride = false; // user flipped the switch during this page load

  let attrObserver = null;
  let bootObserver = null;
  let observingBody = false;
  let autoActive = false;
  let debounceTimer = null;
  let fallbackTimer = null;
  let postLoadTimer = null;
  let bootCapTimer = null;
  let schemeMedia = null;

  // Drain queued records synchronously so our own class/style toggles never
  // wake the observers (MutationObserver callbacks fire in a later microtask).
  function withoutSelfMutation(fn) {
    try {
      return fn();
    } finally {
      if (attrObserver) attrObserver.takeRecords();
      if (bootObserver) bootObserver.takeRecords();
    }
  }

  // ═══════════════════════════════════
  //  "Is this page light?" detection
  // ═══════════════════════════════════

  function clamp01(n) {
    return Math.min(1, Math.max(0, n));
  }

  function linearToSrgb(c) {
    const v = clamp01(c);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function parseChannel(tok, pctScale) {
    if (tok === "none") return 0;
    const n = parseFloat(tok);
    if (Number.isNaN(n)) return NaN;
    return tok.endsWith("%") ? (n / 100) * pctScale : n;
  }

  function parseAlpha(tok) {
    if (tok === undefined) return 1;
    if (tok === "none") return 0;
    const n = parseFloat(tok);
    if (Number.isNaN(n)) return NaN;
    return clamp01(tok.endsWith("%") ? n / 100 : n);
  }

  function parseAngleRad(tok) {
    if (tok === "none") return 0;
    const n = parseFloat(tok);
    if (Number.isNaN(n)) return NaN;
    if (tok.endsWith("rad")) return n;
    if (tok.endsWith("grad")) return (n * Math.PI) / 200;
    if (tok.endsWith("turn")) return n * Math.PI * 2;
    return (n * Math.PI) / 180;
  }

  function oklabToSrgb(L, a, b, alpha) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return {
      r: linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
      g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
      b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) * 255,
      a: alpha,
    };
  }

  // Parse any CSS Color 4 value that Chrome's getComputedStyle can serialize:
  // rgb/rgba, oklab (used by Discord's color-mix theme tokens), oklch
  // (Tailwind v4), lab/lch, and color(srgb | srgb-linear | display-p3 | xyz…).
  function parseColor(str) {
    const m = /^\s*([a-z]+)\(([^)]+)\)\s*$/i.exec(str || "");
    if (!m) return null;
    const fn = m[1].toLowerCase();
    const parts = m[2].split("/");
    if (parts.length > 2) return null;
    const toks = parts[0].trim().split(/[\s,]+/).filter(Boolean);
    const slashAlpha = parts.length === 2 ? parts[1].trim() : undefined;

    if (fn === "rgb" || fn === "rgba") {
      if (toks.length < 3) return null;
      const r = parseChannel(toks[0], 255);
      const g = parseChannel(toks[1], 255);
      const b = parseChannel(toks[2], 255);
      const a = parseAlpha(slashAlpha !== undefined ? slashAlpha : toks[3]);
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return { r, g, b, a };
    }

    const alpha = parseAlpha(slashAlpha);
    if (Number.isNaN(alpha)) return null;

    if (fn === "oklab") {
      if (toks.length < 3) return null;
      const L = parseChannel(toks[0], 1);
      const a = parseChannel(toks[1], 0.4);
      const b = parseChannel(toks[2], 0.4);
      if ([L, a, b].some(Number.isNaN)) return null;
      return oklabToSrgb(L, a, b, alpha);
    }

    if (fn === "oklch") {
      if (toks.length < 3) return null;
      const L = parseChannel(toks[0], 1);
      const C = parseChannel(toks[1], 0.4);
      const H = parseAngleRad(toks[2]);
      if ([L, C, H].some(Number.isNaN)) return null;
      return oklabToSrgb(L, C * Math.cos(H), C * Math.sin(H), alpha);
    }

    if (fn === "lab" || fn === "lch") {
      if (toks.length < 3) return null;
      const L = parseChannel(toks[0], 100);
      if (Number.isNaN(L)) return null;
      // CIE L* maps monotonically to relative luminance Y independent of chroma.
      const fy = (L + 16) / 116;
      const Y = L > 8 ? fy * fy * fy : L / 903.2962962962963;
      const v = linearToSrgb(Y) * 255;
      return { r: v, g: v, b: v, a: alpha };
    }

    if (fn === "color") {
      if (toks.length < 4) return null;
      const space = toks[0].toLowerCase();
      const c1 = parseChannel(toks[1], 1);
      const c2 = parseChannel(toks[2], 1);
      const c3 = parseChannel(toks[3], 1);
      if ([c1, c2, c3].some(Number.isNaN)) return null;
      if (space === "xyz" || space === "xyz-d50" || space === "xyz-d65") {
        const v = linearToSrgb(c2) * 255;
        return { r: v, g: v, b: v, a: alpha };
      }
      if (space === "srgb-linear") {
        return {
          r: linearToSrgb(c1) * 255,
          g: linearToSrgb(c2) * 255,
          b: linearToSrgb(c3) * 255,
          a: alpha,
        };
      }
      return {
        r: clamp01(c1) * 255,
        g: clamp01(c2) * 255,
        b: clamp01(c3) * 255,
        a: alpha,
      };
    }

    return null;
  }

  function isLightColor(c) {
    // Perceived brightness, 0 (black) … 1 (white)
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 >= 0.5;
  }

  function compositeOver(fg, bg) {
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: a + bg.a * (1 - a),
    };
  }

  function parseGradientColor(bgImage) {
    if (!bgImage || bgImage === "none" || !/gradient\(/i.test(bgImage)) return null;
    if (/\btransparent\b/i.test(bgImage)) return null;
    const stops = bgImage.match(/(?:rgba?|oklab|oklch|lab|lch|color)\([^)]+\)/gi);
    if (!stops || !stops.length) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const stop of stops) {
      const c = parseColor(stop);
      if (!c || c.a < 0.9) return null; // translucent gradient lets lower layers show through
      r += c.r;
      g += c.g;
      b += c.b;
    }
    const n = stops.length;
    return { r: r / n, g: g / n, b: b / n, a: 1 };
  }

  function ownBgColor(style) {
    // In CSS, background-image paints on top of background-color.
    const grad = parseGradientColor(style.backgroundImage);
    if (grad) return grad;
    const c = parseColor(style.backgroundColor);
    return c && c.a > 0 ? c : null;
  }

  // Read <html>'s real background even when our filter is active: html.superlevels-dark
  // forces `background: #fff !important`, so temporarily removing the class within
  // one synchronous JS turn (zero paint/flash) lets dark html-styled sites recover.
  function readRootBg() {
    const root = document.documentElement;
    if (!isDarkApplied()) return ownBgColor(getComputedStyle(root));
    return withoutSelfMutation(() => {
      root.classList.remove("superlevels-dark");
      try {
        return ownBgColor(getComputedStyle(root));
      } finally {
        root.classList.add("superlevels-dark");
      }
    });
  }

  // Pages declaring `color-scheme: dark`, or `color-scheme: light dark` (like
  // GitHub) while the browser prefers dark, already render a dark canvas.
  function isDarkColorScheme() {
    const scheme = getComputedStyle(document.documentElement).colorScheme || "";
    if (!/\bdark\b/.test(scheme)) return false;
    if (!/\blight\b/.test(scheme)) return true;
    return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function hasPendingStylesheets() {
    // After window.load, any link with !link.sheet failed to load (404/error).
    if (document.readyState === "complete") return false;
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (!link.disabled && !link.sheet) return true;
    }
    return false;
  }

  function hasVisibleContent() {
    if (!document.body) return false;
    // innerText ignores hidden nodes like <noscript>, so an unhydrated SPA
    // shell (e.g. Discord's empty #app-mount) won't look like a loaded white page.
    if ((document.body.innerText || "").trim().length > 0) return true;
    // Also count visible non-tiny media/controls (skip 1×1 hidden tracker iframes).
    for (const el of document.body.querySelectorAll("img, svg, canvas, video, iframe, input, textarea, button")) {
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0) return true;
    }
    return false;
  }

  // Returns "light", "dark", or "pending" when the page isn't measurable yet
  // (background/prerendered tab, pending CSS, or unhydrated SPA shell).
  function detectPageTone(allowIncompleteCanvas) {
    if (document.prerendering || document.visibilityState !== "visible") return "pending";
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 0 || h <= 0 || !document.body) return "pending";

    const darkScheme = isDarkColorScheme();
    const bodyStyle = getComputedStyle(document.body);
    const bodyBg = ownBgColor(bodyStyle);
    const htmlBg = readRootBg();

    // Per CSS Backgrounds, <html> paints the canvas when non-transparent;
    // otherwise <body>'s background propagates to the entire viewport canvas.
    const authorCanvasRaw = htmlBg || bodyBg;

    // Light body text on an unpainted canvas implies a dark backdrop (wallpaper
    // image, WebGL/canvas, or dark theme) rather than a white default canvas.
    const bodyText = parseColor(bodyStyle.color);
    const lightBodyText = Boolean(bodyText && bodyText.a >= 0.5 && isLightColor(bodyText));

    const defaultCanvas = darkScheme || (!authorCanvasRaw && lightBodyText)
      ? { r: 0, g: 0, b: 0, a: 1 }
      : { r: 255, g: 255, b: 255, a: 1 };

    const authorCanvas = authorCanvasRaw
      ? (authorCanvasRaw.a >= 0.99 ? authorCanvasRaw : compositeOver(authorCanvasRaw, defaultCanvas))
      : null;

    let paintedVotes = 0;
    let totalLight = 0;
    let totalDark = 0;

    for (const [fx, fy] of SAMPLE_POINTS) {
      let el = document.elementFromPoint(w * fx, h * fy);
      if (!el) continue;

      const layers = [];
      let opaque = false;
      while (el && el !== document.documentElement) {
        const bg = ownBgColor(getComputedStyle(el));
        if (bg) {
          layers.push(bg);
          if (bg.a >= 0.99) {
            opaque = true;
            break;
          }
        }
        el = el.parentElement;
      }

      if (opaque || authorCanvas) paintedVotes++;
      let color = opaque ? layers.pop() : (authorCanvas || defaultCanvas);
      while (layers.length) color = compositeOver(layers.pop(), color);

      if (isLightColor(color)) totalLight++;
      else totalDark++;
    }

    const totalVotes = totalLight + totalDark;
    if (totalVotes === 0) {
      // If hit-testing yielded nothing (e.g. pointer-events: none on root),
      // still honor an explicit html/body canvas background; otherwise wait.
      return authorCanvas ? (isLightColor(authorCanvas) ? "light" : "dark") : "pending";
    }

    // Majority of sampled spots had an explicit author-painted surface.
    if (paintedVotes * 2 >= totalVotes) {
      // Strict majority required to invert: ties stay dark rather than flipping
      // a dark page white due to a light screenshot, diagram, or embed.
      return totalLight > totalDark ? "light" : "dark";
    }

    if (darkScheme || lightBodyText) return "dark";

    // Relying on the browser's default white canvas: wait until stylesheets and
    // real content have rendered so an empty SPA shell isn't inverted to white.
    if (hasPendingStylesheets() || !hasVisibleContent()) return "pending";
    if (!allowIncompleteCanvas && document.readyState !== "complete") return "pending";

    return totalLight > totalDark ? "light" : "dark";
  }

  // Remember the verdict per host so the next visit applies it at document_start
  // (before first paint) instead of flashing white until the DOM is measurable.
  function rememberVerdict(light) {
    if (!host) return; // avoid colliding unrelated file:// pages under ""
    chrome.storage.local.get([cacheKey], (data) => {
      const cache = (data && data[cacheKey]) || {};
      cache[host] = [light ? 1 : 0, Date.now()];
      const hosts = Object.keys(cache);
      if (hosts.length > CACHE_MAX) {
        hosts
          .sort((a, b) => (cache[a][1] || 0) - (cache[b][1] || 0))
          .slice(0, hosts.length - CACHE_MAX)
          .forEach((h) => delete cache[h]);
      }
      chrome.storage.local.set({ [cacheKey]: cache });
    });
  }

  let lastVerdict; // avoids re-writing the cache on every re-check

  function ensureBodyObserved() {
    if (!attrObserver || observingBody || !document.body) return;
    attrObserver.observe(document.body, { attributes: true, attributeFilter: THEME_ATTRS });
    observingBody = true;
  }

  function startBootObserver() {
    if (bootObserver || !autoActive) return;
    // Only watch subtree while visible and waiting for an unhydrated SPA shell
    // to mount; disconnects on the first non-pending verdict or after 10s.
    bootObserver = new MutationObserver(queueAutoCheck);
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
    bootCapTimer = setTimeout(stopBootObserver, 10000);
  }

  function stopBootObserver() {
    if (bootObserver) {
      bootObserver.disconnect();
      bootObserver = null;
    }
    if (bootCapTimer) {
      clearTimeout(bootCapTimer);
      bootCapTimer = null;
    }
  }

  function runAutoCheck({ allowIncompleteCanvas = false, allowCacheLight = false } = {}) {
    if (!autoEnabled || manualOverride || siteState !== undefined) return;
    ensureBodyObserved();

    const tone = detectPageTone(allowIncompleteCanvas);
    if (tone === "pending") {
      if (!document.prerendering && document.visibilityState === "visible") {
        startBootObserver();
      }
      return;
    }

    // First settled verdict reached — drop the subtree boot watcher so active
    // apps (e.g. live Discord chat) incur zero ongoing DOM-mutation overhead.
    stopBootObserver();

    const light = tone === "light";
    if (light !== isDarkApplied()) applyDarkMode(light, brightness);

    // Cache "dark" immediately so dark sites never flash white on next visit;
    // only cache "light" after the page has settled so transient loading states
    // cannot poison the cache.
    const canPersist = !light || document.readyState === "complete" || allowCacheLight;
    if (canPersist && light !== lastVerdict) {
      lastVerdict = light;
      rememberVerdict(light);
    }
  }

  function queueAutoCheck() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runAutoCheck();
    }, 120);
  }

  function onDomReady() {
    ensureBodyObserved();
    runAutoCheck();
    // If window.load is held up by a slow image/tracker on a transparent-canvas
    // light page, allow an incomplete-canvas check once stylesheets are done.
    if (!fallbackTimer && document.readyState !== "complete") {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        runAutoCheck({ allowIncompleteCanvas: true, allowCacheLight: true });
      }, 1200);
    }
  }

  function onWindowLoad() {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    runAutoCheck();
    // Apps that fetch user theme preferences after load (e.g. SPAs).
    if (postLoadTimer) clearTimeout(postLoadTimer);
    postLoadTimer = setTimeout(() => {
      postLoadTimer = null;
      runAutoCheck({ allowIncompleteCanvas: true, allowCacheLight: true });
    }, 1500);
  }

  function onVisible() {
    if (!document.prerendering && document.visibilityState === "visible") {
      runAutoCheck();
    }
  }

  function stopAutoChecks() {
    if (!autoActive) return;
    autoActive = false;
    stopBootObserver();
    if (attrObserver) {
      attrObserver.disconnect();
      attrObserver = null;
    }
    observingBody = false;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    if (postLoadTimer) { clearTimeout(postLoadTimer); postLoadTimer = null; }
    document.removeEventListener("DOMContentLoaded", onDomReady);
    window.removeEventListener("load", onWindowLoad);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("prerenderingchange", onVisible);
    window.removeEventListener("popstate", queueAutoCheck);
    window.removeEventListener("hashchange", queueAutoCheck);
    if (schemeMedia) {
      schemeMedia.removeEventListener("change", queueAutoCheck);
      schemeMedia = null;
    }
  }

  function scheduleAutoChecks() {
    stopAutoChecks();
    autoActive = true;

    // Cheap lifetime watcher for theme toggles on <html>/<body> (e.g. Discord
    // adding .theme-dark after hydration or GitHub changing data-color-mode).
    attrObserver = new MutationObserver(queueAutoCheck);
    attrObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: THEME_ATTRS,
    });
    ensureBodyObserved();

    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("prerenderingchange", onVisible);
    window.addEventListener("popstate", queueAutoCheck);
    window.addEventListener("hashchange", queueAutoCheck);

    if (window.matchMedia) {
      schemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
      schemeMedia.addEventListener("change", queueAutoCheck);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onDomReady, { once: true });
      window.addEventListener("load", onWindowLoad, { once: true });
    } else if (document.readyState === "interactive") {
      onDomReady();
      window.addEventListener("load", onWindowLoad, { once: true });
    } else {
      onWindowLoad();
    }
  }

  // Load state as early as possible to prevent flash
  chrome.storage.local.get(
    [storageKey, globalKey, autoKey, cacheKey, "darkmode_brightness"],
    (data) => {
      if (manualOverride) return;
      brightness = data.darkmode_brightness || 100;
      siteState = data[storageKey];
      autoEnabled = data[autoKey] === true;

      // An explicit per-site choice always wins, and stops auto-detection.
      if (siteState !== undefined) {
        if (siteState) applyDarkMode(true, brightness);
        return;
      }

      // Auto mode: only invert pages that look light. Sits between the per-site
      // override and the global default.
      if (autoEnabled) {
        const cached = host && (data[cacheKey] || {})[host];
        if (cached && cached[0] === 1) applyDarkMode(true, brightness);
        scheduleAutoChecks();
        return;
      }

      if (data[globalKey]) applyDarkMode(true, brightness);
    }
  );

  // Listen for toggle messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "darkmode_toggle") {
      brightness = msg.brightness || brightness;
      // A deliberate flip outranks auto-detection for the rest of this page load.
      manualOverride = true;
      stopAutoChecks();
      applyDarkMode(msg.enabled, brightness);
      sendResponse({ ok: true });
    }
    if (msg.type === "darkmode_settings") {
      // Auto mode / the per-site override changed in the popup — recompute from
      // scratch. siteState comes as null when there is no override.
      autoEnabled = msg.auto === true;
      siteState = msg.siteState === null || msg.siteState === undefined ? undefined : msg.siteState;
      brightness = msg.brightness || brightness;
      manualOverride = false;
      lastVerdict = undefined;
      stopAutoChecks();
      if (siteState !== undefined) applyDarkMode(siteState, brightness);
      else if (autoEnabled) scheduleAutoChecks();
      else applyDarkMode(msg.global === true, brightness);
      sendResponse({ ok: true });
    }
    if (msg.type === "darkmode_query") {
      sendResponse({
        active: isDarkApplied(),
        host: host,
      });
    }
  });
})();
