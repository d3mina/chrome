(() => {
  const STYLE_ID = "superlevels-darkmode";
  // Set by markPhotoBackgrounds() on elements that show a photo through a
  // stylesheet background-image, which no CSS selector can find.
  const PHOTO_ATTR = "data-superlevels-photo";

  // CSS approach: invert the whole page, then re-invert media so images/videos look normal
  function buildCSS(brightness) {
    const b = brightness / 100;
    // A filter applies to the element and everything inside it, so media inside
    // re-inverted media is inverted a third time: every photo in a <picture>
    // (wired.com, seznam.cz) came out inverted. The :not() re-inverts only the
    // outermost one. img, video, canvas and iframe show no child elements.
    // An inline background counts only with an image in it (url): the shorthand
    // "background: url(…)" was missed, and "background-image: none" on a layout
    // block re-inverted the whole block to light.
    const inlineBg = `[style*="background"][style*="url("]`;
    const media = `img, video, canvas, svg image, picture, iframe, ${inlineBg}, [${PHOTO_ATTR}]`;
    const wrappers = `picture, ${inlineBg}, [${PHOTO_ATTR}]`;
    return `
      html.superlevels-dark {
        filter: invert(1) hue-rotate(180deg) brightness(${b}) !important;
        background: #fff !important;
      }
      html.superlevels-dark :is(${media}):not(:is(${wrappers}) *) {
        filter: invert(1) hue-rotate(180deg) !important;
      }
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
    let style = document.getElementById(STYLE_ID);
    if (enabled) {
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = buildCSS(brightness);
      document.documentElement.classList.add("superlevels-dark");
      watchPhotoBackgrounds(true);
    } else {
      document.documentElement.classList.remove("superlevels-dark");
      if (style) style.remove();
      watchPhotoBackgrounds(false);
    }
  }

  // Until a check decides, a page that is not inverted can show white. The veil
  // keeps it dark, in black, the same black that an inverted white page shows.
  // pageRootBackground() switches the veil off for its read.
  const VEIL_ID = "superlevels-darkmode-veil";
  const VEIL_CSS = {
    // First visit to a host: no verdict is cached, so the page can be light,
    // and a light page showed white until the first check (seznam.cz: about
    // 0.6 s, its 1.4 MB of HTML delays DOMContentLoaded). Hide the page.
    // opacity, not visibility: the checks use elementFromPoint() and
    // checkVisibility(), and both skip hidden elements but not transparent ones.
    hide: "html { background: #000 !important } body { opacity: 0 !important }",
    // Dark on the last visit: show the page, and paint only the canvas, which
    // is white while a page has no background. Discord's shell has none until
    // its theme loads after the load event. Zero specificity and no !important,
    // so any <html> background of the page wins. A page that paints only
    // <body> shows that colour on the body box only, until the check.
    canvas: ":where(html) { background-color: #000 }",
  };
  // The page can stay without a verdict (an app that has not loaded its theme
  // yet, a page of only images). After this time (ms from navigation start)
  // "hide" becomes "canvas", so that the veil never hides a page for long.
  const VEIL_MAX = 3000;

  // kind: "hide", "canvas", or false for no veil
  function setVeil(kind) {
    let veil = document.getElementById(VEIL_ID);
    if (!kind) {
      if (veil) veil.remove();
      return;
    }
    if (!veil) {
      veil = document.createElement("style");
      veil.id = VEIL_ID;
      (document.head || document.documentElement).appendChild(veil);
    }
    // The retries call this every 250 ms. Rewrite the sheet only on a change.
    if (veil.textContent !== VEIL_CSS[kind]) veil.textContent = VEIL_CSS[kind];
  }

  // ═══════════════════════════════════
  //  Photos in stylesheet backgrounds
  // ═══════════════════════════════════
  // Many sites show thumbnails as a CSS background-image set by a class
  // (idnes.cz: 87 photos), not as <img>. Find them and mark them for the
  // re-invert rule. The same property also carries icons, sort arrows and
  // spacer GIFs on big layout blocks, which must stay inverted, so only a
  // background that looks like a photo counts.
  function isPhotoBackground(el) {
    if (el === document.body || el === document.documentElement) return false;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundImage;
    if (!bg.includes("url(")) return false;
    // SVG is almost always an icon or a drawing, like inline <svg>.
    if (/\.svg\b|image\/svg/i.test(bg)) return false;
    // A photo is scaled to fill its box. Icons and patterns keep their own
    // size ("auto") and sit at a position or repeat.
    if (!/cover|contain|100%/.test(cs.backgroundSize)) return false;
    // A block with a lot of text is layout with a decoration, not a picture.
    // Re-inverting it would turn the whole block light again.
    return el.textContent.length <= 300;
  }

  function checkPhotoBackground(el) {
    if (isPhotoBackground(el)) {
      if (!el.hasAttribute(PHOTO_ATTR)) el.setAttribute(PHOTO_ATTR, "");
    } else if (el.hasAttribute(PHOTO_ATTR)) {
      el.removeAttribute(PHOTO_ATTR);
    }
  }

  let photoObserver = null;
  let pendingTrees = new Set(); // added nodes: check them and all inside
  let pendingEls = new Set(); // style or class changed: check the element only
  let photoFrame = 0;

  function flushPhotoChecks() {
    photoFrame = 0;
    const trees = pendingTrees, els = pendingEls;
    pendingTrees = new Set();
    pendingEls = new Set();
    for (const root of trees) {
      // While the page loads, the parser adds nodes one by one, so most queued
      // roots sit inside another queued root. Check each subtree once.
      if (!root.isConnected || hasQueuedAncestor(root, trees)) continue;
      checkPhotoBackground(root);
      for (const el of root.querySelectorAll("*")) checkPhotoBackground(el);
    }
    for (const el of els) if (el.isConnected) checkPhotoBackground(el);
  }

  function hasQueuedAncestor(el, set) {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return true;
    return false;
  }

  // Batch the checks into one per frame: an SPA or a lazy loader changes many
  // nodes at once. Runs only while the page is inverted.
  function queuePhotoCheck(set, el) {
    set.add(el);
    if (!photoFrame) photoFrame = requestAnimationFrame(flushPhotoChecks);
  }

  function watchPhotoBackgrounds(on) {
    if (!on) {
      if (photoObserver) photoObserver.disconnect();
      photoObserver = null;
      return;
    }
    if (photoObserver) return;
    photoObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") {
          for (const n of r.addedNodes) if (n.nodeType === 1) queuePhotoCheck(pendingTrees, n);
        } else {
          queuePhotoCheck(pendingEls, r.target);
        }
      }
    });
    photoObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"],
    });
    queuePhotoCheck(pendingTrees, document.documentElement);
  }

  function isDarkApplied() {
    return document.documentElement.classList.contains("superlevels-dark");
  }

  // Get hostname for per-site storage
  const host = location.hostname;
  const storageKey = "darkmode_" + host;
  const globalKey = "darkmode_global";
  // Verdict cache. The name is from the old "auto" mode; it stays so that the
  // cached verdicts survive the update.
  const cacheKey = "darkmode_autocache";
  const CACHE_MAX = 400;

  let brightness = 100;
  // Dark mode is on for this page: the site's switch, else the all-sites
  // default. "Dark" means the page ends up dark. Only a light page is
  // inverted. A page that is already dark stays as it is, because inverting it
  // turns it white (Discord with its dark theme).
  let darkWanted = false;

  // ═══════════════════════════════════
  //  "Is this page light?" detection
  // ═══════════════════════════════════

  // getComputedStyle reports classic colours as rgb()/rgba(), but keeps modern
  // ones in their own syntax: color-mix() comes back as oklab(…) or
  // color(srgb …), and lab()/oklch() stay as they are. Discord builds its whole
  // theme with color-mix(), so an rgb()-only parser saw no background there at
  // all and called the page light. A 1×1 canvas turns any CSS colour into sRGB.
  let colorCtx;
  function parseColor(str) {
    if (!str) return null;
    if (!colorCtx) colorCtx = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    colorCtx.clearRect(0, 0, 1, 1);
    // The canvas ignores a colour it cannot parse and keeps the last fillStyle,
    // so reset it first: unknown syntax then reads as transparent, not as the
    // previous colour.
    colorCtx.fillStyle = "transparent";
    colorCtx.fillStyle = str;
    colorCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  }

  function isLightColor(c) {
    // Perceived brightness, 0 (black) … 1 (white)
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 >= 0.5;
  }

  // First ancestor (element included) that actually paints a background
  function opaqueBgUnder(el) {
    while (el && el !== document.documentElement) {
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.9) return c;
      el = el.parentElement;
    }
    return null;
  }

  // The page's own <html> background. While the filter is on, our sheet paints
  // <html> white (see buildCSS), and the veil paints it black, so switch both
  // sheets off for the read. Without this, a dark page that paints only <html>
  // stayed inverted for good once its cache entry said "light". Off and on in
  // the same task paints nothing, and a disabled sheet, unlike a class change,
  // does not show in the page's own MutationObservers.
  function pageRootBackground() {
    const sheets = [STYLE_ID, VEIL_ID]
      .map((id) => document.getElementById(id))
      .map((style) => style && style.sheet)
      .filter(Boolean);
    for (const sheet of sheets) sheet.disabled = true;
    try {
      return getComputedStyle(document.documentElement).backgroundColor;
    } finally {
      for (const sheet of sheets) sheet.disabled = false;
    }
  }

  // True once the body shows any text. Script, style and <noscript> text is not
  // rendered, and checkVisibility() skips it. Stops at the first hit, so a huge
  // page costs no more than a small one.
  function hasVisibleText() {
    if (!document.body) return false;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.data.trim() && n.parentElement.checkVisibility()) return true;
    }
    return false;
  }

  // true = page looks light, false = page is already dark,
  // null = nothing painted yet, so there is nothing to judge
  function detectLightPage() {
    // Sample a few spots rather than trusting <body>: plenty of sites paint the
    // real background on a wrapper div and leave body transparent.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const votes = [];
    if (w > 0 && h > 0) {
      for (const [fx, fy] of [[0.5, 0.3], [0.2, 0.6], [0.8, 0.6], [0.5, 0.85]]) {
        const c = opaqueBgUnder(document.elementFromPoint(w * fx, h * fy));
        if (c) votes.push(isLightColor(c));
      }
    }
    if (votes.length) {
      const light = votes.filter(Boolean).length;
      // A tie stays dark: inverting a half-dark page turns that half white.
      return light * 2 > votes.length;
    }

    // Nothing opaque under the sample points — fall back to the page canvas.
    const bodyBg = document.body && parseColor(getComputedStyle(document.body).backgroundColor);
    if (bodyBg && bodyBg.a >= 0.9) return isLightColor(bodyBg);
    const htmlBg = parseColor(pageRootBackground());
    if (htmlBg && htmlBg.a >= 0.9) return isLightColor(htmlBg);
    // A page that opts into dark rendering gets the benefit of the doubt.
    const scheme = getComputedStyle(document.documentElement).colorScheme || "";
    if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) return false;
    // No background anywhere, so the white browser canvas shows. With text on
    // it, that is a plain light page. Without text, it is usually an app that
    // has not loaded its theme yet: Discord sets its theme class on <html> only
    // after DOMContentLoaded and load. Do not call that light, or the dark app
    // is inverted to white until a later check sees its theme.
    return hasVisibleText() ? true : null;
  }

  // Remember the verdict per host so the next visit applies it at document_start
  // (before first paint) instead of flashing white until the DOM is measurable.
  function rememberVerdict(light) {
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
  let retryTimer;

  function runCheck() {
    if (!darkWanted) return;
    const light = detectLightPage();
    if (light === null) {
      // Leave the page as it is, cache nothing, and look again soon: an app can
      // paint its theme after every fixed check below has run. The time limit
      // (from navigation start) stops the retries on pages that stay empty.
      clearTimeout(retryTimer);
      if (performance.now() < 10000) retryTimer = setTimeout(runCheck, 250);
      // Show a page that still has no verdict, but keep its empty canvas dark.
      if (performance.now() >= VEIL_MAX && document.getElementById(VEIL_ID)) setVeil("canvas");
      return;
    }
    // In the same task as the invert, so no frame shows the page white.
    if (light !== isDarkApplied()) applyDarkMode(light, brightness);
    setVeil(false);
    if (light !== lastVerdict) {
      lastVerdict = light;
      rememberVerdict(light);
    }
  }

  function scheduleChecks() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runCheck, { once: true });
    } else {
      runCheck();
    }
    window.addEventListener("load", runCheck, { once: true });
    setTimeout(runCheck, 1500); // apps that paint their theme late
  }

  // On: check the page now and while it loads, and invert it only if it is
  // light. Never invert without a check, or a dark page turns white.
  function setDarkWanted(on) {
    darkWanted = on;
    if (on) {
      scheduleChecks();
    } else {
      applyDarkMode(false, brightness);
      setVeil(false);
    }
  }

  // Load state as early as possible to prevent flash
  chrome.storage.local.get([storageKey, globalKey, cacheKey, "darkmode_brightness"], (data) => {
    brightness = data.darkmode_brightness || 100;
    // The site's own switch wins over the all-sites default.
    const siteState = data[storageKey];
    if (!(siteState !== undefined ? siteState : data[globalKey] === true)) return;
    // The checks need a page they can measure. A page that was light on the
    // last visit is inverted now, before first paint, so it does not flash white.
    // Any other page is veiled until the first check.
    const cached = (data[cacheKey] || {})[host];
    if (cached && cached[0] === 1) applyDarkMode(true, brightness);
    else setVeil(cached ? "canvas" : "hide");
    setDarkWanted(true);
  });

  // Listen for toggle messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "darkmode_toggle") {
      brightness = msg.brightness || brightness;
      if (msg.enabled && isDarkApplied()) applyDarkMode(true, brightness); // new brightness
      setDarkWanted(msg.enabled === true);
      sendResponse({ ok: true });
    }
    if (msg.type === "darkmode_settings") {
      // The popup changed a setting (auto switch, site switch cleared,
      // brightness): recompute from the stored settings. siteState comes as
      // null when there is no override.
      brightness = msg.brightness || brightness;
      if (isDarkApplied()) applyDarkMode(true, brightness); // new brightness
      const site = msg.siteState === null || msg.siteState === undefined ? undefined : msg.siteState;
      setDarkWanted(site !== undefined ? site === true : msg.global === true);
      sendResponse({ ok: true });
    }
  });
})();
