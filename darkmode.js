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
  // <html> white (see buildCSS), so switch the sheet off for the read. Without
  // this, a dark page that paints only <html> stayed inverted for good once its
  // cache entry said "light". Off and on in the same task paints nothing, and a
  // disabled sheet, unlike a class change, does not show in the page's own
  // MutationObservers.
  function pageRootBackground() {
    const style = isDarkApplied() ? document.getElementById(STYLE_ID) : null;
    const sheet = style && style.sheet;
    if (sheet) sheet.disabled = true;
    try {
      return getComputedStyle(document.documentElement).backgroundColor;
    } finally {
      if (sheet) sheet.disabled = false;
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
      return;
    }
    if (light !== isDarkApplied()) applyDarkMode(light, brightness);
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
    if (on) scheduleChecks();
    else applyDarkMode(false, brightness);
  }

  // Load state as early as possible to prevent flash
  chrome.storage.local.get([storageKey, globalKey, cacheKey, "darkmode_brightness"], (data) => {
    brightness = data.darkmode_brightness || 100;
    // The site's own switch wins over the all-sites default.
    const siteState = data[storageKey];
    if (!(siteState !== undefined ? siteState : data[globalKey] === true)) return;
    // The checks need a page they can measure. A page that was light on the
    // last visit is inverted now, before first paint, so it does not flash white.
    const cached = (data[cacheKey] || {})[host];
    if (cached && cached[0] === 1) applyDarkMode(true, brightness);
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
