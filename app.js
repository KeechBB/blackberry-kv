(function () {
  const STATUS_RU = {
    win: "победа",
    lose: "поражение",
    draw: "ничья",
    upcoming: "скоро",
  };
  const MONTH_RU = [
    "",
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];
  const INDEX_URL = "data/index.json";
  const TRAINING_INDEX_URL = "data/training-index.json";
  const LEDGER_URL = "data/mvp-ledger.json";
  const TIERS_URL = "data/tiers.json";
  const FACTIONS_URL = "data/factions.json";
  const DATA_VER =
    new URLSearchParams(location.search).get("v") || "20260925-place-col";
  const ROSTER_URL = "https://bb-squad.ru/api/public/roster";
  const PROFILE_BASE = "https://bb-squad.ru/players";
  const FACTION_FALLBACK = {
    WPMC: "ЧВК СТАРОЕ",
    TLF: "Турция",
    USMC: "Морская Пехота",
    GFI: "Иран",
    USA: "Америка",
    RGF: "Россия",
    CRF: "Новая канада",
    VDV: "ВДВ",
    CAF: "Канада",
    MEI: "Талибы",
    BAF: "Англия",
    IMF: "Сербы",
    ADF: "Австралия",
    PLA: "Китай",
    AFU: "ВСУ",
    HOAK: "ХАОКИ",
  };
  const isEmbed =
    new URLSearchParams(location.search).has("embed") || window.self !== window.top;
  if (isEmbed) {
    document.documentElement.classList.add("embed");
    if (!location.hash || location.hash === "#" || location.hash === "#/") {
      history.replaceState(null, "", `${location.pathname}${location.search}#/cw`);
    }
  }

  function dataUrl(url) {
    if (!url) return url;
    const sep = String(url).includes("?") ? "&" : "?";
    return `${url}${sep}v=${DATA_VER}`;
  }
  const MVP_ICONS = {
    medic: "assets/mvp/medic.svg",
    killer: "assets/mvp/killer.svg",
    damage: "assets/mvp/damage.svg",
    antiDeath: "assets/mvp/anti-death.svg",
  };
  const MVP_LABEL = {
    medic: "MVP Medic",
    killer: "MVP Killer",
    damage: "MVP War-Score",
    antiDeath: "Anti-MVP Death",
  };
  const TIER_LABEL = { 1: "Тир 1", 2: "Тир 2", 3: "Тир 3", 4: "Тир 4" };
  /** Композитный PWR 0–1000 для рейтинга тренировок (без MVP). */
  const TRAIN_PWR = {
    mRes: 4,
    mNok: 3,
    mKill: 2.5,
    mDmg: 150,
    mDeath: 6,
    confGames: 5,
    support: { res: 0.7, nok: 0.15, dmg: 0.15 },
    fight: { kill: 0.35, nok: 0.25, dmg: 0.3, res: 0.1 },
    roleMax: 0.65,
    roleAvg: 0.35,
    impact: { role: 0.55, surv: 0.2, win: 0.25 },
    /** Множитель состава (тир клана). */
    tierMult: { 1: 1.4, 2: 1.3, 3: 1.2, 4: 1.1 },
    /** KD < 1 → штраф. */
    kdLowMult: 0.9,
    /** Ступени как в Valorant / Apex. [minPWR, label, cssKey] */
    bands: [
      [0, "Iron", "iron"],
      [100, "Bronze", "bronze"],
      [200, "Silver", "silver"],
      [300, "Gold", "gold"],
      [400, "Platinum", "platinum"],
      [500, "Diamond", "diamond"],
      [600, "Ascendant", "ascendant"],
      [700, "Immortal", "immortal"],
      [800, "Master", "master"],
      [900, "Radiant", "radiant"],
    ],
  };
  // Камера / не в составе — не в рейтинге игроков.
  const RATING_EXCLUDE = new Set(["shrein"]);

  let catalog = [];
  let trainingCatalog = [];
  let factionLabels = { ...FACTION_FALLBACK };
  let currentMonthMeta = null;
  let monthData = null;
  let matches = [];
  let trainMonthMeta = null;
  let trainMatches = [];
  let trainMonthKey = "09";
  let trainSortKey = "date";
  let trainSortDir = "desc";
  let ledger = null;
  let tiersData = null;
  let tierByNick = new Map();
  let displayNickByKey = new Map();
  let ratingRows = [];
  let ratingSortKey = "kv";
  let ratingSortDir = "desc";
  let trainRatingRows = [];
  let trainRatingSortKey = "pwr";
  let trainRatingSortDir = "desc";

  function softSat(x, mid) {
    const v = Math.max(0, Number(x) || 0);
    const m = Number(mid) || 1;
    return v / (v + m);
  }

  /** @returns {{ pwr: number, band: number, label: string, rankKey: string }} */
  function calcTrainPwr(row) {
    const g = Math.max(1, Number(row.games) || 0);
    const r = (Number(row.res) || 0) / g;
    const n = (Number(row.nok) || 0) / g;
    const k = (Number(row.kills) || 0) / g;
    const d = (Number(row.deaths) || 0) / g;
    const c = (Number(row.dmg) || 0) / g;
    const w =
      row.winPct == null || Number(row.games) <= 0
        ? 0
        : Math.min(1, Math.max(0, Number(row.winPct) / 100));

    const R = softSat(r, TRAIN_PWR.mRes);
    const N = softSat(n, TRAIN_PWR.mNok);
    const K = softSat(k, TRAIN_PWR.mKill);
    const C = softSat(c, TRAIN_PWR.mDmg);
    const Surv = 1 - softSat(d, TRAIN_PWR.mDeath);

    const s = TRAIN_PWR.support;
    const f = TRAIN_PWR.fight;
    const Support = s.res * R + s.nok * N + s.dmg * C;
    const Fight = f.kill * K + f.nok * N + f.dmg * C + f.res * R;
    const Role =
      TRAIN_PWR.roleMax * Math.max(Support, Fight) +
      TRAIN_PWR.roleAvg * ((Support + Fight) / 2);

    const imp = TRAIN_PWR.impact;
    const Impact = imp.role * Role + imp.surv * Surv + imp.win * w;
    const Conf = g / (g + TRAIN_PWR.confGames);

    const tier = Number(row.tier) || 4;
    const tierMult = TRAIN_PWR.tierMult[tier] || TRAIN_PWR.tierMult[4];
    const kd =
      row.kd != null
        ? Number(row.kd)
        : d === 0
          ? k
          : k / Math.max(d, 1e-9);
    const kdMult = kd < 1 ? TRAIN_PWR.kdLowMult : 1;

    let pwr = Math.round(Impact * Conf * 1000 * tierMult * kdMult);
    if (pwr < 0) pwr = 0;
    if (pwr > 1000) pwr = 1000;
    const band = Math.min(900, Math.floor(pwr / 100) * 100);
    let label = TRAIN_PWR.bands[0][1];
    let rankKey = TRAIN_PWR.bands[0][2];
    for (let i = TRAIN_PWR.bands.length - 1; i >= 0; i--) {
      if (pwr >= TRAIN_PWR.bands[i][0]) {
        label = TRAIN_PWR.bands[i][1];
        rankKey = TRAIN_PWR.bands[i][2];
        break;
      }
    }
    return { pwr, band, label, rankKey };
  }
  let matchSortKey = "date";
  let matchSortDir = "desc";
  let rosterByNick = {};

  let modalMatch = null;
  let modalTab = "total";
  let modalPlayers = null;
  let sortKey = "kills";
  let sortDir = "desc";
  let monthKey = "09";

  function factionTitle(code) {
    if (!code) return "—";
    const c = String(code).toUpperCase();
    const ru = factionLabels[c] || FACTION_FALLBACK[c];
    return ru ? `${c} · ${ru}` : c;
  }

  function factionShort(code) {
    return code ? String(code).toUpperCase() : "—";
  }

  const modal = document.getElementById("match-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalSub = document.getElementById("modal-sub");
  const modalBody = document.getElementById("modal-body");
  const modalTabs = document.getElementById("modal-tabs");

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function num(v) {
    return v == null || v === "" ? "—" : escapeHtml(v);
  }

  function syncDualScroll(wrap) {
    if (!wrap) return;
    const top = wrap.querySelector(".table-scroll-top");
    const main = wrap.querySelector(".table-scroll-main");
    const spacer = wrap.querySelector(".table-scroll-spacer");
    if (!top || !main || !spacer) return;
    const w = main.scrollWidth;
    spacer.style.width = w + "px";
    top.hidden = main.scrollWidth <= main.clientWidth + 1;
  }

  function bindDualScroll(wrap) {
    if (!wrap || wrap.dataset.dualBound) return;
    const top = wrap.querySelector(".table-scroll-top");
    const main = wrap.querySelector(".table-scroll-main");
    if (!top || !main) return;
    wrap.dataset.dualBound = "1";
    let lock = false;
    top.addEventListener("scroll", () => {
      if (lock) return;
      lock = true;
      main.scrollLeft = top.scrollLeft;
      lock = false;
    });
    main.addEventListener("scroll", () => {
      if (lock) return;
      lock = true;
      top.scrollLeft = main.scrollLeft;
      lock = false;
    });
    window.addEventListener("resize", () => syncDualScroll(wrap));
    syncDualScroll(wrap);
  }

  function refreshDualScrolls() {
    document.querySelectorAll("[data-dual-scroll]").forEach((wrap) => {
      bindDualScroll(wrap);
      syncDualScroll(wrap);
    });
  }

  function nickKey(nick) {
    return String(nick || "")
      .trim()
      .replace(/^\[bb\]\s*/i, "")
      .replace(/^\[cam\]\s*/i, "")
      .toLowerCase();
  }

  function profileNick(nick) {
    return String(nick || "")
      .trim()
      .replace(/^\[bb\]\s*/i, "")
      .replace(/^\[cam\]\s*/i, "")
      .trim();
  }

  function profileHref(nick) {
    const clean = displayNick(nick);
    if (!clean || clean === "—") return null;
    return `${PROFILE_BASE}/${encodeURIComponent(clean)}`;
  }

  function nickLinkHtml(nick) {
    const label = displayNick(nick) || nick || "—";
    const href = profileHref(nick);
    if (!href) return escapeHtml(label);
    return `<a class="nick-profile-link" href="${escapeHtml(href)}" target="_top" rel="noopener">${escapeHtml(label)}</a>`;
  }

  function inRating(nick) {
    return Boolean(nick) && !RATING_EXCLUDE.has(nickKey(nick));
  }

  function buildTierIndex(data) {
    const map = new Map();
    const display = new Map();
    if (!data) {
      displayNickByKey = display;
      return map;
    }
    const aliases = data.aliases || {};
    [
      [1, data.tier1 || []],
      [2, data.tier2 || []],
      [3, data.tier3 || []],
    ].forEach(([tier, list]) => {
      list.forEach((n) => {
        const key = nickKey(n);
        map.set(key, tier);
        display.set(key, String(n).trim());
      });
    });
    Object.entries(aliases).forEach(([alias, canon]) => {
      const t = map.get(nickKey(canon));
      if (t) map.set(nickKey(alias), t);
      const label = String(canon || "").trim();
      if (label) {
        display.set(nickKey(alias), label);
        display.set(nickKey(canon), label);
      }
    });
    // common scoreboard spellings
    [
      ["_vagner_", 2],
      ["vagner", 2],
      ["cat", 1],
      ["lordwolf", 1],
      ["ikeappa", 1],
      ["ikeppa", 1],
    ].forEach(([k, t]) => {
      if (!map.has(k)) map.set(k, t);
    });
    displayNickByKey = display;
    return map;
  }

  function displayNick(nick) {
    const clean = profileNick(nick);
    const key = nickKey(clean);
    return displayNickByKey.get(key) || clean;
  }

  /** Ключ для склейки рейтинга: алиасы (VaGNeR / Dedushkin Ghoul 福父 …) → канон */
  function resolveNickKey(nick) {
    const clean = profileNick(nick);
    const key = nickKey(clean);
    const canon = displayNickByKey.get(key);
    return canon ? nickKey(canon) : key;
  }

  function tierOf(nick) {
    return tierByNick.get(resolveNickKey(nick)) || tierByNick.get(nickKey(nick)) || 4;
  }

  function tierLabel(tier) {
    return TIER_LABEL[tier] || TIER_LABEL[4];
  }

  /* ——— navigation ——— */
  function showView(name) {
    document.getElementById("view-home").hidden = name !== "home";
    document.getElementById("view-cw").hidden = name !== "cw";
    const tm = document.getElementById("view-tm");
    if (tm) tm.hidden = name !== "tm";
    document.body.classList.toggle("layout-cw", name === "cw" || name === "tm");
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === name);
    });
    if (name === "cw") {
      const active = document.querySelector("#view-cw .subnav-btn.active");
      showCwPanel(active?.dataset.cw || "matches");
    }
    if (name === "tm") {
      const active = document.querySelector("#view-tm .subnav-btn.active");
      showTmPanel(active?.dataset.tm || "matches");
    }
  }

  function showCwPanel(panel) {
    document.getElementById("cw-matches").hidden = panel !== "matches";
    document.getElementById("cw-rating").hidden = panel !== "rating";
    const an = document.getElementById("cw-analytics");
    if (an) an.hidden = panel !== "analytics";
    document.querySelectorAll("#view-cw .subnav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cw === panel);
    });
    if (panel === "rating") loadRating();
    if (panel === "analytics") {
      ensureCwAnalyticsFilters();
      loadCwAnalytics();
    }
  }

  function showTmPanel(panel) {
    const matches = document.getElementById("tm-matches");
    const rating = document.getElementById("tm-rating");
    const analytics = document.getElementById("tm-analytics");
    if (matches) matches.hidden = panel !== "matches";
    if (rating) rating.hidden = panel !== "rating";
    if (analytics) analytics.hidden = panel !== "analytics";
    document.querySelectorAll("#view-tm .subnav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tm === panel);
    });
    if (panel === "matches") {
      ensureTrainingFilters();
      loadSelectedTrainingMonth();
    }
    if (panel === "rating") {
      ensureTrainRatingFilters();
      loadTrainingRating();
    }
    if (panel === "analytics") {
      ensureTrainAnalyticsFilters();
      loadTrainingAnalytics();
    }
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const nav = el.dataset.nav;
      showView(nav);
      const hash = nav === "cw" ? "#/cw" : nav === "tm" ? "#/tm" : "#/";
      history.replaceState(null, "", hash);
    });
  });
  document.querySelectorAll("#view-cw .subnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showCwPanel(btn.dataset.cw);
      const hash =
        btn.dataset.cw === "rating"
          ? "#/cw/rating"
          : btn.dataset.cw === "analytics"
            ? "#/cw/analytics"
            : "#/cw";
      history.replaceState(null, "", hash);
    });
  });
  document.querySelectorAll("#view-tm .subnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showTmPanel(btn.dataset.tm);
      history.replaceState(
        null,
        "",
        btn.dataset.tm === "rating"
          ? "#/tm/rating"
          : btn.dataset.tm === "analytics"
            ? "#/tm/analytics"
            : "#/tm"
      );
    });
  });

  function applyHash() {
    const h = location.hash || "#/";
    if (h.startsWith("#/cw/training") || h === "#/cw/training") {
      history.replaceState(null, "", "#/tm");
      showView("tm");
      showTmPanel("matches");
      return;
    }
    if (h.startsWith("#/tm")) {
      showView("tm");
      showTmPanel(
        h.includes("analytics")
          ? "analytics"
          : h.includes("rating")
            ? "rating"
            : "matches"
      );
    } else if (h.startsWith("#/cw")) {
      showView("cw");
      showCwPanel(
        h.includes("analytics")
          ? "analytics"
          : h.includes("rating")
            ? "rating"
            : "matches"
      );
    } else {
      showView("home");
    }
  }
  window.addEventListener("hashchange", applyHash);

  /* ——— catalog / filters ——— */
  function fillYearMonthSelects() {
    const years = [...new Set(catalog.map((m) => m.year))].sort((a, b) => b - a);
    const yearSel = document.getElementById("filter-year");
    const ratingYear = document.getElementById("rating-year");
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    ratingYear.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");

    const syncMatchMonths = () => {
      const y = Number(yearSel.value);
      const months = catalog.filter((m) => m.year === y).sort((a, b) => b.month - a.month);
      document.getElementById("filter-month").innerHTML = months
        .map((m) => `<option value="${m.id}">${MONTH_RU[m.month] || m.month}</option>`)
        .join("");
    };
    const syncRatingMonths = () => {
      const y = Number(ratingYear.value);
      const months = catalog.filter((m) => m.year === y).sort((a, b) => b.month - a.month);
      document.getElementById("rating-month").innerHTML = months
        .map((m) => `<option value="${m.id}">${MONTH_RU[m.month] || m.month}</option>`)
        .join("");
    };

    yearSel.addEventListener("change", () => {
      syncMatchMonths();
      loadSelectedMonth();
      paintMonthChips();
    });
    document.getElementById("filter-month").addEventListener("change", () => {
      loadSelectedMonth();
      paintMonthChips();
    });
    document.getElementById("filter-clan").addEventListener("input", paintMatchesTable);

    const scopeEl = document.getElementById("rating-scope");
    const yearWrap = document.getElementById("rating-year-wrap");
    const monthWrap = document.getElementById("rating-month-wrap");
    const syncRatingScopeUi = () => {
      const scope = scopeEl.value;
      yearWrap.hidden = scope === "all";
      monthWrap.hidden = scope !== "month";
    };
    scopeEl.addEventListener("change", () => {
      syncRatingScopeUi();
      if (scopeEl.value === "month") syncRatingMonths();
      loadRating();
    });
    ratingYear.addEventListener("change", () => {
      syncRatingMonths();
      loadRating();
    });
    document.getElementById("rating-month").addEventListener("change", loadRating);
    document.getElementById("rating-nick").addEventListener("input", paintRatingTable);

    if (years.length) {
      yearSel.value = String(years[0]);
      ratingYear.value = String(years[0]);
      syncMatchMonths();
      syncRatingMonths();
      scopeEl.value = "all";
      syncRatingScopeUi();
    }
  }

  let trainingFiltersReady = false;
  function ensureTrainingFilters() {
    if (trainingFiltersReady) return;
    const yearSel = document.getElementById("train-filter-year");
    const monthSel = document.getElementById("train-filter-month");
    if (!yearSel || !monthSel) return;
    const years = [...new Set(trainingCatalog.map((m) => m.year))].sort((a, b) => b - a);
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    const syncMonths = () => {
      const y = Number(yearSel.value);
      const months = trainingCatalog
        .filter((m) => m.year === y)
        .sort((a, b) => b.month - a.month);
      monthSel.innerHTML = months
        .map((m) => `<option value="${m.id}">${MONTH_RU[m.month] || m.month}</option>`)
        .join("");
    };
    yearSel.addEventListener("change", () => {
      syncMonths();
      paintTrainMonthChips();
      loadSelectedTrainingMonth();
    });
    monthSel.addEventListener("change", () => {
      paintTrainMonthChips();
      loadSelectedTrainingMonth();
    });
    const qEl = document.getElementById("train-filter-q");
    if (qEl) qEl.addEventListener("input", paintTrainingTable);
    document.querySelectorAll("#train-matches-table th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.tsort;
        if (trainSortKey === key) trainSortDir = trainSortDir === "asc" ? "desc" : "asc";
        else {
          trainSortKey = key;
          trainSortDir = key === "date" || key === "ticketsA" || key === "ticketsB" ? "desc" : "asc";
        }
        paintTrainingTable();
      });
    });
    if (years.length) {
      yearSel.value = String(years[0]);
      syncMonths();
    }
    trainingFiltersReady = true;
  }

  function paintTrainMonthChips() {
    const box = document.getElementById("train-month-chips");
    if (!box) return;
    const yearSel = document.getElementById("train-filter-year");
    const monthSel = document.getElementById("train-filter-month");
    if (!yearSel || !monthSel) return;
    const y = Number(yearSel.value);
    const selected = monthSel.value;
    const months = trainingCatalog
      .filter((m) => m.year === y)
      .sort((a, b) => a.month - b.month);
    box.innerHTML = months
      .map(
        (m) =>
          `<button type="button" class="month-chip${m.id === selected ? " active" : ""}" data-train-month="${m.id}">${MONTH_RU[m.month] || m.month}</button>`
      )
      .join("");
    box.querySelectorAll("[data-train-month]").forEach((btn) => {
      btn.addEventListener("click", () => {
        monthSel.value = btn.dataset.trainMonth;
        paintTrainMonthChips();
        loadSelectedTrainingMonth();
      });
    });
  }

  function loadSelectedTrainingMonth() {
    const monthSel = document.getElementById("train-filter-month");
    const note = document.getElementById("train-note");
    const title = document.getElementById("train-title");
    if (!monthSel || !trainingCatalog.length) {
      if (note) note.textContent = "Нет каталога тренировок";
      trainMatches = [];
      paintTrainingTable();
      return;
    }
    const meta = trainingCatalog.find((m) => m.id === monthSel.value);
    if (!meta) return;
    trainMonthMeta = meta;
    trainMonthKey = pad(meta.month);
    fetch(dataUrl(meta.url), { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Не удалось загрузить месяц тренировок");
        return r.json();
      })
      .then((data) => {
        trainMatches = (data.matches || []).map((m, i) => ({
          ...m,
          _i: i,
          _month: meta.month,
          _year: meta.year,
          _kind: "training",
        }));
        if (title) title.textContent = data.title || meta.label;
        if (note) note.textContent = data.note || "";
        paintTrainStats(trainMatches);
        paintTrainingTable();
      })
      .catch((err) => {
        if (note) note.textContent = String(err.message || err);
      });
  }

  function paintTrainStats(list) {
    const box = document.getElementById("train-stats");
    if (!box) return;
    const done = list.filter((m) => m.status !== "upcoming");
    box.innerHTML = `
      <div class="stat"><strong>${list.length}</strong><span>каток</span></div>
      <div class="stat"><strong>${done.length}</strong><span>сыграно</span></div>
    `;
  }

  function trainSortValue(m, key) {
    switch (key) {
      case "date":
        return Number(m.day) || 0;
      case "map":
        return String(m.map || "");
      case "mode":
        return String(m.mode || "");
      case "server":
        return String(m.server || "");
      case "factionA":
        return String(m.factionA || "");
      case "factionB":
        return String(m.factionB || "");
      case "ticketsA":
        return Number(m.ticketsA) || 0;
      case "ticketsB":
        return Number(m.ticketsB) || 0;
      case "winner":
        return String(m.winner || "");
      default:
        return "";
    }
  }

  function filteredTrainingMatches() {
    const q = (document.getElementById("train-filter-q")?.value || "").trim().toLowerCase();
    let list = trainMatches.slice();
    if (q) {
      list = list.filter((m) => {
        const blob = [
          m.map,
          m.mode,
          m.server,
          m.factionA,
          m.factionB,
          m.winner,
          factionTitle(m.factionA),
          factionTitle(m.factionB),
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    const dir = trainSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const av = trainSortValue(a, trainSortKey);
      const bv = trainSortValue(b, trainSortKey);
      if (typeof av === "number" && typeof bv === "number") {
        if (av !== bv) return dir * (av - bv);
      } else {
        const cmp = String(av).localeCompare(String(bv), "ru", { sensitivity: "base" });
        if (cmp) return dir * cmp;
      }
      return (Number(a.day) || 0) - (Number(b.day) || 0);
    });
    return list;
  }

  function paintTrainSortMarks() {
    document.querySelectorAll("#train-matches-table th.sortable").forEach((th) => {
      const key = th.dataset.tsort;
      const base = th.dataset.label || th.textContent.replace(/\s*[▲▼↑↓]\s*$/u, "").trim();
      th.dataset.label = base;
      const active = trainSortKey === key;
      const arrow = active ? (trainSortDir === "asc" ? "▲" : "▼") : "";
      th.classList.toggle("is-sorted", active);
      th.setAttribute("aria-sort", active ? (trainSortDir === "asc" ? "ascending" : "descending") : "none");
      th.innerHTML = `${escapeHtml(base)}<span class="sort-ind" aria-hidden="true">${arrow}</span>`;
    });
  }

  function paintTrainingTable() {
    const tbody = document.getElementById("train-rows");
    if (!tbody) return;
    const list = filteredTrainingMatches();
    paintTrainSortMarks();
    paintTrainStats(list);
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Нет тренировок по фильтру</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map((m) => {
        const fa = factionShort(m.factionA);
        const fb = factionShort(m.factionB);
        const win = factionShort(m.winner);
        return `<tr class="clickable" data-train-i="${m._i}" tabindex="0" role="button">
          <td>${pad(m.day)}.${trainMonthKey}</td>
          <td>${escapeHtml(m.map || "—")}</td>
          <td>${escapeHtml(m.mode || "—")}</td>
          <td>${escapeHtml(m.server || "—")}</td>
          <td title="${escapeHtml(factionTitle(m.factionA))}">${escapeHtml(fa)}</td>
          <td>${m.ticketsA != null ? m.ticketsA : "—"}</td>
          <td title="${escapeHtml(factionTitle(m.factionB))}">${escapeHtml(fb)}</td>
          <td>${m.ticketsB != null ? m.ticketsB : "—"}</td>
          <td title="${escapeHtml(factionTitle(m.winner))}"><span class="status"><span class="dot win"></span>${escapeHtml(win)}</span></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("tr.clickable").forEach((tr) => {
      const open = () => openMatch(trainMatches[Number(tr.dataset.trainI)]);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function selectedRatingMetas() {
    const scope = document.getElementById("rating-scope").value;
    if (scope === "all") return catalog.slice();
    const y = Number(document.getElementById("rating-year").value);
    if (scope === "year") return catalog.filter((m) => m.year === y);
    const id = document.getElementById("rating-month").value;
    const one = catalog.find((m) => m.id === id);
    return one ? [one] : [];
  }

  function paintMonthChips() {
    const y = Number(document.getElementById("filter-year").value);
    const selected = document.getElementById("filter-month").value;
    const months = catalog.filter((m) => m.year === y).sort((a, b) => a.month - b.month);
    const box = document.getElementById("month-chips");
    box.innerHTML = months
      .map(
        (m) =>
          `<button type="button" class="chip ${m.id === selected ? "active" : ""}" data-month="${m.id}">${MONTH_RU[m.month]}</button>`
      )
      .join("");
    box.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("filter-month").value = btn.dataset.month;
        loadSelectedMonth();
        paintMonthChips();
      });
    });
  }

  function loadSelectedMonth() {
    const id = document.getElementById("filter-month").value;
    const meta = catalog.find((m) => m.id === id);
    if (!meta) return;
    currentMonthMeta = meta;
    monthKey = pad(meta.month);
    fetch(dataUrl(meta.url))
      .then((r) => {
        if (!r.ok) throw new Error("Не удалось загрузить месяц");
        return r.json();
      })
      .then((data) => {
        monthData = data;
        matches = (data.matches || []).map((m, i) => ({ ...m, _i: i, _month: meta.month, _year: meta.year }));
        document.getElementById("title").textContent = data.title || meta.label;
        document.getElementById("note").textContent = data.note || "";
        paintStats(matches);
        paintMatchesTable();
      })
      .catch((err) => {
        document.getElementById("note").textContent = String(err.message || err);
      });
  }

  function matchSortValue(m, key) {
    switch (key) {
      case "date":
        return Number(m.day) || 0;
      case "time": {
        const t = String(m.timeMsk || "");
        const parts = t.split(":");
        if (parts.length >= 2) return Number(parts[0]) * 60 + Number(parts[1]);
        return t;
      }
      case "clan":
        return m.clan || "BlackBerry";
      case "opp":
        return m.opp || "";
      case "map":
        return m.map || "";
      case "size":
        return m.size || "";
      case "server":
        return m.server || "";
      case "stack":
        return m.stack || "";
      case "meeting":
        return m.meeting || "";
      case "r1":
        return m.r1 || "";
      case "r2":
        return m.r2 || "";
      case "status": {
        const order = { win: 1, draw: 2, lose: 3, upcoming: 4 };
        return order[m.status || "upcoming"] || 9;
      }
      default:
        return "";
    }
  }

  function filteredMatches() {
    const q = (document.getElementById("filter-clan").value || "").trim().toLowerCase();
    let list = matches;
    if (q) {
      list = list.filter((m) => {
        const clanName = String(m.clan || "BlackBerry").toLowerCase();
        const opp = String(m.opp || "").toLowerCase();
        return clanName.includes(q) || opp.includes(q);
      });
    }
    const dir = matchSortDir === "asc" ? 1 : -1;
    const textKeys = new Set(["clan", "opp", "map", "size", "server", "stack", "meeting", "r1", "r2"]);
    return list.slice().sort((a, b) => {
      const av = matchSortValue(a, matchSortKey);
      const bv = matchSortValue(b, matchSortKey);
      if (textKeys.has(matchSortKey) || typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv), "ru", { numeric: true, sensitivity: "base" });
        if (cmp) return dir * cmp;
      } else if (av !== bv) {
        return dir * (Number(av) - Number(bv));
      }
      if (matchSortKey === "date" || matchSortKey === "time") {
        return (
          dir *
          String(a.timeMsk || "").localeCompare(String(b.timeMsk || ""), "ru")
        );
      }
      const dayCmp = (Number(b.day) || 0) - (Number(a.day) || 0);
      if (dayCmp) return dayCmp;
      return String(b.timeMsk || "").localeCompare(String(a.timeMsk || ""), "ru");
    });
  }

  function paintMatchSortMarks() {
    document.querySelectorAll(".matches-table th.sortable").forEach((th) => {
      const key = th.dataset.msort;
      const base = th.dataset.label || th.textContent.replace(/\s*[▲▼↑↓]\s*$/u, "").trim();
      th.dataset.label = base;
      const active = matchSortKey === key;
      const arrow = active ? (matchSortDir === "asc" ? "▲" : "▼") : "";
      th.classList.toggle("is-sorted", active);
      th.setAttribute("aria-sort", active ? (matchSortDir === "asc" ? "ascending" : "descending") : "none");
      th.innerHTML = `${escapeHtml(base)}<span class="sort-ind" aria-hidden="true">${arrow}</span>`;
    });
  }

  function wireMatchSort() {
    const table = document.querySelector(".matches-table");
    if (!table || table.dataset.sortWired) return;
    table.dataset.sortWired = "1";
    table.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.msort;
        if (!key) return;
        if (matchSortKey === key) matchSortDir = matchSortDir === "asc" ? "desc" : "asc";
        else {
          matchSortKey = key;
          matchSortDir =
            key === "date" || key === "time" ? "desc" : key === "status" ? "asc" : "asc";
        }
        paintMatchesTable();
      });
    });
  }

  function paintStats(list) {
    const played = list.filter((m) => m.status !== "upcoming");
    const upcoming = list.filter((m) => m.status === "upcoming");
    const wins = played.filter((m) => m.status === "win").length;
    const draws = played.filter((m) => m.status === "draw").length;
    const losses = played.filter((m) => m.status === "lose").length;
    const wr = played.length ? Math.round((100 * wins) / played.length) : 0;
    document.getElementById("stats").innerHTML = [
      ["Всего", list.length, ""],
      ["Сыграно", played.length, ""],
      ["Впереди", upcoming.length, ""],
      ["W–D–L", `${wins}–${draws}–${losses}`, ""],
      ["Winrate", `${wr}%`, "winrate"],
    ]
      .map(([k, v, cls]) => `<div class="stat ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`)
      .join("");
  }

  function paintMatchesTable() {
    const list = filteredMatches();
    paintMatchSortMarks();
    paintStats(list);
    const tbody = document.getElementById("rows");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="empty-row">Нет матчей по фильтру</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map((m) => {
        const st = m.status || "upcoming";
        const clanName = m.clan || "BlackBerry";
        return `<tr class="${st} clickable" data-i="${m._i}" tabindex="0" role="button">
          <td>${pad(m.day)}.${monthKey}</td>
          <td class="num">${m.timeMsk || "—"}</td>
          <td>${escapeHtml(clanName)}</td>
          <td>${escapeHtml(m.opp || "—")}</td>
          <td>${escapeHtml(m.map || "—")}</td>
          <td class="ctr">${escapeHtml(m.size || "—")}</td>
          <td>${escapeHtml(m.server || "—")}</td>
          <td class="ctr">${escapeHtml(m.stack || "—")}</td>
          <td class="ctr">${escapeHtml(m.meeting || "—")}</td>
          <td class="num">${escapeHtml(m.r1 || "—")}</td>
          <td class="num">${escapeHtml(m.r2 || "—")}</td>
          <td><span class="status"><span class="dot ${st}"></span>${STATUS_RU[st] || st}</span></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("tr.clickable").forEach((tr) => {
      const open = () => openMatch(matches[Number(tr.dataset.i)]);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  /* ——— rating ——— */
  function loadRoster() {
    return fetch(ROSTER_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { byNick: {} }))
      .then((data) => {
        rosterByNick = data.byNick || {};
        return rosterByNick;
      })
      .catch(() => {
        rosterByNick = {};
        return rosterByNick;
      });
  }

  function rosterOf(nick) {
    const info = rosterByNick[nickKey(nick)] || null;
    return {
      clan: info?.clan || "—",
      squad: info?.squad || "—",
      regNo: info?.regNo != null ? Number(info.regNo) : null,
    };
  }

  function ensureLedger() {
    if (ledger) return Promise.resolve(ledger);
    return fetch(dataUrl(LEDGER_URL))
      .then((r) => (r.ok ? r.json() : { players: {}, matches: [] }))
      .then((data) => {
        ledger = data;
        return ledger;
      })
      .catch(() => {
        ledger = { players: {}, matches: [] };
        return ledger;
      });
  }

  function loadRating() {
    const note = document.getElementById("rating-note");
    note.textContent = "Считаем рейтинг…";
    const metas = selectedRatingMetas();
    if (!metas.length) {
      note.textContent = "Нет месяцев для рейтинга";
      ratingRows = [];
      paintRatingTable();
      return;
    }

    Promise.all([
      loadRoster(),
      Promise.all(
        metas.map((meta) =>
          fetch(dataUrl(meta.url))
            .then((r) => r.json())
            .then((data) => ({ meta, data }))
        )
      ),
    ])
      .then(([, months]) => {
        const matchList = [];
        months.forEach(({ data }) => {
          (data.matches || []).forEach((m) => {
            if (m.playersUrl) matchList.push(m);
          });
        });
        return Promise.all(
          matchList.map((m) =>
            fetch(dataUrl(m.playersUrl))
              .then((r) => (r.ok ? r.json() : null))
              .then((pj) => ({ match: m, players: pj }))
              .catch(() => ({ match: m, players: null }))
          )
        );
      })
      .then((bundles) => {
        const map = new Map();
        const touch = (nick) => {
          if (!inRating(nick)) return null;
          const key = resolveNickKey(nick);
          if (!map.has(key)) {
            const ro = rosterOf(displayNick(nick));
            map.set(key, {
              nick: displayNick(nick),
              tier: tierOf(nick),
              clan: ro.clan,
              squad: ro.squad,
              regNo: ro.regNo,
              kv: 0,
              res: 0,
              nok: 0,
              kills: 0,
              deaths: 0,
              dmg: 0,
              mvpMedic: 0,
              mvpKiller: 0,
              mvpDamage: 0,
              antiDeath: 0,
            });
          }
          return map.get(key);
        };

        bundles.forEach(({ players }) => {
          if (!players) return;
          const r1 = players.r1 || [];
          const r2 = players.r2 || [];
          const total = players.total || players.players || sumRounds(r1, r2);
          const inMeeting = new Set();

          total.forEach((p) => {
            if (!p || !p.nick || !inRating(p.nick)) return;
            inMeeting.add(resolveNickKey(p.nick));
            const row = touch(p.nick);
            row.res += Number(p.res) || 0;
            row.nok += Number(p.nok) || 0;
            row.kills += Number(p.kills) || 0;
            row.deaths += Number(p.deaths) || 0;
            row.dmg += Number(p.dmg) || 0;
          });
          [...r1, ...r2].forEach((p) => {
            if (p && p.nick && inRating(p.nick)) inMeeting.add(resolveNickKey(p.nick));
          });
          inMeeting.forEach((key) => {
            const row = map.get(key);
            if (row) row.kv += 1;
          });

          const mvp = players.mvp || {
            r1: pickMvps(enrichRows(r1)),
            r2: pickMvps(enrichRows(r2)),
          };
          ["r1", "r2"].forEach((rk) => {
            const block = mvp[rk] || {};
            (block.medic || []).forEach((n) => {
              const row = touch(n);
              if (row) row.mvpMedic += 1;
            });
            (block.killer || []).forEach((n) => {
              const row = touch(n);
              if (row) row.mvpKiller += 1;
            });
            (block.damage || []).forEach((n) => {
              const row = touch(n);
              if (row) row.mvpDamage += 1;
            });
            (block.antiDeath || []).forEach((n) => {
              const row = touch(n);
              if (row) row.antiDeath += 1;
            });
          });
        });

        ratingRows = Array.from(map.values()).map((p) => ({
          ...p,
          kd: p.deaths === 0 ? p.kills : Math.round((p.kills / p.deaths) * 100) / 100,
        }));
        const withStats = bundles.filter((b) => b.players).length;
        const scope = document.getElementById("rating-scope").value;
        const scopeRu = scope === "all" ? "за всё время" : scope === "year" ? "за год" : "за месяц";
        note.textContent = withStats
          ? `Период: ${scopeRu}. Каток КВ со статой: ${withStats}. Ников: ${ratingRows.length}.`
          : "Пока нет каток КВ с внесённой статой — рейтинг пуст.";
        paintRatingTable();
      })
      .catch((err) => {
        note.textContent = String(err.message || err);
      });
  }

  function paintRatingSortMarks() {
    document.querySelectorAll("#cw-rating-table th.sortable").forEach((th) => {
      const key = th.dataset.rsort;
      const base = th.dataset.label || th.textContent.replace(/\s*[▲▼↑↓]\s*$/u, "").trim();
      th.dataset.label = base;
      const active = ratingSortKey === key;
      const arrow = active ? (ratingSortDir === "asc" ? "▲" : "▼") : "";
      th.classList.toggle("is-sorted", active);
      th.setAttribute("aria-sort", active ? (ratingSortDir === "asc" ? "ascending" : "descending") : "none");
      th.innerHTML = `${escapeHtml(base)}<span class="sort-ind" aria-hidden="true">${arrow}</span>`;
    });
  }

  function paintRatingTable() {
    const q = (document.getElementById("rating-nick").value || "").trim().toLowerCase();
    let rows = ratingRows;
    if (q) rows = rows.filter((p) => p.nick.toLowerCase().includes(q));
    const dir = ratingSortDir === "asc" ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      if (ratingSortKey === "nick" || ratingSortKey === "clan") {
        return dir * String(a[ratingSortKey] || "").localeCompare(String(b[ratingSortKey] || ""), "ru");
      }
      if (ratingSortKey === "regNo") {
        const av = a.regNo == null ? Number.POSITIVE_INFINITY : Number(a.regNo);
        const bv = b.regNo == null ? Number.POSITIVE_INFINITY : Number(b.regNo);
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      if (ratingSortKey === "tier") {
        if (a.tier !== b.tier) return dir * (a.tier - b.tier);
        return a.nick.localeCompare(b.nick, "ru");
      }
      const av = Number(a[ratingSortKey]) || 0;
      const bv = Number(b[ratingSortKey]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });

    paintRatingSortMarks();

    const tbody = document.getElementById("rating-rows");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="15" class="empty-row">Нет игроков</td></tr>`;
      refreshDualScrolls();
      return;
    }
    tbody.innerHTML = rows
      .map(
        (p) => `<tr>
        <td class="ctr">${p.regNo != null ? p.regNo : "—"}</td>
        <td>${nickLinkHtml(p.nick)}</td>
        <td class="ctr">${escapeHtml(p.clan || "—")}</td>
        <td class="ctr tier tier-${p.tier || 4}">${escapeHtml(tierLabel(p.tier || 4))}</td>
        <td class="ctr">${p.kv}</td>
        <td class="ctr">${p.res}</td>
        <td class="ctr">${p.nok}</td>
        <td class="ctr">${p.kills}</td>
        <td class="ctr">${p.deaths}</td>
        <td class="ctr">${p.kd}</td>
        <td class="ctr">${p.dmg}</td>
        <td class="ctr col-mvp-medic">${p.mvpMedic}</td>
        <td class="ctr col-mvp-killer">${p.mvpKiller}</td>
        <td class="ctr col-mvp-war">${p.mvpDamage}</td>
        <td class="ctr col-mvp-anti">${p.antiDeath}</td>
      </tr>`
      )
      .join("");
    refreshDualScrolls();
  }

  document.querySelectorAll("#cw-rating-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.rsort;
      if (ratingSortKey === key) ratingSortDir = ratingSortDir === "asc" ? "desc" : "asc";
      else {
        ratingSortKey = key;
        ratingSortDir = key === "nick" || key === "tier" || key === "clan" || key === "regNo" ? "asc" : "desc";
      }
      paintRatingTable();
    });
  });

  /* ——— training rating (separate from CW) ——— */
  let trainRatingFiltersReady = false;
  function ensureTrainRatingFilters() {
    if (trainRatingFiltersReady) return;
    const yearSel = document.getElementById("train-rating-year");
    const monthSel = document.getElementById("train-rating-month");
    const scopeEl = document.getElementById("train-rating-scope");
    if (!yearSel || !monthSel || !scopeEl) return;

    const years = [...new Set(trainingCatalog.map((m) => m.year))].sort((a, b) => b - a);
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    const syncMonths = () => {
      const y = Number(yearSel.value);
      const months = trainingCatalog
        .filter((m) => m.year === y)
        .sort((a, b) => b.month - a.month);
      monthSel.innerHTML = months
        .map((m) => `<option value="${m.id}">${MONTH_RU[m.month] || m.month}</option>`)
        .join("");
    };
    const yearWrap = document.getElementById("train-rating-year-wrap");
    const monthWrap = document.getElementById("train-rating-month-wrap");
    const syncScopeUi = () => {
      const scope = scopeEl.value;
      if (yearWrap) yearWrap.hidden = scope === "all";
      if (monthWrap) monthWrap.hidden = scope !== "month";
    };
    scopeEl.addEventListener("change", () => {
      syncScopeUi();
      if (scopeEl.value === "month") syncMonths();
      loadTrainingRating();
    });
    yearSel.addEventListener("change", () => {
      syncMonths();
      loadTrainingRating();
    });
    monthSel.addEventListener("change", loadTrainingRating);
    const nickEl = document.getElementById("train-rating-nick");
    if (nickEl) nickEl.addEventListener("input", paintTrainingRatingTable);
    document.querySelectorAll("#train-rating-table th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.trsort;
        if (trainRatingSortKey === key) {
          trainRatingSortDir = trainRatingSortDir === "asc" ? "desc" : "asc";
        } else {
          trainRatingSortKey = key;
          trainRatingSortDir =
            key === "nick" || key === "clan" || key === "regNo" || key === "tier"
              ? "asc"
              : "desc";
        }
        paintTrainingRatingTable();
      });
    });
    if (years.length) {
      yearSel.value = String(years[0]);
      syncMonths();
      scopeEl.value = "all";
      syncScopeUi();
    }
    trainRatingFiltersReady = true;
  }

  function selectedTrainingRatingMetas() {
    const scope = document.getElementById("train-rating-scope")?.value || "all";
    if (scope === "all") return trainingCatalog.slice();
    const y = Number(document.getElementById("train-rating-year")?.value);
    if (scope === "year") return trainingCatalog.filter((m) => m.year === y);
    const id = document.getElementById("train-rating-month")?.value;
    const one = trainingCatalog.find((m) => m.id === id);
    return one ? [one] : [];
  }

  function loadTrainingRating() {
    const note = document.getElementById("train-rating-note");
    if (!note) return;
    note.textContent = "Считаем рейтинг тренировок…";
    const metas = selectedTrainingRatingMetas();
    if (!metas.length) {
      note.textContent = "Нет месяцев тренировок";
      trainRatingRows = [];
      paintTrainingRatingTable();
      return;
    }

    Promise.all([
      loadRoster(),
      Promise.all(
        metas.map((meta) =>
          fetch(dataUrl(meta.url))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => (data ? { meta, data } : null))
            .catch(() => null)
        )
      ),
    ])
      .then(([, months]) => {
        const matchList = [];
        (months || []).forEach((bundle) => {
          if (!bundle || !bundle.data) return;
          (bundle.data.matches || []).forEach((m) => {
            if (m.playersUrl) matchList.push(m);
          });
        });
        return Promise.all(
          matchList.map((m) =>
            fetch(dataUrl(m.playersUrl))
              .then((r) => (r.ok ? r.json() : null))
              .then((pj) => ({ match: m, players: pj }))
              .catch(() => ({ match: m, players: null }))
          )
        );
      })
      .then((bundles) => {
        const map = new Map();
        const touch = (nick) => {
          if (!inRating(nick)) return null;
          const key = resolveNickKey(nick);
          if (!map.has(key)) {
            const ro = rosterOf(displayNick(nick));
            map.set(key, {
              nick: displayNick(nick),
              clan: ro.clan,
              regNo: ro.regNo,
              tier: tierOf(nick),
              games: 0,
              wins: 0,
              winPct: null,
              res: 0,
              nok: 0,
              kills: 0,
              deaths: 0,
              dmg: 0,
              mvpMedic: 0,
              mvpKiller: 0,
              mvpDamage: 0,
              antiDeath: 0,
            });
          }
          return map.get(key);
        };

        bundles.forEach(({ match, players }) => {
          if (!players) return;
          const list =
            players.players && players.players.length
              ? players.players
              : [].concat(players.teamA || [], players.teamB || []);
          const seen = new Set();
          list.forEach((p) => {
            if (!p || !p.nick || !inRating(p.nick)) return;
            const row = touch(p.nick);
            if (!row) return;
            row.res += Number(p.res) || 0;
            row.nok += Number(p.nok) || 0;
            row.kills += Number(p.kills) || 0;
            row.deaths += Number(p.deaths) || 0;
            row.dmg += Number(p.dmg) || 0;
            const key = resolveNickKey(p.nick);
            if (seen.has(key)) return;
            seen.add(key);
            row.games += 1;
            const won =
              p.won === true ||
              (match.winner &&
                p.team &&
                String(p.team).toUpperCase() === String(match.winner).toUpperCase());
            if (won) row.wins += 1;
          });

          /* MVP только для рейтинга тренировок — в mvp-ledger / профиль КВ не пишем */
          const pool = list.filter((p) => p && p.nick && inRating(p.nick));
          const mvp =
            (players.mvp && players.mvp.train) || pickMvps(enrichRows(pool));
          const bump = (nicks, keyName) => {
            (nicks || []).forEach((n) => {
              const row = touch(n);
              if (row) row[keyName] += 1;
            });
          };
          bump(mvp.medic, "mvpMedic");
          bump(mvp.killer, "mvpKiller");
          bump(mvp.damage, "mvpDamage");
          bump(mvp.antiDeath, "antiDeath");
        });

        trainRatingRows = Array.from(map.values()).map((p) => {
          const winPct =
            p.games > 0 ? Math.round((1000 * p.wins) / p.games) / 10 : null;
          const base = {
            ...p,
            mvpMedic: Number(p.mvpMedic) || 0,
            mvpKiller: Number(p.mvpKiller) || 0,
            mvpDamage: Number(p.mvpDamage) || 0,
            antiDeath: Number(p.antiDeath) || 0,
            kd: p.deaths === 0 ? p.kills : Math.round((p.kills / p.deaths) * 100) / 100,
            winPct,
          };
          const { pwr, band, label, rankKey } = calcTrainPwr(base);
          return { ...base, pwr, pwrBand: band, pwrLabel: label, rankKey };
        });
        const withStats = bundles.filter((b) => b.players).length;
        const scope = document.getElementById("train-rating-scope")?.value || "all";
        const scopeRu =
          scope === "all" ? "за всё время" : scope === "year" ? "за год" : "за месяц";
        note.textContent = withStats
          ? `Период: ${scopeRu}. Тренировок со статой: ${withStats}. Ников: ${trainRatingRows.length}.`
          : "Пока нет тренировок с внесённой статой — рейтинг пуст.";
        paintTrainingRatingTable();
      })
      .catch((err) => {
        note.textContent = String(err.message || err);
      });
  }

  function paintTrainingRatingSortMarks() {
    document.querySelectorAll("#train-rating-table th.sortable").forEach((th) => {
      const key = th.dataset.trsort;
      const base = th.dataset.label || th.textContent.replace(/\s*[▲▼↑↓]\s*$/u, "").trim();
      th.dataset.label = base;
      const active = trainRatingSortKey === key;
      const arrow = active ? (trainRatingSortDir === "asc" ? "▲" : "▼") : "";
      th.classList.toggle("is-sorted", active);
      th.setAttribute(
        "aria-sort",
        active ? (trainRatingSortDir === "asc" ? "ascending" : "descending") : "none"
      );
      th.innerHTML = `${escapeHtml(base)}<span class="sort-ind" aria-hidden="true">${arrow}</span>`;
    });
  }

  function paintTrainingRatingTable() {
    const tbody = document.getElementById("train-rating-rows");
    if (!tbody) return;
    const q = (document.getElementById("train-rating-nick")?.value || "")
      .trim()
      .toLowerCase();
    let rows = trainRatingRows;
    if (q) rows = rows.filter((p) => p.nick.toLowerCase().includes(q));
    const dir = trainRatingSortDir === "asc" ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      if (trainRatingSortKey === "nick" || trainRatingSortKey === "clan") {
        return (
          dir *
          String(a[trainRatingSortKey] || "").localeCompare(
            String(b[trainRatingSortKey] || ""),
            "ru"
          )
        );
      }
      if (trainRatingSortKey === "tier") {
        const av = Number(a.tier) || 4;
        const bv = Number(b.tier) || 4;
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      if (trainRatingSortKey === "regNo") {
        const av = a.regNo == null ? Number.POSITIVE_INFINITY : Number(a.regNo);
        const bv = b.regNo == null ? Number.POSITIVE_INFINITY : Number(b.regNo);
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      if (trainRatingSortKey === "winPct") {
        const av = a.winPct == null ? -1 : Number(a.winPct);
        const bv = b.winPct == null ? -1 : Number(b.winPct);
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      if (trainRatingSortKey === "pwrLabel" || trainRatingSortKey === "rank") {
        const av = Number(a.pwr) || 0;
        const bv = Number(b.pwr) || 0;
        if (av !== bv) return dir * (av - bv);
        return a.nick.localeCompare(b.nick, "ru");
      }
      const av = Number(a[trainRatingSortKey]) || 0;
      const bv = Number(b[trainRatingSortKey]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });

    paintTrainingRatingSortMarks();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="18" class="empty-row">Нет игроков</td></tr>`;
      refreshDualScrolls();
      return;
    }
    tbody.innerHTML = rows
      .map(
        (p, i) => `<tr>
        <td class="ctr col-place">${i + 1}</td>
        <td class="ctr col-rank"><span class="rank-badge rank-${escapeHtml(p.rankKey || "iron")}">${escapeHtml(p.pwrLabel || "—")}</span></td>
        <td class="ctr col-pwr">${p.pwr != null ? p.pwr : "—"}</td>
        <td>${nickLinkHtml(p.nick)}</td>
        <td class="ctr">${escapeHtml(p.clan || "—")}</td>
        <td class="ctr tier tier-${p.tier || 4}">${escapeHtml(tierLabel(p.tier || 4))}</td>
        <td class="ctr">${p.games}</td>
        <td class="ctr">${p.winPct != null ? `${p.winPct}%` : "—"}</td>
        <td class="ctr">${p.res}</td>
        <td class="ctr">${p.nok}</td>
        <td class="ctr">${p.kills}</td>
        <td class="ctr">${p.deaths}</td>
        <td class="ctr">${p.kd}</td>
        <td class="ctr">${p.dmg}</td>
        <td class="ctr col-mvp-medic">${Number(p.mvpMedic) || 0}</td>
        <td class="ctr col-mvp-killer">${Number(p.mvpKiller) || 0}</td>
        <td class="ctr col-mvp-war">${Number(p.mvpDamage) || 0}</td>
        <td class="ctr col-mvp-anti">${Number(p.antiDeath) || 0}</td>
      </tr>`
      )
      .join("");
    refreshDualScrolls();
  }

  /* ——— training analytics ——— */
  let trainAnFiltersReady = false;
  let cwAnFiltersReady = false;

  function parseTicketPair(raw) {
    const m = String(raw || "").match(/(\d+)\s*[:：]\s*(\d+)/);
    if (!m) return null;
    return { us: Number(m[1]), them: Number(m[2]) };
  }

  function cwPlayerList(players) {
    if (!players) return [];
    if (players.total && players.total.length) return players.total;
    if (players.players && players.players.length) return players.players;
    const r1 = players.r1 || [];
    const r2 = players.r2 || [];
    if (!r1.length && !r2.length) return [];
    return sumRounds(r1, r2);
  }

  function cwUniqueNicks(players) {
    const set = new Set();
    if (!players) return [];
    [...(players.r1 || []), ...(players.r2 || []), ...cwPlayerList(players)].forEach(
      (p) => {
        if (p && p.nick && inRating(p.nick)) set.add(resolveNickKey(p.nick));
      }
    );
    return [...set];
  }

  function ensureCwAnalyticsFilters() {
    if (cwAnFiltersReady) return;
    const yearSel = document.getElementById("cw-an-year");
    const monthSel = document.getElementById("cw-an-month");
    const scopeEl = document.getElementById("cw-an-scope");
    const stackEl = document.getElementById("cw-an-stack");
    if (!yearSel || !monthSel || !scopeEl) return;

    const years = [...new Set(catalog.map((m) => m.year))].sort((a, b) => b - a);
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    const syncMonths = () => {
      const y = Number(yearSel.value);
      const months = catalog
        .filter((m) => m.year === y)
        .sort((a, b) => b.month - a.month);
      monthSel.innerHTML = months
        .map((m) => `<option value="${m.id}">${MONTH_RU[m.month] || m.month}</option>`)
        .join("");
    };
    const yearWrap = document.getElementById("cw-an-year-wrap");
    const monthWrap = document.getElementById("cw-an-month-wrap");
    const syncScopeUi = () => {
      const scope = scopeEl.value;
      if (yearWrap) yearWrap.hidden = scope === "all";
      if (monthWrap) monthWrap.hidden = scope !== "month";
    };
    const reload = () => loadCwAnalytics();
    scopeEl.addEventListener("change", () => {
      syncScopeUi();
      if (scopeEl.value === "month") syncMonths();
      reload();
    });
    yearSel.addEventListener("change", () => {
      syncMonths();
      reload();
    });
    monthSel.addEventListener("change", reload);
    if (stackEl) stackEl.addEventListener("change", reload);
    if (years.length) {
      yearSel.value = String(years[0]);
      syncMonths();
      scopeEl.value = "all";
      syncScopeUi();
    }
    cwAnFiltersReady = true;
  }

  function selectedCwAnalyticsMetas() {
    const scope = document.getElementById("cw-an-scope")?.value || "all";
    if (scope === "all") return catalog.slice();
    const y = Number(document.getElementById("cw-an-year")?.value);
    if (scope === "year") return catalog.filter((m) => m.year === y);
    const id = document.getElementById("cw-an-month")?.value;
    const one = catalog.find((m) => m.id === id);
    return one ? [one] : [];
  }

  function loadCwAnalytics() {
    const note = document.getElementById("cw-an-note");
    const body = document.getElementById("cw-an-body");
    const kpis = document.getElementById("cw-an-kpis");
    if (!note || !body || !kpis) return;
    note.textContent = "Считаем аналитику КВ…";
    body.hidden = true;
    kpis.innerHTML = "";

    const metas = selectedCwAnalyticsMetas();
    if (!metas.length) {
      note.textContent = "Нет месяцев КВ";
      return;
    }

    const stackFilter = document.getElementById("cw-an-stack")?.value || "all";

    Promise.all([
      loadRoster(),
      Promise.all(
        metas.map((meta) =>
          fetch(dataUrl(meta.url))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => (data ? { meta, data } : null))
            .catch(() => null)
        )
      ),
    ])
      .then(([, months]) => {
        const matchList = [];
        (months || []).forEach((bundle) => {
          if (!bundle || !bundle.data) return;
          (bundle.data.matches || []).forEach((m) => {
            if (m.status === "upcoming") return;
            if (
              stackFilter !== "all" &&
              String(m.stack || "").toLowerCase() !== stackFilter.toLowerCase()
            ) {
              return;
            }
            matchList.push({
              ...m,
              _year: bundle.meta.year,
              _month: bundle.meta.month,
              _monthId: bundle.meta.id,
            });
          });
        });
        return Promise.all(
          matchList.map((m) =>
            m.playersUrl
              ? fetch(dataUrl(m.playersUrl))
                  .then((r) => (r.ok ? r.json() : null))
                  .then((pj) => ({ match: m, players: pj }))
                  .catch(() => ({ match: m, players: null }))
              : Promise.resolve({ match: m, players: null })
          )
        );
      })
      .then((bundles) => {
        paintCwAnalytics(bundles || []);
      })
      .catch((err) => {
        note.textContent = String(err.message || err);
      });
  }

  function paintCwAnalytics(bundles) {
    const note = document.getElementById("cw-an-note");
    const body = document.getElementById("cw-an-body");
    const kpis = document.getElementById("cw-an-kpis");
    if (!note || !body || !kpis) return;

    if (!bundles.length) {
      note.textContent = "В выбранном периоде нет сыгранных КВ";
      body.hidden = true;
      return;
    }

    const wins = bundles.filter((b) => b.match.status === "win").length;
    const draws = bundles.filter((b) => b.match.status === "draw").length;
    const losses = bundles.filter((b) => b.match.status === "lose").length;
    const n = bundles.length;
    const winrate = n ? Math.round((1000 * wins) / n) / 10 : 0;

    const mapCount = new Map();
    const familyCount = new Map();
    const familyWins = new Map();
    const sizeCount = new Map();
    const serverCount = new Map();
    const stackStat = new Map();
    const oppStat = new Map();
    const playerMap = new Map();
    const uniqueNicks = new Set();
    const rosterSizes = [];
    const durations = [];
    const ticketMargins = [];
    let totalKills = 0;
    let totalDeaths = 0;
    let totalDmg = 0;
    let totalRes = 0;
    let totalNok = 0;
    let infUs = 0;
    let infThem = 0;
    let vehUs = 0;
    let vehThem = 0;
    let detailsN = 0;
    const tierSeatSum = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let tierSeatMatches = 0;

    const touchStack = (name) => {
      const key = name || "—";
      if (!stackStat.has(key)) {
        stackStat.set(key, { name: key, games: 0, wins: 0, draws: 0, losses: 0 });
      }
      return stackStat.get(key);
    };
    const touchOpp = (name) => {
      const key = name || "—";
      if (!oppStat.has(key)) {
        oppStat.set(key, {
          name: key,
          games: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          stacks: new Set(),
        });
      }
      return oppStat.get(key);
    };
    const touchPlayer = (nick) => {
      if (!nick || !inRating(nick)) return null;
      const key = resolveNickKey(nick);
      uniqueNicks.add(key);
      if (!playerMap.has(key)) {
        const ro = rosterOf(displayNick(nick));
        playerMap.set(key, {
          nick: displayNick(nick),
          tier: tierOf(nick),
          clan: ro.clan,
          games: 0,
          kills: 0,
          deaths: 0,
          dmg: 0,
          res: 0,
          nok: 0,
          mvpMedic: 0,
          mvpKiller: 0,
          mvpDamage: 0,
          antiDeath: 0,
        });
      }
      return playerMap.get(key);
    };

    const matchRows = [];

    bundles.forEach(({ match: m, players }) => {
      const map = m.map || "—";
      mapCount.set(map, (mapCount.get(map) || 0) + 1);
      const fam = mapFamilyName(map);
      familyCount.set(fam, (familyCount.get(fam) || 0) + 1);
      if (m.status === "win") {
        familyWins.set(fam, (familyWins.get(fam) || 0) + 1);
      }
      const size = m.size || "—";
      sizeCount.set(size, (sizeCount.get(size) || 0) + 1);
      const server = m.server || "—";
      serverCount.set(server, (serverCount.get(server) || 0) + 1);

      const st = touchStack(m.stack || "—");
      st.games += 1;
      if (m.status === "win") st.wins += 1;
      else if (m.status === "draw") st.draws += 1;
      else if (m.status === "lose") st.losses += 1;

      const opp = touchOpp(m.opp || "—");
      opp.games += 1;
      opp.stacks.add(m.stack || "—");
      if (m.status === "win") opp.wins += 1;
      else if (m.status === "draw") opp.draws += 1;
      else if (m.status === "lose") opp.losses += 1;

      const r1t =
        parseTicketPair(m.r1) ||
        parseTicketPair(players?.summary?.r1Tickets) ||
        parseTicketPair(players?.details?.r1?.tickets);
      const r2t =
        parseTicketPair(m.r2) ||
        parseTicketPair(players?.summary?.r2Tickets) ||
        parseTicketPair(players?.details?.r2?.tickets);
      if (r1t) ticketMargins.push(r1t.us - r1t.them);
      if (r2t) ticketMargins.push(r2t.us - r2t.them);

      const len1 = parseDurationSec(players?.summary?.r1Len || players?.details?.r1?.len);
      const len2 = parseDurationSec(players?.summary?.r2Len || players?.details?.r2?.len);
      if (len1 != null) durations.push(len1);
      if (len2 != null) durations.push(len2);

      const d1 = players?.details?.r1;
      const d2 = players?.details?.r2;
      const parseSigned = (s) => {
        const mm = String(s || "").match(/(-?\d+)\s*\/\s*(-?\d+)/);
        return mm ? { us: Number(mm[1]), them: Number(mm[2]) } : null;
      };
      [d1, d2].forEach((d) => {
        if (!d) return;
        const inf = parseSigned(d.infantry);
        const veh = parseSigned(d.veh);
        if (inf) {
          infUs += Math.abs(inf.us);
          infThem += Math.abs(inf.them);
          detailsN += 1;
        }
        if (veh) {
          vehUs += Math.abs(veh.us);
          vehThem += Math.abs(veh.them);
        }
      });

      const nicks = cwUniqueNicks(players);
      const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      nicks.forEach((key) => {
        const nick =
          [...(players?.r1 || []), ...(players?.r2 || []), ...cwPlayerList(players)].find(
            (p) => p && resolveNickKey(p.nick) === key
          )?.nick || key;
        const t = tierOf(nick) || 4;
        tierCounts[t] = (tierCounts[t] || 0) + 1;
        touchPlayer(nick);
      });
      if (nicks.length) {
        rosterSizes.push(nicks.length);
        tierSeatMatches += 1;
        [1, 2, 3, 4].forEach((t) => {
          tierSeatSum[t] += tierCounts[t] || 0;
        });
      }

      const totals = cwPlayerList(players);
      const seenGame = new Set();
      totals.forEach((p) => {
        if (!p || !p.nick) return;
        const row = touchPlayer(p.nick);
        if (!row) return;
        row.res += Number(p.res) || 0;
        row.nok += Number(p.nok) || 0;
        row.kills += Number(p.kills) || 0;
        row.deaths += Number(p.deaths) || 0;
        row.dmg += Number(p.dmg) || 0;
        totalRes += Number(p.res) || 0;
        totalNok += Number(p.nok) || 0;
        totalKills += Number(p.kills) || 0;
        totalDeaths += Number(p.deaths) || 0;
        totalDmg += Number(p.dmg) || 0;
      });
      nicks.forEach((key) => {
        const row = playerMap.get(key);
        if (row && !seenGame.has(key)) {
          row.games += 1;
          seenGame.add(key);
        }
      });

      const mvp = players?.mvp || {};
      ["r1", "r2"].forEach((rk) => {
        const block = mvp[rk] || {};
        (block.medic || []).forEach((n) => {
          const row = touchPlayer(n);
          if (row) row.mvpMedic += 1;
        });
        (block.killer || []).forEach((n) => {
          const row = touchPlayer(n);
          if (row) row.mvpKiller += 1;
        });
        (block.damage || []).forEach((n) => {
          const row = touchPlayer(n);
          if (row) row.mvpDamage += 1;
        });
        (block.antiDeath || []).forEach((n) => {
          const row = touchPlayer(n);
          if (row) row.antiDeath += 1;
        });
      });

      const factions = [d1?.us, d2?.us].filter(Boolean).join(" / ") || "—";
      const durLabel =
        len1 != null || len2 != null
          ? [len1, len2]
              .filter((x) => x != null)
              .map(formatDurationSec)
              .join(" + ")
          : "—";

      matchRows.push({
        m,
        nicks: nicks.length,
        tierCounts,
        t1pct: nicks.length
          ? Math.round((1000 * (tierCounts[1] || 0)) / nicks.length) / 10
          : null,
        r1: m.r1 || players?.summary?.r1Tickets || "—",
        r2: m.r2 || players?.summary?.r2Tickets || "—",
        durLabel,
        factions,
      });
    });

    const scope = document.getElementById("cw-an-scope")?.value || "all";
    const stackFilter = document.getElementById("cw-an-stack")?.value || "all";
    const scopeRu =
      scope === "all" ? "за всё время" : scope === "year" ? "за год" : "за месяц";
    const stackRu =
      stackFilter === "all" ? "все составы" : stackFilter;
    note.textContent = `Период: ${scopeRu} · ${stackRu}. Встреч: ${n} (${wins}W-${draws}D-${losses}L). Игроков: ${uniqueNicks.size}.`;

    const avgRoster = rosterSizes.length
      ? Math.round(rosterSizes.reduce((a, b) => a + b, 0) / rosterSizes.length)
      : null;
    const avgDur = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    const avgMargin = ticketMargins.length
      ? Math.round(
          ticketMargins.reduce((a, b) => a + b, 0) / ticketMargins.length
        )
      : null;

    kpis.innerHTML = [
      ["Встреч", String(n)],
      ["Победы", `${wins} (${winrate}%)`],
      ["Ничьи", String(draws)],
      ["Поражения", String(losses)],
      ["Игроков", String(uniqueNicks.size)],
      ["Ср. явка", avgRoster != null ? String(avgRoster) : "—"],
      ["Ср. раунд", avgDur != null ? formatDurationSec(avgDur) : "—"],
      ["Ср. Δ тикетов", avgMargin != null ? String(avgMargin) : "—"],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
      )
      .join("");

    const stackRows = [...stackStat.values()]
      .map((s) => ({
        ...s,
        pct: s.games ? Math.round((1000 * s.wins) / s.games) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games);
    document.getElementById("cw-an-results").innerHTML = `
      <ul class="ta-facts">
        <li><span>Общий winrate</span><strong>${winrate}%</strong></li>
        <li><span>Счёт встреч</span><strong>${wins}–${draws}–${losses}</strong></li>
      </ul>
      <h3 class="ta-subh">По составу</h3>
      ${taBars(
        stackRows.map((s) => ({
          label: s.name,
          count: s.games,
          share: Math.round((1000 * s.games) / n) / 10,
          extra: `${s.wins}W/${s.draws}D/${s.losses}L · ${s.pct}%`,
        }))
      )}
    `;

    const toRanked = (mapObj) =>
      [...mapObj.entries()]
        .map(([label, count]) => ({
          label,
          count,
          share: Math.round((1000 * count) / n) / 10,
          extra:
            familyWins.has(label) && count
              ? `W ${Math.round((1000 * (familyWins.get(label) || 0)) / count) / 10}%`
              : "",
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));

    document.getElementById("cw-an-maps").innerHTML = `
      <h3 class="ta-subh">Семейства</h3>
      ${taBars(toRanked(familyCount))}
      <h3 class="ta-subh">Точные слои</h3>
      ${taBars(
        [...mapCount.entries()]
          .map(([label, count]) => ({
            label,
            count,
            share: Math.round((1000 * count) / n) / 10,
          }))
          .sort((a, b) => b.count - a.count)
      )}
    `;

    document.getElementById("cw-an-opps").innerHTML = [...oppStat.values()]
      .map((o) => ({
        ...o,
        pct: o.games ? Math.round((1000 * o.wins) / o.games) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games || b.pct - a.pct)
      .map(
        (o) => `<tr>
        <td><strong>${escapeHtml(o.name)}</strong></td>
        <td class="ctr">${o.games}</td>
        <td class="ctr">${o.wins}</td>
        <td class="ctr">${o.draws}</td>
        <td class="ctr">${o.losses}</td>
        <td class="ctr">${o.pct}%</td>
        <td>${escapeHtml([...o.stacks].join(", "))}</td>
      </tr>`
      )
      .join("");

    document.getElementById("cw-an-formats").innerHTML = `
      <h3 class="ta-subh">Формат</h3>
      ${taBars(
        [...sizeCount.entries()]
          .map(([label, count]) => ({
            label,
            count,
            share: Math.round((1000 * count) / n) / 10,
          }))
          .sort((a, b) => b.count - a.count)
      )}
      <h3 class="ta-subh">Серверы</h3>
      ${taBars(
        [...serverCount.entries()]
          .map(([label, count]) => ({
            label,
            count,
            share: Math.round((1000 * count) / n) / 10,
          }))
          .sort((a, b) => b.count - a.count)
      )}
    `;

    const blowouts = ticketMargins.filter((d) => d >= 100).length;
    const closeR = ticketMargins.filter((d) => Math.abs(d) <= 20).length;
    document.getElementById("cw-an-pace").innerHTML = `
      <ul class="ta-facts">
        <li><span>Средняя длительность раунда</span><strong>${avgDur != null ? formatDurationSec(avgDur) : "—"}</strong></li>
        <li><span>Раундов с тикетами</span><strong>${ticketMargins.length}</strong></li>
        <li><span>Средняя Δ (наши − их)</span><strong>${avgMargin != null ? avgMargin : "—"}</strong></li>
        <li><span>Разгромы (Δ≥100)</span><strong>${blowouts}</strong></li>
        <li><span>Близкие раунды (|Δ|≤20)</span><strong>${closeR}</strong></li>
        <li><span>Пехота ∑ |наши| / |их|</span><strong>${detailsN ? `${infUs} / ${infThem}` : "—"}</strong></li>
        <li><span>Техника ∑ |наши| / |их|</span><strong>${detailsN ? `${vehUs} / ${vehThem}` : "—"}</strong></li>
        <li><span>Килы / смерти / KD</span><strong>${totalKills} / ${totalDeaths} / ${
          totalDeaths === 0
            ? totalKills
            : Math.round((100 * totalKills) / totalDeaths) / 100
        }</strong></li>
      </ul>
    `;

    const uniqueTier = new Map();
    playerMap.forEach((p) => {
      const t = p.tier || 4;
      uniqueTier.set(t, (uniqueTier.get(t) || 0) + 1);
    });
    const avgTierMix = [1, 2, 3, 4].map((t) => ({
      label: `${tierLabel(t)} · ср. на катку`,
      count:
        tierSeatMatches > 0
          ? Math.round((10 * tierSeatSum[t]) / tierSeatMatches) / 10
          : 0,
      share:
        tierSeatMatches > 0 && rosterSizes.length
          ? Math.round(
              (1000 * (tierSeatSum[t] / tierSeatMatches)) /
                (rosterSizes.reduce((a, b) => a + b, 0) / rosterSizes.length)
            ) / 10
          : 0,
    }));
    document.getElementById("cw-an-tiers").innerHTML = `
      <h3 class="ta-subh">Уникальные игроки периода</h3>
      ${taBars(
        [1, 2, 3, 4].map((t) => ({
          label: tierLabel(t),
          count: uniqueTier.get(t) || 0,
          share: uniqueNicks.size
            ? Math.round((1000 * (uniqueTier.get(t) || 0)) / uniqueNicks.size) / 10
            : 0,
        }))
      )}
      <h3 class="ta-subh">Средний микс на одну катку</h3>
      ${taBars(avgTierMix)}
    `;

    document.getElementById("cw-an-rosters").innerHTML = matchRows
      .slice()
      .sort((a, b) => {
        const ak = `${a.m._year}-${a.m._month}-${a.m.day}-${a.m.opp}`;
        const bk = `${b.m._year}-${b.m._month}-${b.m.day}-${b.m.opp}`;
        return ak.localeCompare(bk);
      })
      .map(({ m, nicks: nn, tierCounts, t1pct }) => {
        const st = m.status || "";
        return `<tr class="${st}">
          <td>${pad(m.day)}.${pad(m._month)}.${m._year}</td>
          <td><strong>${escapeHtml(m.opp || "—")}</strong></td>
          <td>${escapeHtml(mapFamilyName(m.map))}</td>
          <td class="ctr">${escapeHtml(m.stack || "—")}</td>
          <td class="ctr">${escapeHtml(m.meeting || "—")}</td>
          <td class="ctr">${nn || "—"}</td>
          <td class="ctr tier tier-1">${tierCounts[1] || 0}</td>
          <td class="ctr tier tier-2">${tierCounts[2] || 0}</td>
          <td class="ctr tier tier-3">${tierCounts[3] || 0}</td>
          <td class="ctr tier tier-4">${tierCounts[4] || 0}</td>
          <td class="ctr">${t1pct != null ? t1pct + "%" : "—"}</td>
        </tr>`;
      })
      .join("");

    const players = [...playerMap.values()].map((p) => ({
      ...p,
      kd: p.deaths === 0 ? p.kills : Math.round((100 * p.kills) / p.deaths) / 100,
    }));
    const nickCol = { label: "Ник", value: (r) => nickLinkHtml(r.nick) };
    document.getElementById("cw-an-tops").innerHTML = [
      taTopTable(
        "Больше КВ",
        players.slice().sort((a, b) => b.games - a.games || b.kills - a.kills).slice(0, 12),
        [
          nickCol,
          { label: "КВ", cls: "ctr", key: "games" },
          {
            label: "Ранг",
            cls: "ctr",
            value: (r) =>
              `<span class="tier tier-${r.tier || 4}">${escapeHtml(tierLabel(r.tier || 4))}</span>`,
          },
        ]
      ),
      taTopTable(
        "Килы",
        players.slice().sort((a, b) => b.kills - a.kills || b.kd - a.kd).slice(0, 12),
        [
          nickCol,
          { label: "Килы", cls: "ctr", key: "kills" },
          { label: "KD", cls: "ctr", key: "kd" },
        ]
      ),
      taTopTable(
        "KD (мин. 2 КВ)",
        players
          .filter((p) => p.games >= 2 && p.kills + p.deaths > 0)
          .slice()
          .sort((a, b) => b.kd - a.kd || b.kills - a.kills)
          .slice(0, 12),
        [
          nickCol,
          { label: "KD", cls: "ctr", key: "kd" },
          { label: "K/D", cls: "ctr", value: (r) => `${r.kills}/${r.deaths}` },
        ]
      ),
      taTopTable(
        "Боевой счёт",
        players.slice().sort((a, b) => b.dmg - a.dmg || b.kills - a.kills).slice(0, 12),
        [
          nickCol,
          { label: "Счёт", cls: "ctr", key: "dmg" },
          { label: "Килы", cls: "ctr", key: "kills" },
        ]
      ),
      taTopTable(
        "Ресы",
        players.slice().sort((a, b) => b.res - a.res || b.games - a.games).slice(0, 12),
        [
          nickCol,
          { label: "Ресы", cls: "ctr", key: "res" },
          { label: "КВ", cls: "ctr", key: "games" },
        ]
      ),
    ].join("");

    document.getElementById("cw-an-mvp").innerHTML = [
      taTopTable(
        "MVP Medic",
        players
          .filter((p) => p.mvpMedic > 0)
          .sort((a, b) => b.mvpMedic - a.mvpMedic || b.res - a.res)
          .slice(0, 10),
        [
          nickCol,
          { label: "MVP", cls: "ctr col-mvp-medic", key: "mvpMedic" },
          { label: "Ресы", cls: "ctr", key: "res" },
        ]
      ),
      taTopTable(
        "MVP Killer",
        players
          .filter((p) => p.mvpKiller > 0)
          .sort((a, b) => b.mvpKiller - a.mvpKiller || b.kills - a.kills)
          .slice(0, 10),
        [
          nickCol,
          { label: "MVP", cls: "ctr col-mvp-killer", key: "mvpKiller" },
          { label: "Килы", cls: "ctr", key: "kills" },
        ]
      ),
      taTopTable(
        "MVP War-Score",
        players
          .filter((p) => p.mvpDamage > 0)
          .sort((a, b) => b.mvpDamage - a.mvpDamage || b.dmg - a.dmg)
          .slice(0, 10),
        [
          nickCol,
          { label: "MVP", cls: "ctr col-mvp-war", key: "mvpDamage" },
          { label: "Счёт", cls: "ctr", key: "dmg" },
        ]
      ),
      taTopTable(
        "Anti-MVP",
        players
          .filter((p) => p.antiDeath > 0)
          .sort((a, b) => b.antiDeath - a.antiDeath || b.deaths - a.deaths)
          .slice(0, 10),
        [
          nickCol,
          { label: "Anti", cls: "ctr col-mvp-anti", key: "antiDeath" },
          { label: "Смерти", cls: "ctr", key: "deaths" },
        ]
      ),
    ].join("");

    document.getElementById("cw-an-matches").innerHTML = matchRows
      .slice()
      .sort((a, b) => {
        const ak = `${a.m._year}-${a.m._month}-${a.m.day}-${a.m.opp}`;
        const bk = `${b.m._year}-${b.m._month}-${b.m.day}-${b.m.opp}`;
        return ak.localeCompare(bk);
      })
      .map(({ m, nicks: nn, r1, r2, durLabel, factions }) => {
        const st = m.status || "";
        return `<tr class="${st}">
          <td>${pad(m.day)}.${pad(m._month)}.${m._year}</td>
          <td><strong>${escapeHtml(m.opp || "—")}</strong></td>
          <td>${escapeHtml(m.map || "—")}</td>
          <td class="ctr">${escapeHtml(m.stack || "—")}</td>
          <td class="ctr">${escapeHtml(m.meeting || "—")}</td>
          <td class="ctr">${escapeHtml(r1)}</td>
          <td class="ctr">${escapeHtml(r2)}</td>
          <td class="ctr">${escapeHtml(durLabel)}</td>
          <td class="ctr">${nn || "—"}</td>
          <td>${escapeHtml(factions)}</td>
        </tr>`;
      })
      .join("");

    body.hidden = false;
  }

  function parseDurationSec(s) {
    if (!s || typeof s !== "string" || !s.includes(":")) return null;
    const parts = s.split(":").map((x) => Number(x));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  }

  function formatDurationSec(sec) {
    if (sec == null || !Number.isFinite(sec)) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function mapFamilyName(map) {
    const raw = String(map || "");
    const m = raw.match(
      /(?:SEC\s*\d+\s+)?([A-Za-z][A-Za-z0-9]*)/i
    );
    if (!m) return raw || "—";
    const name = m[1];
    const known = {
      goosebay: "GooseBay",
      mutaha: "Mutaha",
      narva: "Narva",
      anvil: "Anvil",
      chora: "Chora",
      harju: "Harju",
      yehorivka: "Yehorivka",
      kohat: "Kohat",
      albasrah: "AlBasrah",
    };
    return known[name.toLowerCase()] || name;
  }

  function ensureTrainAnalyticsFilters() {
    if (trainAnFiltersReady) return;
    const yearSel = document.getElementById("train-an-year");
    const monthSel = document.getElementById("train-an-month");
    const scopeEl = document.getElementById("train-an-scope");
    if (!yearSel || !monthSel || !scopeEl) return;

    const years = [...new Set(trainingCatalog.map((m) => m.year))].sort((a, b) => b - a);
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    const syncMonths = () => {
      const y = Number(yearSel.value);
      const months = trainingCatalog
        .filter((m) => m.year === y)
        .sort((a, b) => b.month - a.month);
      monthSel.innerHTML = months
        .map((m) => `<option value="${m.id}">${MONTH_RU[m.month] || m.month}</option>`)
        .join("");
    };
    const yearWrap = document.getElementById("train-an-year-wrap");
    const monthWrap = document.getElementById("train-an-month-wrap");
    const syncScopeUi = () => {
      const scope = scopeEl.value;
      if (yearWrap) yearWrap.hidden = scope === "all";
      if (monthWrap) monthWrap.hidden = scope !== "month";
    };
    scopeEl.addEventListener("change", () => {
      syncScopeUi();
      if (scopeEl.value === "month") syncMonths();
      loadTrainingAnalytics();
    });
    yearSel.addEventListener("change", () => {
      syncMonths();
      loadTrainingAnalytics();
    });
    monthSel.addEventListener("change", loadTrainingAnalytics);
    if (years.length) {
      yearSel.value = String(years[0]);
      syncMonths();
      scopeEl.value = "all";
      syncScopeUi();
    }
    trainAnFiltersReady = true;
  }

  function selectedTrainingAnalyticsMetas() {
    const scope = document.getElementById("train-an-scope")?.value || "all";
    if (scope === "all") return trainingCatalog.slice();
    const y = Number(document.getElementById("train-an-year")?.value);
    if (scope === "year") return trainingCatalog.filter((m) => m.year === y);
    const id = document.getElementById("train-an-month")?.value;
    const one = trainingCatalog.find((m) => m.id === id);
    return one ? [one] : [];
  }

  function taBars(rows) {
    if (!rows.length) return `<p class="muted">Нет данных</p>`;
    const max = Math.max(...rows.map((r) => r.count), 1);
    return `<ul class="ta-bars">${rows
      .map((r) => {
        const pct = Math.round((100 * r.count) / max);
        const share = r.share != null ? ` · ${r.share}%` : "";
        const extra = r.extra ? ` · ${escapeHtml(r.extra)}` : "";
        return `<li>
          <div class="ta-bar-label">
            <span>${escapeHtml(r.label)}</span>
            <strong>${r.count}${share}${extra}</strong>
          </div>
          <div class="ta-bar-track"><span style="width:${pct}%"></span></div>
        </li>`;
      })
      .join("")}</ul>`;
  }

  function taTopTable(title, rows, cols) {
    if (!rows.length) {
      return `<div class="ta-top-block"><h3>${escapeHtml(title)}</h3><p class="muted">Нет данных</p></div>`;
    }
    const head = cols.map((c) => `<th class="${c.cls || ""}">${escapeHtml(c.label)}</th>`).join("");
    const body = rows
      .map((r) => {
        const tds = cols
          .map((c) => {
            const v = typeof c.value === "function" ? c.value(r) : r[c.key];
            return `<td class="${c.cls || ""}">${v}</td>`;
          })
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");
    return `<div class="ta-top-block">
      <h3>${escapeHtml(title)}</h3>
      <div class="table-scroll"><table class="rating-table ta-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    </div>`;
  }

  function loadTrainingAnalytics() {
    const note = document.getElementById("train-an-note");
    const body = document.getElementById("train-an-body");
    const kpis = document.getElementById("train-an-kpis");
    if (!note || !body || !kpis) return;
    note.textContent = "Считаем аналитику тренировок…";
    body.hidden = true;
    kpis.innerHTML = "";

    const metas = selectedTrainingAnalyticsMetas();
    if (!metas.length) {
      note.textContent = "Нет месяцев тренировок";
      return;
    }

    Promise.all([
      loadRoster(),
      Promise.all(
        metas.map((meta) =>
          fetch(dataUrl(meta.url))
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => (data ? { meta, data } : null))
            .catch(() => null)
        )
      ),
    ])
      .then(([, months]) => {
        const matchList = [];
        (months || []).forEach((bundle) => {
          if (!bundle || !bundle.data) return;
          (bundle.data.matches || []).forEach((m) => {
            if (m.status === "upcoming") return;
            matchList.push({
              ...m,
              _year: bundle.meta.year,
              _month: bundle.meta.month,
              _monthId: bundle.meta.id,
            });
          });
        });
        return Promise.all(
          matchList.map((m) =>
            m.playersUrl
              ? fetch(dataUrl(m.playersUrl))
                  .then((r) => (r.ok ? r.json() : null))
                  .then((pj) => ({ match: m, players: pj }))
                  .catch(() => ({ match: m, players: null }))
              : Promise.resolve({ match: m, players: null })
          )
        );
      })
      .then((bundles) => {
        paintTrainingAnalytics(bundles || []);
      })
      .catch((err) => {
        note.textContent = String(err.message || err);
      });
  }

  function paintTrainingAnalytics(bundles) {
    const note = document.getElementById("train-an-note");
    const body = document.getElementById("train-an-body");
    const kpis = document.getElementById("train-an-kpis");
    if (!note || !body || !kpis) return;

    const matches = bundles.map((b) => b.match);
    if (!matches.length) {
      note.textContent = "В выбранном периоде нет сыгранных тренировок";
      body.hidden = true;
      return;
    }

    const mapCount = new Map();
    const familyCount = new Map();
    const modeCount = new Map();
    const serverCount = new Map();
    const factionStat = new Map();
    const dayStat = new Map();
    const durations = [];
    const rosters = [];
    const playerMap = new Map();
    const uniqueNicks = new Set();
    let totalKills = 0;
    let totalDeaths = 0;
    let totalDmg = 0;
    let totalRes = 0;
    let totalNok = 0;
    let winnerTickets = [];
    let closeGames = 0;
    let blowouts = 0;

    const touchFaction = (code) => {
      const key = String(code || "?").toUpperCase();
      if (!factionStat.has(key)) {
        factionStat.set(key, { code: key, games: 0, wins: 0, ticketsSum: 0, ticketsN: 0 });
      }
      return factionStat.get(key);
    };

    const touchPlayer = (nick) => {
      if (!nick || !inRating(nick)) return null;
      const key = resolveNickKey(nick);
      uniqueNicks.add(key);
      if (!playerMap.has(key)) {
        playerMap.set(key, {
          nick: displayNick(nick),
          tier: tierOf(nick),
          games: 0,
          wins: 0,
          kills: 0,
          deaths: 0,
          dmg: 0,
          res: 0,
          nok: 0,
          mvpMedic: 0,
          mvpKiller: 0,
          mvpDamage: 0,
          antiDeath: 0,
        });
      }
      return playerMap.get(key);
    };

    bundles.forEach(({ match: m, players }) => {
      const map = m.map || "—";
      mapCount.set(map, (mapCount.get(map) || 0) + 1);
      const fam = mapFamilyName(map);
      familyCount.set(fam, (familyCount.get(fam) || 0) + 1);
      const mode = m.mode || "—";
      modeCount.set(mode, (modeCount.get(mode) || 0) + 1);
      const server = m.server || "—";
      serverCount.set(server, (serverCount.get(server) || 0) + 1);

      const dayKey = `${m._year}-${String(m._month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}`;
      if (!dayStat.has(dayKey)) {
        dayStat.set(dayKey, {
          key: dayKey,
          label: `${pad(m.day)}.${pad(m._month)}.${m._year}`,
          matches: 0,
          maps: [],
          players: new Set(),
          rosterSum: 0,
          durationSum: 0,
          durationN: 0,
        });
      }
      const day = dayStat.get(dayKey);
      day.matches += 1;
      day.maps.push(mapFamilyName(map));

      const dur = parseDurationSec(m.duration);
      if (dur != null) {
        durations.push(dur);
        day.durationSum += dur;
        day.durationN += 1;
      }

      const fa = touchFaction(m.factionA);
      const fb = touchFaction(m.factionB);
      fa.games += 1;
      fb.games += 1;
      if (m.ticketsA != null && Number.isFinite(Number(m.ticketsA))) {
        fa.ticketsSum += Number(m.ticketsA);
        fa.ticketsN += 1;
      }
      if (m.ticketsB != null && Number.isFinite(Number(m.ticketsB))) {
        fb.ticketsSum += Number(m.ticketsB);
        fb.ticketsN += 1;
      }
      const win = String(m.winner || "").toUpperCase();
      if (win && factionStat.has(win)) factionStat.get(win).wins += 1;

      const tA = Number(m.ticketsA);
      const tB = Number(m.ticketsB);
      if (Number.isFinite(tA) && Number.isFinite(tB)) {
        const wTickets = win === String(m.factionA).toUpperCase() ? tA : win === String(m.factionB).toUpperCase() ? tB : Math.max(tA, tB);
        const lTickets = win === String(m.factionA).toUpperCase() ? tB : win === String(m.factionB).toUpperCase() ? tA : Math.min(tA, tB);
        winnerTickets.push(wTickets);
        const margin = Math.abs(tA - tB);
        if (lTickets === 0 && wTickets >= 80) blowouts += 1;
        else if (margin <= 40) closeGames += 1;
      }

      let roster = 0;
      if (players) {
        const list =
          players.players && players.players.length
            ? players.players
            : [].concat(players.teamA || [], players.teamB || []);
        const seen = new Set();
        list.forEach((p) => {
          if (!p || !p.nick) return;
          roster += 1;
          const row = touchPlayer(p.nick);
          if (!row) return;
          const key = resolveNickKey(p.nick);
          day.players.add(key);
          row.kills += Number(p.kills) || 0;
          row.deaths += Number(p.deaths) || 0;
          row.dmg += Number(p.dmg) || 0;
          row.res += Number(p.res) || 0;
          row.nok += Number(p.nok) || 0;
          totalKills += Number(p.kills) || 0;
          totalDeaths += Number(p.deaths) || 0;
          totalDmg += Number(p.dmg) || 0;
          totalRes += Number(p.res) || 0;
          totalNok += Number(p.nok) || 0;
          if (seen.has(key)) return;
          seen.add(key);
          row.games += 1;
          if (
            p.won === true ||
            (m.winner &&
              p.team &&
              String(p.team).toUpperCase() === String(m.winner).toUpperCase())
          ) {
            row.wins += 1;
          }
        });
        const mvp =
          (players.mvp && players.mvp.train) || pickMvps(enrichRows(list.filter((p) => p && p.nick && inRating(p.nick))));
        const bumpMvp = (nicks, field) => {
          (nicks || []).forEach((n) => {
            const row = touchPlayer(n);
            if (row) row[field] += 1;
          });
        };
        bumpMvp(mvp.medic, "mvpMedic");
        bumpMvp(mvp.killer, "mvpKiller");
        bumpMvp(mvp.damage, "mvpDamage");
        bumpMvp(mvp.antiDeath, "antiDeath");
      }
      if (roster > 0) {
        rosters.push(roster);
        day.rosterSum += roster;
      }
    });

    const n = matches.length;
    const avgDur = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    const avgRoster = rosters.length
      ? Math.round(rosters.reduce((a, b) => a + b, 0) / rosters.length)
      : null;
    const avgWinTickets = winnerTickets.length
      ? Math.round(
          winnerTickets.reduce((a, b) => a + b, 0) / winnerTickets.length
        )
      : null;

    const scope = document.getElementById("train-an-scope")?.value || "all";
    const scopeRu =
      scope === "all" ? "за всё время" : scope === "year" ? "за год" : "за месяц";
    note.textContent = `Период: ${scopeRu}. Матчей: ${n}. Уникальных игроков: ${uniqueNicks.size}.`;

    kpis.innerHTML = [
      ["Матчей", String(n)],
      ["Дней", String(dayStat.size)],
      ["Игроков", String(uniqueNicks.size)],
      ["Ср. состав", avgRoster != null ? String(avgRoster) : "—"],
      ["Ср. длит.", avgDur != null ? formatDurationSec(avgDur) : "—"],
      ["Килы ∑", String(totalKills)],
      ["Смерти ∑", String(totalDeaths)],
      ["Боевой ∑", String(totalDmg)],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
      )
      .join("");

    const toRanked = (mapObj) => {
      const arr = [...mapObj.entries()]
        .map(([label, count]) => ({
          label,
          count,
          share: Math.round((1000 * count) / n) / 10,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
      return arr;
    };

    document.getElementById("train-an-maps").innerHTML = `
      <h3 class="ta-subh">Семейства карт</h3>
      ${taBars(toRanked(familyCount))}
      <h3 class="ta-subh">Точные слои</h3>
      ${taBars(toRanked(mapCount))}
    `;

    document.getElementById("train-an-modes").innerHTML = `
      <h3 class="ta-subh">Режимы</h3>
      ${taBars(toRanked(modeCount))}
      <h3 class="ta-subh">Серверы</h3>
      ${taBars(toRanked(serverCount))}
    `;

    const factionRows = [...factionStat.values()]
      .map((f) => ({
        ...f,
        winPct: f.games ? Math.round((1000 * f.wins) / f.games) / 10 : null,
        avgTickets: f.ticketsN
          ? Math.round(f.ticketsSum / f.ticketsN)
          : null,
      }))
      .sort(
        (a, b) =>
          b.games - a.games ||
          (b.winPct || 0) - (a.winPct || 0) ||
          a.code.localeCompare(b.code)
      );
    document.getElementById("train-an-factions").innerHTML = factionRows
      .map(
        (f) => `<tr>
        <td title="${escapeHtml(factionTitle(f.code))}"><strong>${escapeHtml(f.code)}</strong> <span class="muted">${escapeHtml(factionShort(f.code))}</span></td>
        <td class="ctr">${f.games}</td>
        <td class="ctr">${f.wins}</td>
        <td class="ctr">${f.winPct != null ? f.winPct + "%" : "—"}</td>
        <td class="ctr">${f.avgTickets != null ? f.avgTickets : "—"}</td>
      </tr>`
      )
      .join("");

    const minDur = durations.length ? Math.min(...durations) : null;
    const maxDur = durations.length ? Math.max(...durations) : null;
    const shortest = matches
      .map((m) => ({ m, sec: parseDurationSec(m.duration) }))
      .filter((x) => x.sec != null)
      .sort((a, b) => a.sec - b.sec)[0];
    const longest = matches
      .map((m) => ({ m, sec: parseDurationSec(m.duration) }))
      .filter((x) => x.sec != null)
      .sort((a, b) => b.sec - a.sec)[0];

    document.getElementById("train-an-pace").innerHTML = `
      <ul class="ta-facts">
        <li><span>Средняя длительность</span><strong>${avgDur != null ? formatDurationSec(avgDur) : "—"}</strong></li>
        <li><span>Самая короткая</span><strong>${
          shortest
            ? `${formatDurationSec(shortest.sec)} · ${escapeHtml(mapFamilyName(shortest.m.map))} (${pad(shortest.m.day)}.${pad(shortest.m._month)})`
            : "—"
        }</strong></li>
        <li><span>Самая длинная</span><strong>${
          longest
            ? `${formatDurationSec(longest.sec)} · ${escapeHtml(mapFamilyName(longest.m.map))} (${pad(longest.m.day)}.${pad(longest.m._month)})`
            : "—"
        }</strong></li>
        <li><span>Диапазон</span><strong>${
          minDur != null ? `${formatDurationSec(minDur)} – ${formatDurationSec(maxDur)}` : "—"
        }</strong></li>
        <li><span>Ср. тикеты победителя</span><strong>${avgWinTickets != null ? avgWinTickets : "—"}</strong></li>
        <li><span>Близкие катки (Δ≤40)</span><strong>${closeGames} / ${n}</strong></li>
        <li><span>Разгромы (проигравший 0, победитель ≥80)</span><strong>${blowouts} / ${n}</strong></li>
      </ul>
    `;

    const minR = rosters.length ? Math.min(...rosters) : null;
    const maxR = rosters.length ? Math.max(...rosters) : null;
    document.getElementById("train-an-attendance").innerHTML = `
      <ul class="ta-facts">
        <li><span>Уникальных ников</span><strong>${uniqueNicks.size}</strong></li>
        <li><span>Средний состав на катку</span><strong>${avgRoster != null ? avgRoster : "—"}</strong></li>
        <li><span>Мин / макс состав</span><strong>${
          minR != null ? `${minR} / ${maxR}` : "—"
        }</strong></li>
        <li><span>Сумма ресов / ноков</span><strong>${totalRes} / ${totalNok}</strong></li>
        <li><span>KD периода (суммы)</span><strong>${
          totalDeaths === 0
            ? totalKills
            : Math.round((100 * totalKills) / totalDeaths) / 100
        }</strong></li>
      </ul>
      <h3 class="ta-subh">Состав по каткам</h3>
      ${taBars(
        bundles
          .map(({ match: m, players }) => {
            const list = players
              ? players.players && players.players.length
                ? players.players
                : [].concat(players.teamA || [], players.teamB || [])
              : [];
            return {
              label: `${pad(m.day)}.${pad(m._month)} · ${mapFamilyName(m.map)}`,
              count: list.length,
              extra: m.duration || "",
            };
          })
          .filter((r) => r.count > 0)
          .sort((a, b) => b.count - a.count)
      )}
    `;

    const tierCount = new Map();
    playerMap.forEach((p) => {
      const t = p.tier || 4;
      tierCount.set(t, (tierCount.get(t) || 0) + 1);
    });
    const tierRows = [1, 2, 3, 4].map((t) => ({
      label: tierLabel(t),
      count: tierCount.get(t) || 0,
      share: uniqueNicks.size
        ? Math.round((1000 * (tierCount.get(t) || 0)) / uniqueNicks.size) / 10
        : 0,
    }));
    document.getElementById("train-an-tiers").innerHTML = taBars(tierRows);

    document.getElementById("train-an-calendar").innerHTML = [...dayStat.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((d) => {
        const avgR = d.matches ? Math.round(d.rosterSum / d.matches) : null;
        const avgD =
          d.durationN > 0 ? formatDurationSec(d.durationSum / d.durationN) : "—";
        const maps = [...new Set(d.maps)].join(", ");
        return `<tr>
          <td>${escapeHtml(d.label)}</td>
          <td class="ctr">${d.matches}</td>
          <td>${escapeHtml(maps)}</td>
          <td class="ctr">${d.players.size}</td>
          <td class="ctr">${avgR != null ? avgR : "—"}</td>
          <td class="ctr">${avgD}</td>
        </tr>`;
      })
      .join("");

    const players = [...playerMap.values()].map((p) => ({
      ...p,
      kd: p.deaths === 0 ? p.kills : Math.round((100 * p.kills) / p.deaths) / 100,
      winPct: p.games ? Math.round((1000 * p.wins) / p.games) / 10 : null,
    }));

    const topGames = players.slice().sort((a, b) => b.games - a.games || b.kills - a.kills).slice(0, 12);
    const topKills = players.slice().sort((a, b) => b.kills - a.kills || b.kd - a.kd).slice(0, 12);
    const topKd = players
      .filter((p) => p.games >= 2 && p.deaths + p.kills > 0)
      .slice()
      .sort((a, b) => b.kd - a.kd || b.kills - a.kills)
      .slice(0, 12);
    const topDmg = players.slice().sort((a, b) => b.dmg - a.dmg || b.kills - a.kills).slice(0, 12);
    const topWin = players
      .filter((p) => p.games >= 2)
      .slice()
      .sort((a, b) => (b.winPct || 0) - (a.winPct || 0) || b.games - a.games)
      .slice(0, 12);

    const nickCol = {
      label: "Ник",
      value: (r) => nickLinkHtml(r.nick),
    };
    document.getElementById("train-an-tops").innerHTML = [
      taTopTable("Больше каток", topGames, [
        nickCol,
        { label: "Каток", cls: "ctr", key: "games" },
        { label: "W%", cls: "ctr", value: (r) => (r.winPct != null ? r.winPct + "%" : "—") },
      ]),
      taTopTable("Килы", topKills, [
        nickCol,
        { label: "Килы", cls: "ctr", key: "kills" },
        { label: "KD", cls: "ctr", key: "kd" },
      ]),
      taTopTable("KD (мин. 2 катки)", topKd, [
        nickCol,
        { label: "KD", cls: "ctr", key: "kd" },
        { label: "K/D", cls: "ctr", value: (r) => `${r.kills}/${r.deaths}` },
      ]),
      taTopTable("Боевой счёт", topDmg, [
        nickCol,
        { label: "Счёт", cls: "ctr", key: "dmg" },
        { label: "Килы", cls: "ctr", key: "kills" },
      ]),
      taTopTable("% побед (мин. 2)", topWin, [
        nickCol,
        { label: "W%", cls: "ctr", value: (r) => (r.winPct != null ? r.winPct + "%" : "—") },
        { label: "Каток", cls: "ctr", key: "games" },
      ]),
    ].join("");

    const topMedic = players.slice().sort((a, b) => b.mvpMedic - a.mvpMedic || b.res - a.res).filter((p) => p.mvpMedic > 0).slice(0, 10);
    const topKiller = players.slice().sort((a, b) => b.mvpKiller - a.mvpKiller || b.kills - a.kills).filter((p) => p.mvpKiller > 0).slice(0, 10);
    const topWar = players.slice().sort((a, b) => b.mvpDamage - a.mvpDamage || b.dmg - a.dmg).filter((p) => p.mvpDamage > 0).slice(0, 10);
    const topAnti = players.slice().sort((a, b) => b.antiDeath - a.antiDeath || b.deaths - a.deaths).filter((p) => p.antiDeath > 0).slice(0, 10);

    document.getElementById("train-an-mvp").innerHTML = [
      taTopTable("MVP Medic", topMedic, [
        nickCol,
        { label: "MVP", cls: "ctr col-mvp-medic", key: "mvpMedic" },
        { label: "Ресы", cls: "ctr", key: "res" },
      ]),
      taTopTable("MVP Killer", topKiller, [
        nickCol,
        { label: "MVP", cls: "ctr col-mvp-killer", key: "mvpKiller" },
        { label: "Килы", cls: "ctr", key: "kills" },
      ]),
      taTopTable("MVP War-Score", topWar, [
        nickCol,
        { label: "MVP", cls: "ctr col-mvp-war", key: "mvpDamage" },
        { label: "Счёт", cls: "ctr", key: "dmg" },
      ]),
      taTopTable("Anti-MVP", topAnti, [
        nickCol,
        { label: "Anti", cls: "ctr col-mvp-anti", key: "antiDeath" },
        { label: "Смерти", cls: "ctr", key: "deaths" },
      ]),
    ].join("");

    document.getElementById("train-an-matches").innerHTML = bundles
      .slice()
      .sort((a, b) => {
        const ak = `${a.match._year}-${a.match._month}-${a.match.day}-${a.match.id}`;
        const bk = `${b.match._year}-${b.match._month}-${b.match.day}-${b.match.id}`;
        return ak.localeCompare(bk);
      })
      .map(({ match: m, players }) => {
        const list = players
          ? players.players && players.players.length
            ? players.players
            : [].concat(players.teamA || [], players.teamB || [])
          : [];
        return `<tr>
          <td>${pad(m.day)}.${pad(m._month)}.${m._year}</td>
          <td>${escapeHtml(m.map || "—")}</td>
          <td>${escapeHtml(m.mode || "—")}</td>
          <td class="ctr">${escapeHtml(m.duration || "—")}</td>
          <td class="ctr">${list.length || "—"}</td>
          <td>${escapeHtml(factionShort(m.factionA))} ${m.ticketsA ?? "—"} : ${m.ticketsB ?? "—"} ${escapeHtml(factionShort(m.factionB))}</td>
          <td>${m.winner ? escapeHtml(factionShort(m.winner)) : "—"}</td>
        </tr>`;
      })
      .join("");

    body.hidden = false;
  }


  /* ——— match modal (player stats) ——— */
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    modalMatch = null;
    modalPlayers = null;
    resetModalTabAttrs();
    modalTabs.querySelector('[data-tab="total"]').textContent = "Итого";
    const tabs = modalTabs.querySelectorAll(".tab");
    if (tabs[1]) tabs[1].textContent = "Раунд 1";
    if (tabs[2]) tabs[2].textContent = "Раунд 2";
  }

  function openMatch(m) {
    modalMatch = m;
    modalTab = "total";
    sortKey = "kills";
    sortDir = "desc";
    const isTrain = m._kind === "training";
    if (isTrain) {
      modalTitle.textContent = `${pad(m.day)}.${trainMonthKey || monthKey} · ${m.map || "тренировка"}`;
      modalSub.textContent = [
        factionTitle(m.factionA) + ` ${m.ticketsA ?? "—"}`,
        factionTitle(m.factionB) + ` ${m.ticketsB ?? "—"}`,
        m.winner ? `победа ${factionShort(m.winner)}` : null,
        m.duration ? `время ${m.duration}` : null,
        m.server,
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      modalTitle.textContent = `${pad(m.day)}.${monthKey} vs ${m.opp || "—"}`;
      modalSub.textContent = [
        m.map,
        m.size,
        m.stack,
        m.meeting && m.meeting !== "—" ? `счёт ${m.meeting}` : null,
        STATUS_RU[m.status] || m.status,
      ]
        .filter(Boolean)
        .join(" · ");
    }

    modalBody.innerHTML = `<p class="modal-loading">Загрузка…</p>`;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modalTabs.hidden = true;

    if (m.status === "upcoming" && !m.playersUrl) {
      modalBody.innerHTML = `<p class="modal-empty">Катка ещё не сыграна — статистики нет.</p>`;
      return;
    }

    if (m.playersUrl) {
      fetch(dataUrl(m.playersUrl))
        .then((r) => {
          if (!r.ok) throw new Error("Нет файла статистики");
          return r.json();
        })
        .then((data) => {
          if (isTrain) {
            const teamA = enrichRows(data.teamA || []);
            const teamB = enrichRows(data.teamB || []);
            const all = enrichRows(
              data.players && data.players.length
                ? data.players
                : teamA.concat(teamB)
            );
            modalPlayers = {
              total: all,
              teamA,
              teamB,
              r1: [],
              r2: [],
              details: data.details || null,
              mvpByRound: {
                r1: pickMvps(all),
                r2: { medic: [], killer: [], damage: [], antiDeath: [] },
              },
              _training: true,
              _factionA: m.factionA || data.sideA?.name || "A",
              _factionB: m.factionB || data.sideB?.name || "B",
            };
            labelTrainTabs(m);
          } else {
            const r1 = enrichRows(data.r1 || []);
            const r2 = enrichRows(data.r2 || []);
            modalPlayers = {
              total: enrichRows(data.total || data.players || sumRounds(r1, r2)),
              r1,
              r2,
              details: data.details || null,
              mvpByRound: {
                r1: (data.mvp && data.mvp.r1) || pickMvps(r1),
                r2: (data.mvp && data.mvp.r2) || pickMvps(r2),
              },
            };
            labelTabs(m);
            resetModalTabAttrs();
          }
          paintPlayers();
        })
        .catch((err) => {
          console.error("players load failed", m.playersUrl, err);
          modalBody.innerHTML =
            `<p class="modal-empty">Не удалось загрузить статистику.<br>` +
            `Обнови страницу (Ctrl+F5) и открой катку ещё раз.</p>`;
        });
      return;
    }

    modalBody.innerHTML =
      `<p class="modal-empty">Статистика игроков ещё не внесена.<br>` +
      `Ресы / ноки / килы / смерти / боевой счёт — со скринов табло.</p>`;
  }

  function labelTrainTabs(m) {
    const a = factionShort(m.factionA);
    const b = factionShort(m.factionB);
    modalTabs.querySelector('[data-tab="total"]').textContent = "Все";
    modalTabs.querySelector('[data-tab="r1"]').textContent =
      `${a} · ${m.ticketsA ?? "—"}`;
    modalTabs.querySelector('[data-tab="r2"]').textContent =
      `${b} · ${m.ticketsB ?? "—"}`;
    modalTabs.querySelector('[data-tab="r1"]').dataset.tab = "teamA";
    modalTabs.querySelector('[data-tab="r2"]').dataset.tab = "teamB";
  }

  function resetModalTabAttrs() {
    const t1 = modalTabs.querySelectorAll(".tab")[1];
    const t2 = modalTabs.querySelectorAll(".tab")[2];
    if (t1) t1.dataset.tab = "r1";
    if (t2) t2.dataset.tab = "r2";
  }

  function enrichRows(rows) {
    return (rows || []).map((p) => {
      const kills = Number(p.kills) || 0;
      const deaths = Number(p.deaths) || 0;
      return {
        ...p,
        res: Number(p.res) || 0,
        nok: Number(p.nok) || 0,
        kills,
        deaths,
        dmg: Number(p.dmg) || 0,
        kd: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100,
      };
    });
  }

  function sumRounds(r1, r2) {
    const map = new Map();
    const add = (row) => {
      if (!row || !row.nick) return;
      const cur = map.get(row.nick) || { nick: row.nick, res: 0, nok: 0, kills: 0, deaths: 0, dmg: 0 };
      cur.res += Number(row.res) || 0;
      cur.nok += Number(row.nok) || 0;
      cur.kills += Number(row.kills) || 0;
      cur.deaths += Number(row.deaths) || 0;
      cur.dmg += Number(row.dmg) || 0;
      map.set(row.nick, cur);
    };
    (r1 || []).forEach(add);
    (r2 || []).forEach(add);
    return Array.from(map.values());
  }

  function labelTabs(m) {
    const r1Label = m.r1 && m.r1 !== "—" ? `Раунд 1 · ${m.r1}` : "Раунд 1";
    const r2Label = m.r2 && m.r2 !== "—" ? `Раунд 2 · ${m.r2}` : "Раунд 2";
    modalTabs.querySelector('[data-tab="total"]').textContent = "Итого";
    modalTabs.querySelector('[data-tab="r1"]').textContent = r1Label;
    modalTabs.querySelector('[data-tab="r2"]').textContent = r2Label;
  }

  function maxOf(rows, key) {
    return rows.reduce((m, p) => Math.max(m, Number(p[key]) || 0), 0);
  }

  function kdOf(p) {
    const kills = Number(p.kills) || 0;
    const deaths = Number(p.deaths) || 0;
    return deaths === 0 ? kills : kills / deaths;
  }

  function pickMvps(rows) {
    if (!rows || !rows.length) return { medic: [], killer: [], damage: [], antiDeath: [] };
    const pool = rows.filter(
      (p) => (Number(p.res) || 0) + (Number(p.nok) || 0) + (Number(p.kills) || 0) + (Number(p.deaths) || 0) > 0
    );
    if (!pool.length) return { medic: [], killer: [], damage: [], antiDeath: [] };
    function nickCmp(a, b) {
      return String(a.nick || "").localeCompare(String(b.nick || ""), "ru", { sensitivity: "base" });
    }
    function pickMedic() {
      const top = maxOf(pool, "res");
      if (top <= 0) return null;
      const tied = pool.filter((p) => (Number(p.res) || 0) === top);
      tied.sort((a, b) => {
        const ad = Number(a.dmg) || 0;
        const bd = Number(b.dmg) || 0;
        if (ad !== bd) return bd - ad;
        return nickCmp(a, b);
      });
      return tied[0].nick;
    }
    function pickKiller() {
      const top = maxOf(pool, "kills");
      if (top <= 0) return null;
      const tied = pool.filter((p) => (Number(p.kills) || 0) === top);
      tied.sort((a, b) => {
        const an = Number(a.nok) || 0;
        const bn = Number(b.nok) || 0;
        if (an !== bn) return bn - an;
        const ak = kdOf(a);
        const bk = kdOf(b);
        if (ak !== bk) return bk - ak;
        const ad = Number(a.dmg) || 0;
        const bd = Number(b.dmg) || 0;
        if (ad !== bd) return bd - ad;
        return nickCmp(a, b);
      });
      return tied[0].nick;
    }
    function pickDamage() {
      const top = maxOf(pool, "dmg");
      if (top <= 0) return null;
      const tied = pool.filter((p) => (Number(p.dmg) || 0) === top);
      tied.sort((a, b) => {
        const ak = kdOf(a);
        const bk = kdOf(b);
        if (ak !== bk) return bk - ak;
        return nickCmp(a, b);
      });
      return tied[0].nick;
    }
    function pickAnti() {
      const top = maxOf(pool, "deaths");
      if (top <= 0) return null;
      const tied = pool.filter((p) => (Number(p.deaths) || 0) === top);
      tied.sort((a, b) => {
        const ak = kdOf(a);
        const bk = kdOf(b);
        if (ak !== bk) return ak - bk;
        const ad = Number(a.dmg) || 0;
        const bd = Number(b.dmg) || 0;
        if (ad !== bd) return ad - bd;
        return nickCmp(a, b);
      });
      return tied[0].nick;
    }
    return {
      medic: [pickMedic()].filter(Boolean),
      killer: [pickKiller()].filter(Boolean),
      damage: [pickDamage()].filter(Boolean),
      antiDeath: [pickAnti()].filter(Boolean),
    };
  }

  function medalCountsForNick(nick) {
    const counts = { medic: 0, killer: 0, damage: 0, antiDeath: 0 };
    const by = modalPlayers.mvpByRound || {};
    const keys =
      modalPlayers && modalPlayers._training ? ["r1"] : ["r1", "r2"];
    keys.forEach((rk) => {
      const m = by[rk];
      if (!m) return;
      Object.keys(counts).forEach((kind) => {
        if ((m[kind] || []).includes(nick)) counts[kind] += 1;
      });
    });
    return counts;
  }

  function roundMvpsForNick(nick) {
    if (modalPlayers && modalPlayers._training) {
      const m = (modalPlayers.mvpByRound || {}).r1;
      if (!m) return { medic: 0, killer: 0, damage: 0, antiDeath: 0 };
      return {
        medic: (m.medic || []).includes(nick) ? 1 : 0,
        killer: (m.killer || []).includes(nick) ? 1 : 0,
        damage: (m.damage || []).includes(nick) ? 1 : 0,
        antiDeath: (m.antiDeath || []).includes(nick) ? 1 : 0,
      };
    }
    const key = modalTab === "r1" || modalTab === "teamA" ? "r1" : "r2";
    const m = (modalPlayers.mvpByRound || {})[key];
    if (!m) return { medic: 0, killer: 0, damage: 0, antiDeath: 0 };
    return {
      medic: (m.medic || []).includes(nick) ? 1 : 0,
      killer: (m.killer || []).includes(nick) ? 1 : 0,
      damage: (m.damage || []).includes(nick) ? 1 : 0,
      antiDeath: (m.antiDeath || []).includes(nick) ? 1 : 0,
    };
  }

  function renderMedals(nick) {
    const counts = modalTab === "total" ? medalCountsForNick(nick) : roundMvpsForNick(nick);
    const parts = [];
    const kindClass = { medic: "medic", killer: "killer", damage: "war", antiDeath: "anti" };
    ["medic", "killer", "damage", "antiDeath"].forEach((kind) => {
      const n = counts[kind];
      if (!n) return;
      const cls = `mvp-badge ${kindClass[kind]}`;
      const label = n > 1 ? `×${n} ${MVP_LABEL[kind]}` : MVP_LABEL[kind];
      parts.push(
        `<span class="${cls}" title="${escapeHtml(label)}">` +
          `<img src="${MVP_ICONS[kind]}" alt="" width="14" height="14" />` +
          `<span>${escapeHtml(label)}</span></span>`
      );
    });
    return parts.length ? `<span class="mvp-row">${parts.join("")}</span>` : "";
  }

  function currentRows() {
    if (modalPlayers && modalPlayers._training) {
      if (modalTab === "teamA" || modalTab === "r1") return modalPlayers.teamA || [];
      if (modalTab === "teamB" || modalTab === "r2") return modalPlayers.teamB || [];
      return modalPlayers.total || [];
    }
    if (modalTab === "r1" && modalPlayers.r1) return modalPlayers.r1;
    if (modalTab === "r2" && modalPlayers.r2) return modalPlayers.r2;
    return modalPlayers.total || [];
  }

  function kdValue(p) {
    if (p.kd != null) return p.kd;
    const d = Number(p.deaths) || 0;
    const k = Number(p.kills) || 0;
    return d === 0 ? k : Math.round((k / d) * 100) / 100;
  }

  function sortRows(rows) {
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      if (sortKey === "nick") return dir * String(a.nick || "").localeCompare(String(b.nick || ""), "ru");
      const av = sortKey === "kd" ? kdValue(a) : Number(a[sortKey]) || 0;
      const bv = sortKey === "kd" ? kdValue(b) : Number(b[sortKey]) || 0;
      if (av !== bv) return dir * (av - bv);
      return String(a.nick || "").localeCompare(String(b.nick || ""), "ru");
    });
  }

  function sortMark(key) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? "▲" : "▼";
  }

  function th(key, label, cls) {
    const active = sortKey === key;
    const aria = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
    const mark = sortMark(key);
    return `<th class="sortable ${cls || ""} ${active ? "is-sorted" : ""}" data-sort="${key}" aria-sort="${aria}" title="Сортировать">${escapeHtml(label)}<span class="sort-ind" aria-hidden="true">${mark}</span></th>`;
  }

  function cellRecord(value, isRecord, anti) {
    const cls = isRecord ? (anti ? "record anti" : "record") : "";
    return `<td class="ctr ${cls}">${num(value)}</td>`;
  }

  function paintPlayers() {
    const isTrain = !!(modalPlayers && modalPlayers._training);
    const hasRounds = isTrain
      ? !!(modalPlayers.teamA && modalPlayers.teamA.length) ||
        !!(modalPlayers.teamB && modalPlayers.teamB.length)
      : !!(modalPlayers.r1 && modalPlayers.r1.length) ||
        !!(modalPlayers.r2 && modalPlayers.r2.length);
    modalTabs.hidden = !hasRounds;
    modalTabs.querySelectorAll(".tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === modalTab);
    });

    const rows = currentRows();
    if (!rows.length) {
      modalBody.innerHTML = `<p class="modal-empty">Нет строк для этой вкладки.</p>`;
      return;
    }

    const sorted = sortRows(rows);
    const foot = totalsRow(sorted);
    const records = {
      res: maxOf(sorted, "res"),
      nok: maxOf(sorted, "nok"),
      kills: maxOf(sorted, "kills"),
      deaths: maxOf(sorted, "deaths"),
      dmg: maxOf(sorted, "dmg"),
      kd: sorted.reduce((m, p) => Math.max(m, kdValue(p)), 0),
    };

    modalBody.innerHTML = `
      ${paintDetails()}
      <div class="players-scroll">
        <table class="players-table">
          <thead>
            <tr>
              <th class="ctr">№</th>
              ${th("nick", "Ник", "")}
              ${th("res", "Ресы", "ctr")}
              ${th("nok", "Ноки", "ctr")}
              ${th("kills", "Килы", "ctr")}
              ${th("deaths", "Смерти", "ctr")}
              ${th("kd", "KD", "ctr")}
              ${th("dmg", "Боевой счёт", "ctr")}
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map((p, i) => {
                const kd = kdValue(p);
                return `<tr>
              <td class="ctr">${i + 1}</td>
              <td><div class="nick-cell">${nickLinkHtml(p.nick || "—")}${renderMedals(p.nick)}</div></td>
              ${cellRecord(p.res, records.res > 0 && p.res === records.res, false)}
              ${cellRecord(p.nok, records.nok > 0 && p.nok === records.nok, false)}
              ${cellRecord(p.kills, records.kills > 0 && p.kills === records.kills, false)}
              ${cellRecord(p.deaths, records.deaths > 0 && p.deaths === records.deaths, true)}
              ${cellRecord(formatKd(kd), records.kd > 0 && kd === records.kd, false)}
              ${cellRecord(p.dmg, records.dmg > 0 && p.dmg === records.dmg, false)}
            </tr>`;
              })
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td>Всего</td>
              <td class="ctr">${num(foot.res)}</td>
              <td class="ctr">${num(foot.nok)}</td>
              <td class="ctr">${num(foot.kills)}</td>
              <td class="ctr">${num(foot.deaths)}</td>
              <td class="ctr">${formatKd(foot.deaths ? Math.round((foot.kills / foot.deaths) * 100) / 100 : foot.kills)}</td>
              <td class="ctr">${num(foot.dmg)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;

    modalBody.querySelectorAll("th.sortable").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.dataset.sort;
        if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else {
          sortKey = key;
          sortDir = key === "nick" ? "asc" : "desc";
        }
        paintPlayers();
      });
    });
  }

  function formatKd(v) {
    if (v == null || v === "") return "—";
    return Number.isInteger(v) ? String(v) : String(v);
  }

  function paintDetails() {
    const m = modalMatch;
    if (!m) return "";
    const d = modalPlayers && modalPlayers.details;
    const isTrain = m._kind === "training" || (modalPlayers && modalPlayers._training);
    const dateStr = isTrain
      ? `${pad(m.day)}.${trainMonthKey}.${m._year || trainMonthMeta?.year || "2026"}`
      : `${pad(m.day)}.${monthKey}.${m._year || currentMonthMeta?.year || "2026"}`;

    if (isTrain) {
      return `
      <div class="match-summary match-summary-slim">
        <div class="match-summary-grid">
          <div class="match-summary-item"><span class="k">Дата</span><span class="v">${escapeHtml(dateStr)}</span></div>
          <div class="match-summary-item"><span class="k">${escapeHtml(factionShort(m.factionA))}</span><span class="v">${m.ticketsA != null ? m.ticketsA : "—"}</span></div>
          <div class="match-summary-item"><span class="k">${escapeHtml(factionShort(m.factionB))}</span><span class="v">${m.ticketsB != null ? m.ticketsB : "—"}</span></div>
          <div class="match-summary-item"><span class="k">Победитель</span><span class="v">${escapeHtml(factionShort(m.winner))}</span></div>
          <div class="match-summary-item"><span class="k">Время</span><span class="v">${escapeHtml(m.duration || "—")}</span></div>
        </div>
      </div>`;
    }

    let tickets = "—";
    let len = "—";
    if (modalTab === "r1") {
      tickets = (d && d.r1 && d.r1.tickets) || m.r1 || "—";
      len = (d && d.r1 && d.r1.len) || "—";
    } else if (modalTab === "r2") {
      tickets = (d && d.r2 && d.r2.tickets) || m.r2 || "—";
      len = (d && d.r2 && d.r2.len) || "—";
    } else {
      const t1 = (d && d.r1 && d.r1.tickets) || m.r1 || "—";
      const t2 = (d && d.r2 && d.r2.tickets) || m.r2 || "—";
      tickets = `${t1} · ${t2}`;
      const l1 = d && d.r1 && d.r1.len;
      const l2 = d && d.r2 && d.r2.len;
      len = l1 || l2 ? [l1, l2].filter(Boolean).join(" · ") : "—";
    }

    return `
      <div class="match-summary match-summary-slim">
        <div class="match-summary-grid">
          <div class="match-summary-item"><span class="k">Дата</span><span class="v">${escapeHtml(dateStr)}</span></div>
          <div class="match-summary-item"><span class="k">Тикеты</span><span class="v">${escapeHtml(tickets)}</span></div>
          <div class="match-summary-item"><span class="k">Время</span><span class="v">${escapeHtml(len)}</span></div>
        </div>
      </div>`;
  }

  function totalsRow(rows) {
    return rows.reduce(
      (a, p) => ({
        res: a.res + (Number(p.res) || 0),
        nok: a.nok + (Number(p.nok) || 0),
        kills: a.kills + (Number(p.kills) || 0),
        deaths: a.deaths + (Number(p.deaths) || 0),
        dmg: a.dmg + (Number(p.dmg) || 0),
      }),
      { res: 0, nok: 0, kills: 0, deaths: 0, dmg: 0 }
    );
  }

  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });
  modalTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn || !modalPlayers) return;
    modalTab = btn.dataset.tab;
    sortKey = "kills";
    sortDir = "desc";
    paintPlayers();
  });

  /* ——— boot ——— */
  Promise.all([
    fetch(dataUrl(INDEX_URL)).then((r) => {
      if (!r.ok) throw new Error("Нет каталога месяцев");
      return r.json();
    }),
    fetch(dataUrl(TIERS_URL))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(dataUrl(TRAINING_INDEX_URL))
      .then((r) => (r.ok ? r.json() : { months: [] }))
      .catch(() => ({ months: [] })),
    fetch(dataUrl(FACTIONS_URL))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ])
    .then(([data, tiers, trainIdx, factions]) => {
      catalog = data.months || [];
      trainingCatalog = (trainIdx && trainIdx.months) || [];
      if (factions && typeof factions === "object") {
        factionLabels = { ...FACTION_FALLBACK, ...factions };
      }
      tiersData = tiers;
      tierByNick = buildTierIndex(tiers);
      fillYearMonthSelects();
      wireMatchSort();
      paintMonthChips();
      loadSelectedMonth();
      applyHash();
    })
    .catch((err) => {
      document.getElementById("note").textContent = String(err.message || err);
      applyHash();
    });
})();
