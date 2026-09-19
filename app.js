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
  const LEDGER_URL = "data/mvp-ledger.json";
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

  let catalog = [];
  let currentMonthMeta = null;
  let monthData = null;
  let matches = [];
  let ledger = null;
  let ratingRows = [];
  let ratingSortKey = "kv";
  let ratingSortDir = "desc";

  let modalMatch = null;
  let modalTab = "total";
  let modalPlayers = null;
  let sortKey = "kills";
  let sortDir = "desc";
  let monthKey = "09";

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

  /* ——— navigation ——— */
  function showView(name) {
    document.getElementById("view-home").hidden = name !== "home";
    document.getElementById("view-cw").hidden = name !== "cw";
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === name);
    });
    if (name === "cw") showCwPanel(document.querySelector(".subnav-btn.active")?.dataset.cw || "matches");
  }

  function showCwPanel(panel) {
    document.getElementById("cw-matches").hidden = panel !== "matches";
    document.getElementById("cw-rating").hidden = panel !== "rating";
    document.querySelectorAll(".subnav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cw === panel);
    });
    if (panel === "rating") loadRating();
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showView(el.dataset.nav);
      history.replaceState(null, "", el.dataset.nav === "cw" ? "#/cw" : "#/");
    });
  });
  document.querySelectorAll(".subnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showCwPanel(btn.dataset.cw);
      history.replaceState(null, "", btn.dataset.cw === "rating" ? "#/cw/rating" : "#/cw");
    });
  });

  function applyHash() {
    const h = location.hash || "#/";
    if (h.startsWith("#/cw")) {
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
    fetch(meta.url)
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

  function filteredMatches() {
    const q = (document.getElementById("filter-clan").value || "").trim().toLowerCase();
    if (!q) return matches;
    return matches.filter((m) => String(m.opp || "").toLowerCase().includes(q));
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
    paintStats(list);
    const tbody = document.getElementById("rows");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="empty-row">Нет матчей по фильтру</td></tr>`;
      return;
    }
    tbody.innerHTML = list
      .map((m) => {
        const st = m.status || "upcoming";
        return `<tr class="${st} clickable" data-i="${m._i}" tabindex="0" role="button">
          <td>${pad(m.day)}.${monthKey}</td>
          <td class="num">${m.timeMsk || "—"}</td>
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
  function ensureLedger() {
    if (ledger) return Promise.resolve(ledger);
    return fetch(LEDGER_URL)
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

    Promise.all(metas.map((meta) => fetch(meta.url).then((r) => r.json()).then((data) => ({ meta, data }))))
      .then((months) => {
        const matchList = [];
        months.forEach(({ data }) => {
          (data.matches || []).forEach((m) => {
            if (m.status !== "upcoming" && m.playersUrl) matchList.push(m);
          });
        });
        return Promise.all(
          matchList.map((m) =>
            fetch(m.playersUrl)
              .then((r) => (r.ok ? r.json() : null))
              .then((pj) => ({ match: m, players: pj }))
              .catch(() => ({ match: m, players: null }))
          )
        );
      })
      .then((bundles) => {
        const map = new Map();
        const touch = (nick) => {
          if (!map.has(nick)) {
            map.set(nick, {
              nick,
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
            if (!p || !p.nick) return;
            inMeeting.add(p.nick);
            const row = touch(p.nick);
            row.res += Number(p.res) || 0;
            row.nok += Number(p.nok) || 0;
            row.kills += Number(p.kills) || 0;
            row.deaths += Number(p.deaths) || 0;
            row.dmg += Number(p.dmg) || 0;
          });
          [...r1, ...r2].forEach((p) => {
            if (p && p.nick) inMeeting.add(p.nick);
          });
          inMeeting.forEach((nick) => {
            touch(nick).kv += 1;
          });

          const mvp = players.mvp || {
            r1: pickMvps(enrichRows(r1)),
            r2: pickMvps(enrichRows(r2)),
          };
          ["r1", "r2"].forEach((rk) => {
            const block = mvp[rk] || {};
            (block.medic || []).forEach((n) => {
              touch(n).mvpMedic += 1;
            });
            (block.killer || []).forEach((n) => {
              touch(n).mvpKiller += 1;
            });
            (block.damage || []).forEach((n) => {
              touch(n).mvpDamage += 1;
            });
            (block.antiDeath || []).forEach((n) => {
              touch(n).antiDeath += 1;
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
          ? `Период: ${scopeRu}. Каток со статой: ${withStats}. Ников: ${ratingRows.length}.`
          : "Пока нет каток с внесённой статой игроков — рейтинг пуст.";
        paintRatingTable();
      })
      .catch((err) => {
        note.textContent = String(err.message || err);
      });
  }

  function paintRatingTable() {
    const q = (document.getElementById("rating-nick").value || "").trim().toLowerCase();
    let rows = ratingRows;
    if (q) rows = rows.filter((p) => p.nick.toLowerCase().includes(q));
    const dir = ratingSortDir === "asc" ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      if (ratingSortKey === "nick") return dir * a.nick.localeCompare(b.nick, "ru");
      const av = Number(a[ratingSortKey]) || 0;
      const bv = Number(b[ratingSortKey]) || 0;
      if (av !== bv) return dir * (av - bv);
      return a.nick.localeCompare(b.nick, "ru");
    });

    const tbody = document.getElementById("rating-rows");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="13" class="empty-row">Нет игроков</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (p, i) => `<tr>
        <td class="ctr">${i + 1}</td>
        <td>${escapeHtml(p.nick)}</td>
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
  }

  document.querySelectorAll(".rating-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.rsort;
      if (ratingSortKey === key) ratingSortDir = ratingSortDir === "asc" ? "desc" : "asc";
      else {
        ratingSortKey = key;
        ratingSortDir = key === "nick" ? "asc" : "desc";
      }
      paintRatingTable();
    });
  });

  /* ——— match modal (player stats) ——— */
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    modalMatch = null;
    modalPlayers = null;
  }

  function openMatch(m) {
    modalMatch = m;
    modalTab = "total";
    sortKey = "kills";
    sortDir = "desc";
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

    modalBody.innerHTML = `<p class="modal-loading">Загрузка…</p>`;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modalTabs.hidden = true;

    if (m.status === "upcoming") {
      modalBody.innerHTML = `<p class="modal-empty">Катка ещё не сыграна — статистики нет.</p>`;
      return;
    }

    if (m.playersUrl) {
      fetch(m.playersUrl)
        .then((r) => {
          if (!r.ok) throw new Error("Нет файла статистики");
          return r.json();
        })
        .then((data) => {
          const r1 = enrichRows(data.r1 || []);
          const r2 = enrichRows(data.r2 || []);
          modalPlayers = {
            total: enrichRows(data.total || data.players || sumRounds(r1, r2)),
            r1,
            r2,
            details: data.details || null,
            mvpByRound: {
              r1: pickMvps(r1),
              r2: pickMvps(r2),
            },
          };
          labelTabs(m);
          paintPlayers();
        })
        .catch(() => {
          modalBody.innerHTML =
            `<p class="modal-empty">Статистика игроков ещё не внесена.<br>` +
            `Ресы / ноки / килы / смерти / боевой счёт — со скринов табло.</p>`;
        });
      return;
    }

    modalBody.innerHTML =
      `<p class="modal-empty">Статистика игроков ещё не внесена.<br>` +
      `Ресы / ноки / килы / смерти / боевой счёт — со скринов табло.</p>`;
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
    function winner(field, preferHigherKd) {
      const top = maxOf(rows, field);
      if (top <= 0) return null;
      const tied = rows.filter((p) => (Number(p[field]) || 0) === top);
      tied.sort((a, b) => {
        const ak = kdOf(a);
        const bk = kdOf(b);
        if (ak !== bk) return preferHigherKd ? bk - ak : ak - bk;
        return String(a.nick || "").localeCompare(String(b.nick || ""), "ru");
      });
      return tied[0].nick;
    }
    return {
      medic: [winner("res", true)].filter(Boolean),
      killer: [winner("kills", true)].filter(Boolean),
      damage: [winner("dmg", true)].filter(Boolean),
      antiDeath: [winner("deaths", false)].filter(Boolean),
    };
  }

  function medalCountsForNick(nick) {
    const counts = { medic: 0, killer: 0, damage: 0, antiDeath: 0 };
    const by = modalPlayers.mvpByRound || {};
    ["r1", "r2"].forEach((rk) => {
      const m = by[rk];
      if (!m) return;
      Object.keys(counts).forEach((kind) => {
        if ((m[kind] || []).includes(nick)) counts[kind] += 1;
      });
    });
    return counts;
  }

  function roundMvpsForNick(nick) {
    const key = modalTab === "r1" ? "r1" : "r2";
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
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function th(key, label, cls) {
    return `<th class="sortable ${cls || ""}" data-sort="${key}" title="Сортировать">${escapeHtml(label)}${sortMark(key)}</th>`;
  }

  function cellRecord(value, isRecord, anti) {
    const cls = isRecord ? (anti ? "record anti" : "record") : "";
    return `<td class="ctr ${cls}">${num(value)}</td>`;
  }

  function paintPlayers() {
    const hasRounds = !!(modalPlayers.r1 && modalPlayers.r1.length) || !!(modalPlayers.r2 && modalPlayers.r2.length);
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
              <td><div class="nick-cell"><span class="nick-name">${escapeHtml(p.nick || "—")}</span>${renderMedals(p.nick)}</div></td>
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
    const d = modalPlayers.details;
    if (!d) return "";
    const block = modalTab === "r1" ? d.r1 : modalTab === "r2" ? d.r2 : d.total;
    if (!block) return "";
    const title =
      modalTab === "r1"
        ? `Сводка R1 · ${escapeHtml(block.tickets || "")} · ${escapeHtml(block.len || "")}`
        : modalTab === "r2"
          ? `Сводка R2 · ${escapeHtml(block.tickets || "")} · ${escapeHtml(block.len || "")}`
          : `Сводка встречи · ${escapeHtml(block.tickets || "")}`;
    const rows = [
      ["Цели", block.goals],
      ["Пехота", block.infantry],
      ["ФОБ", block.fob],
      ["Техника", block.veh],
      ["Bleed", block.bleed],
      ["БК", block.ammo],
      ["Стройка", block.build],
      ["ФОБ поставлено", block.fobsCreated],
    ].filter(([, v]) => v != null && v !== "");
    return `
      <div class="match-summary">
        <p class="match-summary-title">${title}</p>
        <p class="match-summary-hint">наши : их · из Details</p>
        <div class="match-summary-grid">
          ${rows
            .map(
              ([k, v]) =>
                `<div class="match-summary-item"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`
            )
            .join("")}
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
  fetch(INDEX_URL)
    .then((r) => {
      if (!r.ok) throw new Error("Нет каталога месяцев");
      return r.json();
    })
    .then((data) => {
      catalog = data.months || [];
      fillYearMonthSelects();
      paintMonthChips();
      loadSelectedMonth();
      applyHash();
    })
    .catch((err) => {
      document.getElementById("note").textContent = String(err.message || err);
      applyHash();
    });
})();
