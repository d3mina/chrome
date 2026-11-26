// ═══════════════════════════════════
//  Prague daylight schedule for Dark Mode "Auto"
//
//  Turns "All sites" dark mode ON at sunset in Prague (50.0755° N, 14.4378° E)
//  and OFF 1 hour after sunrise. Uses a pre-computed table of UTC minutes for
//  every calendar day (averaged across a 4-year leap cycle, accurate within
//  ~1 minute across all years) — zero runtime solar math, zero network calls,
//  and immune to CET/CEST daylight-saving shifts.
// ═══════════════════════════════════
(() => {
  const MIN_MS = 60 * 1000;
  const POST_SUNRISE_MS = 60 * MIN_MS; // stay dark until 1h after sunrise
  const PRAGUE_TZ = "Europe/Prague";

  // Pre-computed Prague (50.0755° N, 14.4378° E) sunrise & sunset in minutes
  // since 00:00 UTC, indexed by [month 0..11][day 0..30]. Stored in UTC so DST
  // transitions never shift the schedule; every entry falls strictly within
  // the same UTC day (02:52–19:16 UTC).
  const SUNRISE_UTC_MIN = [
    /* Jan */ [421, 421, 421, 421, 420, 420, 420, 419, 419, 419, 418, 417, 417, 416, 415, 415, 414, 413, 412, 411, 410, 409, 408, 407, 406, 405, 403, 402, 401, 399, 398],
    /* Feb */ [397, 395, 394, 392, 391, 389, 388, 386, 384, 383, 381, 379, 378, 376, 374, 372, 370, 368, 367, 365, 363, 361, 359, 357, 355, 353, 351, 349, 348],
    /* Mar */ [346, 344, 342, 340, 338, 336, 334, 332, 329, 327, 325, 323, 321, 319, 316, 314, 312, 310, 308, 305, 303, 301, 299, 297, 294, 292, 290, 288, 286, 283, 281],
    /* Apr */ [279, 277, 275, 273, 270, 268, 266, 264, 262, 260, 258, 256, 253, 251, 249, 247, 245, 243, 241, 239, 237, 235, 233, 231, 230, 228, 226, 224, 222, 220],
    /* May */ [219, 217, 215, 213, 212, 210, 208, 207, 205, 204, 202, 201, 199, 198, 196, 195, 194, 192, 191, 190, 189, 187, 186, 185, 184, 183, 182, 181, 180, 180, 179],
    /* Jun */ [178, 177, 177, 176, 175, 175, 174, 174, 174, 173, 173, 173, 172, 172, 172, 172, 172, 172, 172, 172, 172, 173, 173, 173, 174, 174, 174, 175, 175, 176],
    /* Jul */ [177, 177, 178, 179, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 193, 194, 195, 196, 197, 199, 200, 201, 203, 204, 205, 207, 208, 210],
    /* Aug */ [211, 212, 214, 215, 217, 218, 220, 221, 223, 224, 226, 227, 229, 230, 232, 233, 235, 236, 238, 239, 241, 242, 244, 245, 247, 248, 250, 251, 253, 254, 256],
    /* Sep */ [257, 259, 260, 261, 263, 264, 266, 267, 269, 270, 272, 273, 275, 276, 278, 279, 281, 282, 284, 285, 287, 288, 290, 291, 293, 294, 296, 297, 299, 300],
    /* Oct */ [302, 303, 305, 306, 308, 309, 311, 313, 314, 316, 317, 319, 320, 322, 324, 325, 327, 328, 330, 332, 333, 335, 337, 338, 340, 342, 343, 345, 347, 348, 350],
    /* Nov */ [352, 353, 355, 357, 358, 360, 362, 363, 365, 367, 368, 370, 372, 373, 375, 377, 378, 380, 382, 383, 385, 386, 388, 389, 391, 392, 394, 395, 397, 398],
    /* Dec */ [399, 401, 402, 403, 404, 406, 407, 408, 409, 410, 411, 412, 413, 414, 414, 415, 416, 417, 417, 418, 418, 419, 419, 420, 420, 420, 421, 421, 421, 421, 421],
  ];

  const SUNSET_UTC_MIN = [
    /* Jan */ [910, 911, 912, 913, 914, 915, 916, 918, 919, 920, 922, 923, 924, 926, 927, 929, 930, 932, 933, 935, 936, 938, 940, 941, 943, 945, 946, 948, 950, 951, 953],
    /* Feb */ [955, 957, 958, 960, 962, 963, 965, 967, 969, 970, 972, 974, 976, 977, 979, 981, 983, 984, 986, 988, 989, 991, 993, 995, 996, 998, 1000, 1001, 1002],
    /* Mar */ [1003, 1005, 1007, 1008, 1010, 1012, 1013, 1015, 1017, 1018, 1020, 1021, 1023, 1025, 1026, 1028, 1029, 1031, 1032, 1034, 1036, 1037, 1039, 1040, 1042, 1044, 1045, 1047, 1048, 1050, 1051],
    /* Apr */ [1053, 1054, 1056, 1058, 1059, 1061, 1062, 1064, 1065, 1067, 1069, 1070, 1072, 1073, 1075, 1076, 1078, 1080, 1081, 1083, 1084, 1086, 1087, 1089, 1091, 1092, 1094, 1095, 1097, 1098],
    /* May */ [1100, 1102, 1103, 1105, 1106, 1108, 1109, 1111, 1112, 1114, 1115, 1117, 1118, 1120, 1121, 1122, 1124, 1125, 1127, 1128, 1129, 1131, 1132, 1133, 1134, 1136, 1137, 1138, 1139, 1140, 1141],
    /* Jun */ [1142, 1143, 1144, 1145, 1146, 1147, 1148, 1149, 1150, 1150, 1151, 1152, 1152, 1153, 1153, 1154, 1154, 1155, 1155, 1155, 1155, 1156, 1156, 1156, 1156, 1156, 1156, 1156, 1156, 1155],
    /* Jul */ [1155, 1155, 1155, 1154, 1154, 1153, 1153, 1152, 1152, 1151, 1150, 1149, 1149, 1148, 1147, 1146, 1145, 1144, 1143, 1142, 1141, 1140, 1138, 1137, 1136, 1135, 1133, 1132, 1130, 1129, 1128],
    /* Aug */ [1126, 1125, 1123, 1121, 1120, 1118, 1116, 1115, 1113, 1111, 1110, 1108, 1106, 1104, 1102, 1100, 1098, 1097, 1095, 1093, 1091, 1089, 1087, 1085, 1083, 1081, 1079, 1076, 1074, 1072, 1070],
    /* Sep */ [1068, 1066, 1064, 1062, 1059, 1057, 1055, 1053, 1051, 1049, 1046, 1044, 1042, 1040, 1038, 1035, 1033, 1031, 1029, 1026, 1024, 1022, 1020, 1017, 1015, 1013, 1011, 1009, 1006, 1004],
    /* Oct */ [1002, 1000, 998, 995, 993, 991, 989, 987, 985, 983, 980, 978, 976, 974, 972, 970, 968, 966, 964, 962, 960, 958, 956, 954, 952, 951, 949, 947, 945, 943, 942],
    /* Nov */ [940, 938, 937, 935, 933, 932, 930, 929, 927, 926, 924, 923, 921, 920, 919, 918, 916, 915, 914, 913, 912, 911, 910, 909, 908, 907, 906, 906, 905, 904],
    /* Dec */ [904, 903, 903, 902, 902, 901, 901, 901, 900, 900, 900, 900, 900, 900, 900, 900, 901, 901, 901, 902, 902, 902, 903, 904, 904, 905, 906, 906, 907, 908, 909],
  ];

  const pragueTimeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: PRAGUE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  // Returns { sunrise, sunset } in Unix epoch ms for the given UTC calendar day.
  // Date.UTC normalizes out-of-range days (e.g. day - 1 on Jan 1, day + 1 on Dec 31).
  function sunTimesForUtcDay(year, month, day) {
    const midnightMs = Date.UTC(year, month, day);
    const dt = new Date(midnightMs);
    const m = dt.getUTCMonth();
    const idx = dt.getUTCDate() - 1;
    return {
      sunrise: midnightMs + SUNRISE_UTC_MIN[m][idx] * MIN_MS,
      sunset: midnightMs + SUNSET_UTC_MIN[m][idx] * MIN_MS,
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
