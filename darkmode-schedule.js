// ═══════════════════════════════════
//  Prague daylight schedule for Dark Mode "Auto"
//
//  Turns "All sites" dark mode ON at sunset in Prague (50.0755° N, 14.4378° E)
//  and OFF 1 hour after sunrise. Pure local solar math (NOAA sunrise equation,
//  accurate to ~1 minute) — zero network requests, zero extra permissions.
// ═══════════════════════════════════
(() => {
  const RAD = Math.PI / 180;
  const DAY_MS = 86400000;
  const POST_SUNRISE_MS = 60 * 60 * 1000; // stay dark until 1h after sunrise

  const PRAGUE_LAT = 50.0755;
  const PRAGUE_LON = 14.4378; // East positive
  const PRAGUE_TZ = "Europe/Prague";
  // Official sunrise/sunset solar altitude: solar radius (0.266°) + refraction (0.567°).
  const HORIZON_ALT_DEG = -0.833;

  const pragueTimeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: PRAGUE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  // Returns { sunrise, sunset } in Unix epoch ms for the given UTC calendar day.
  // Because Prague sits at ~14.4° E (solar noon ~11:02 UTC) and ~50.1° N
  // (half-day length 4h01m–8h12m), sunrise, sunrise + 1h, and sunset always
  // fall strictly inside the same UTC day (02:50–19:20 UTC), with no polar
  // day/night or midnight wrap-around edge cases.
  function sunTimesForUtcDay(year, month, day) {
    const noonMs = Date.UTC(year, month, day, 12, 0, 0);
    // Julian days since J2000.0 (2000-01-01 12:00 UTC = JD 2451545.0).
    const n = noonMs / DAY_MS + 2440587.5 - 2451545.0;
    const jStar = n - PRAGUE_LON / 360;

    const M = ((357.5291 + 0.98560028 * jStar) % 360 + 360) % 360;
    const Mr = M * RAD;
    const C =
      1.9148 * Math.sin(Mr) +
      0.0200 * Math.sin(2 * Mr) +
      0.0003 * Math.sin(3 * Mr);
    const lambda = ((M + C + 180 + 102.9372) % 360 + 360) % 360;
    const lamR = lambda * RAD;

    const jTransit =
      2451545.0 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lamR);
    const sinDec = Math.sin(lamR) * Math.sin(23.4397 * RAD);
    const cosDec = Math.sqrt(1 - sinDec * sinDec);
    const latR = PRAGUE_LAT * RAD;

    const cosOmega =
      (Math.sin(HORIZON_ALT_DEG * RAD) - Math.sin(latR) * sinDec) /
      (Math.cos(latR) * cosDec);
    const omegaDeg = Math.acos(Math.max(-1, Math.min(1, cosOmega))) / RAD;

    const toMs = (jd) => Math.round((jd - 2440587.5) * DAY_MS);
    return {
      sunrise: toMs(jTransit - omegaDeg / 360),
      sunset: toMs(jTransit + omegaDeg / 360),
    };
  }

  // Evaluate Prague dark-mode auto schedule at timestamp `now` (epoch ms).
  // Returns:
  //   isDark     — whether dark mode should be ON right now
  //   nextChange — epoch ms of the next ON/OFF flip (always > now)
  //   darkStart  — sunset (epoch ms) starting the current or upcoming dark window
  //   darkEnd    — sunrise + 1h (epoch ms) ending that dark window
  function getState(now = Date.now()) {
    const d = new Date(now);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();

    const today = sunTimesForUtcDay(y, m, day);
    const todayOff = today.sunrise + POST_SUNRISE_MS;
    const todayOn = today.sunset;

    if (now < todayOff) {
      const yesterday = sunTimesForUtcDay(y, m, day - 1);
      return {
        isDark: true,
        nextChange: todayOff,
        darkStart: yesterday.sunset,
        darkEnd: todayOff,
      };
    }

    const tomorrow = sunTimesForUtcDay(y, m, day + 1);
    const tomorrowOff = tomorrow.sunrise + POST_SUNRISE_MS;

    if (now < todayOn) {
      return {
        isDark: false,
        nextChange: todayOn,
        darkStart: todayOn,
        darkEnd: tomorrowOff,
      };
    }

    return {
      isDark: true,
      nextChange: tomorrowOff,
      darkStart: todayOn,
      darkEnd: tomorrowOff,
    };
  }

  function formatPragueTime(ms) {
    return pragueTimeFmt.format(ms);
  }

  globalThis.darkmodeSchedule = Object.freeze({
    PRAGUE_TZ,
    sunTimesForUtcDay,
    getState,
    formatPragueTime,
  });
})();
