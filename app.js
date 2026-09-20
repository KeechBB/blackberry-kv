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
  const DATA_VER = "20260921-tm-section";
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
  let ratingRows = [];
  let ratingSortKey = "kv";
  let ratingSortDir = "desc";
  let trainRatingRows = [];
  let trainRatingSortKey = "games";
  let trainRatingSortDir = "desc";
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
    const clean = profileNick(nick);
    if (!clean || clean === "—") return null;
    return `${PROFILE_BASE}/${encodeURIComponent(clean)}`;
  }

  function nickLinkHtml(nick) {
    const label = nick || "—";
    const href = profileHref(nick);
    if (!href) return escapeHtml(label);
    return `<a class="nick-profile-link" href="${escapeHtml(href)}" target="_top" rel="noopener">${escapeHtml(label)}</a>`;
  }

  function inRating(nick) {
    return Boolean(nick) && !RATING_EXCLUDE.has(nickKey(nick));
  }

  function buildTierIndex(data) {
    const map = new Map();
    if (!data) return map;
    const aliases = data.aliases || {};
    Object.keys(aliases).forEach((k) => {
      /* alias keys already lower */
    });
    [
      [1, data.tier1 || []],
      [2, data.tier2 || []],
      [3, data.tier3 || []],
    ].forEach(([tier, list]) => {
      list.forEach((n) => map.set(nickKey(n), tier));
    });
    Object.entries(aliases).forEach(([alias, canon]) => {
      const t = map.get(nickKey(canon));
      if (t) map.set(nickKey(alias), t);
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
    return map;
  }

  function tierOf(nick) {
    return tierByNick.get(nickKey(nick)) || 4;
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
    document.querySelectorAll("#view-cw .subnav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cw === panel);
    });
    if (panel === "rating") loadRating();
  }

  function showTmPanel(panel) {
    const matches = document.getElementById("tm-matches");
    const rating = document.getElementById("tm-rating");
    if (matches) matches.hidden = panel !== "matches";
    if (rating) rating.hidden = panel !== "rating";
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
      history.replaceState(
        null,
        "",
        btn.dataset.cw === "rating" ? "#/cw/rating" : "#/cw"
      );
    });
  });
  document.querySelectorAll("#view-tm .subnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showTmPanel(btn.dataset.tm);
      history.replaceState(
        null,
        "",
        btn.dataset.tm === "rating" ? "#/tm/rating" : "#/tm"
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
      showTmPanel(h.includes("rating") ? "rating" : "matches");
    } else if (h.startsWith("#/cw")) {
      showView("cw");
      showCwPanel(h.includes("rating") ? "rating" : "matches");
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
    fetch(dataUrl(meta.url))
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
            if (m.status !== "upcoming" && m.playersUrl) matchList.push(m);
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
          if (!map.has(nick)) {
            const ro = rosterOf(nick);
            map.set(nick, {
              nick,
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
          return map.get(nick);
        };

        bundles.forEach(({ players }) => {
          if (!players) return;
          const r1 = players.r1 || [];
          const r2 = players.r2 || [];
          const total = players.total || players.players || sumRounds(r1, r2);
          const inMeeting = new Set();

          total.forEach((p) => {
            if (!p || !p.nick || !inRating(p.nick)) return;
            inMeeting.add(p.nick);
            const row = touch(p.nick);
            row.res += Number(p.res) || 0;
            row.nok += Number(p.nok) || 0;
            row.kills += Number(p.kills) || 0;
            row.deaths += Number(p.deaths) || 0;
            row.dmg += Number(p.dmg) || 0;
          });
          [...r1, ...r2].forEach((p) => {
            if (p && p.nick && inRating(p.nick)) inMeeting.add(p.nick);
          });
          inMeeting.forEach((nick) => {
            const row = touch(nick);
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
            key === "nick" || key === "clan" || key === "regNo" ? "asc" : "desc";
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
            if (m.status !== "upcoming" && m.playersUrl) matchList.push(m);
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
          if (!map.has(nick)) {
            const ro = rosterOf(nick);
            map.set(nick, {
              nick,
              clan: ro.clan,
              regNo: ro.regNo,
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
          return map.get(nick);
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
            if (seen.has(p.nick)) return;
            seen.add(p.nick);
            row.games += 1;
            const won =
              p.won === true ||
              (match.winner &&
                p.team &&
                String(p.team).toUpperCase() === String(match.winner).toUpperCase());
            if (won) row.wins += 1;
          });

          /* MVP только для рейтинга тренировок — в mvp-ledger / профиль КВ не пишем */
          const mvp =
            (players.mvp && players.mvp.train) ||
            pickMvps(enrichRows(list.filter((p) => p && p.nick && inRating(p.nick))));
          (mvp.medic || []).forEach((n) => {
            const row = touch(n);
            if (row) row.mvpMedic += 1;
          });
          (mvp.killer || []).forEach((n) => {
            const row = touch(n);
            if (row) row.mvpKiller += 1;
          });
          (mvp.damage || []).forEach((n) => {
            const row = touch(n);
            if (row) row.mvpDamage += 1;
          });
          (mvp.antiDeath || []).forEach((n) => {
            const row = touch(n);
            if (row) row.antiDeath += 1;
          });
        });

        trainRatingRows = Array.from(map.values()).map((p) => ({
          ...p,
          kd: p.deaths === 0 ? p.kills : Math.round((p.kills / p.deaths) * 100) / 100,
          winPct:
            p.games > 0 ? Math.round((1000 * p.wins) / p.games) / 10 : null,
        }));
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
      const av = Number(a[trainRatingSortKey]) || 0;
      const bv = Number(b[trainRatingSortKey]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });

    paintTrainingRatingSortMarks();
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
        <td class="ctr">${p.games}</td>
        <td class="ctr">${p.winPct != null ? `${p.winPct}%` : "—"}</td>
        <td class="ctr">${p.res}</td>
        <td class="ctr">${p.nok}</td>
        <td class="ctr">${p.kills}</td>
        <td class="ctr">${p.deaths}</td>
        <td class="ctr">${p.kd}</td>
        <td class="ctr">${p.dmg}</td>
        <td class="ctr col-mvp-medic">${p.mvpMedic || 0}</td>
        <td class="ctr col-mvp-killer">${p.mvpKiller || 0}</td>
        <td class="ctr col-mvp-war">${p.mvpDamage || 0}</td>
        <td class="ctr col-mvp-anti">${p.antiDeath || 0}</td>
      </tr>`
      )
      .join("");
    refreshDualScrolls();
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

    if (m.status === "upcoming") {
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
