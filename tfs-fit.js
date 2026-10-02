/* Тиры Fit — TM tab (CW-only Fit% boards / candidates / analytics) */
(function () {
  const TFS_URL = "data/tfs-fit.json";

  const MONTH_RU = {
    1: "Январь",
    2: "Февраль",
    3: "Март",
    4: "Апрель",
    5: "Май",
    6: "Июнь",
    7: "Июль",
    8: "Август",
    9: "Сентябрь",
    10: "Октябрь",
    11: "Ноябрь",
    12: "Декабрь",
  };

  let payload = null;
  let view = {
    sec: "boards",
    tier: "1",
    scope: "all",
    year: null,
    month: null,
    nick: "",
    sort: { promote: { key: "fit", dir: -1 }, demote: { key: "fit", dir: 1 }, warn: { key: "fit", dir: 1 } },
    boardSort: {},
  };
  let computed = null;
  let loaded = false;
  let bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function median(arr) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function selectedMeetingIds() {
    const meets = payload.meetings || [];
    if (view.scope === "all") return meets.map((m) => m.id);
    if (view.scope === "year") {
      return meets.filter((m) => m.year === Number(view.year)).map((m) => m.id);
    }
    return meets
      .filter((m) => m.year === Number(view.year) && m.month === Number(view.month))
      .map((m) => m.id);
  }

  function recompute(ids) {
    const th = payload.thresholds;
    const W = payload.weights;
    const ROLE_ORDER = payload.roleOrder;
    const ROLE_LABEL = payload.roleLabels;
    const BEST_KEYS = payload.bestKeys;
    const sel = new Set(ids);
    const meets = (payload.meetings || []).filter((m) => sel.has(m.id));
    const maxRounds = meets.reduce((s, m) => s + (m.rounds || 0), 0) || 1;

    const players = [];
    for (const rp of payload.rawPlayers || []) {
      let res = 0,
        kills = 0,
        deaths = 0,
        dmg = 0,
        g = 0,
        used = 0;
      for (const [mid, slot] of Object.entries(rp.meets || {})) {
        if (!sel.has(mid)) continue;
        used += 1;
        g += slot.r || 0;
        res += slot.res || 0;
        kills += slot.k || 0;
        deaths += slot.d || 0;
        dmg += slot.dmg || 0;
      }
      if (g < 1) continue;
      const role = W[rp.role] ? rp.role : "Rifle";
      players.push({
        nick: rp.nick,
        tier: rp.tier,
        role,
        roleLabel: ROLE_LABEL[role] || role,
        g,
        meetings: used,
        res_g: Math.round((res / g) * 100) / 100,
        kd: Math.round((kills / Math.max(deaths, 1)) * 100) / 100,
        dmg_g: Math.round((dmg / g) * 10) / 10,
        orr: rp.orr || 0,
        pres: g / maxRounds,
        pause: [1, 2, 3].includes(rp.tier) && g < th.minGamesActive,
      });
    }

    function buildBench(tier) {
      const pools = {};
      for (const p of players) {
        if (p.tier !== tier) continue;
        if (tier === 1 && p.role === "Medic" && p.res_g < 4) continue;
        if (p.g < 4) continue;
        (pools[p.role] || (pools[p.role] = [])).push(p);
      }
      const out = {};
      for (const [role, rows] of Object.entries(pools)) {
        const active = rows.filter((r) => r.g >= th.minGamesActive);
        const src = active.length >= 2 ? active : rows;
        if (!src.length) continue;
        out[role] = {
          n: src.length,
          thin: src.length < 2,
          who: [...src].sort((a, b) => b.orr - a.orr).slice(0, 6).map((r) => r.nick),
          res_g: median(src.map((r) => r.res_g)),
          kd: median(src.map((r) => r.kd)),
          dmg_g: median(src.map((r) => r.dmg_g)),
          orr: median(src.map((r) => r.orr).filter(Boolean).concat([0])),
        };
      }
      return out;
    }

    const benches = { 1: buildBench(1), 2: buildBench(2), 3: buildBench(3) };

    function fitTo(p, bench, role) {
      const b = bench[role];
      const w = W[role];
      if (!b || !w) return null;
      const f = (val, tgt) => (!tgt ? 0 : Math.min(100, (100 * val) / tgt));
      const comps = {
        res: f(p.res_g, b.res_g),
        kd: f(p.kd, b.kd),
        dmg: f(p.dmg_g, b.dmg_g),
        orr: f(p.orr, b.orr || 1),
        pres: f(p.pres, 0.45),
      };
      if (role === "Medic") comps.kd = Math.min(comps.kd, 50);
      return Math.round(Object.keys(w).reduce((s, k) => s + w[k] * comps[k], 0) * 10) / 10;
    }

    for (const p of players) {
      p.fitOwn = benches[p.tier] ? fitTo(p, benches[p.tier], p.role) : null;
      p.fitT1 = fitTo(p, benches[1], p.role);
      p.fitT2 = fitTo(p, benches[2], p.role);
      p.fitT3 = fitTo(p, benches[3], p.role);
    }

    const tierBoards = {};
    for (const t of [1, 2, 3, 4]) {
      const rolesBlock = {};
      for (const role of ROLE_ORDER) {
        let rows = players.filter((p) => p.role === role);
        if (t <= 3) {
          rows = rows.filter(
            (p) =>
              p.tier === t ||
              (p.tier > t && (p["fitT" + t] || 0) >= 80)
          );
        } else {
          rows = rows.filter((p) => p.tier === 4);
        }
        const fitKey = t <= 3 ? "fitT" + t : "fitT3";
        const enriched = [];
        for (const p of rows) {
          let fit = p[fitKey];
          if (p.tier === t && p.fitOwn != null) fit = p.fitOwn;
          if (fit == null) continue;
          enriched.push({ ...p, fit });
        }
        enriched.sort((a, b) => b.fit - a.fit || a.nick.localeCompare(b.nick));
        if (!enriched.length) continue;
        const inTier = enriched.filter((r) => r.tier === t && !r.pause);
        const bestNick = inTier.length
          ? inTier.reduce((a, b) => (a.fit >= b.fit ? a : b)).nick
          : null;
        const keys = BEST_KEYS[role] || ["fit", "orr"];
        const records = {};
        for (const key of keys) {
          records[key] = Math.max(...enriched.map((r) => r[key] ?? -Infinity));
        }
        const bench = t <= 3 ? benches[t]?.[role] : benches[3]?.[role];
        rolesBlock[role] = {
          role,
          roleLabel: ROLE_LABEL[role],
          bench,
          bestInTier: bestNick,
          records,
          rows: enriched.slice(0, 12).map((r) => ({
            nick: r.nick,
            tier: r.tier,
            fit: r.fit,
            res_g: r.res_g,
            kd: r.kd,
            dmg_g: r.dmg_g,
            orr: r.orr,
            g: r.g,
            pause: r.pause,
            bestInTier: r.nick === bestNick,
          })),
        };
      }
      tierBoards[String(t)] = rolesBlock;
    }

    const promote = [];
    for (const p of players) {
      let fit = null;
      let target = null;
      if (p.tier >= 4) {
        fit = p.fitT3;
        target = 3;
      } else if (p.tier === 3) {
        fit = p.fitT2;
        target = 2;
      } else if (p.tier === 2) {
        fit = p.fitT1;
        target = 1;
      } else continue;
      if (fit == null || fit < th.promoteAlmost) continue;
      if (p.g < th.minGamesActive && p.tier !== 4) continue;
      promote.push({
        nick: p.nick,
        fromTier: p.tier,
        toTier: target,
        role: p.role,
        roleLabel: p.roleLabel,
        fit,
        band: fit >= th.promoteStrong ? "strong" : "almost",
        g: p.g,
        res_g: p.res_g,
        kd: p.kd,
        dmg_g: p.dmg_g,
        orr: p.orr,
      });
    }
    promote.sort((a, b) => b.fit - a.fit || a.fromTier - b.fromTier);

    const demote = [];
    const warn = [];
    for (const p of players) {
      if (![1, 2, 3].includes(p.tier) || p.pause || p.fitOwn == null) continue;
      const row = {
        nick: p.nick,
        fromTier: p.tier,
        toTier: p.tier + 1,
        role: p.role,
        roleLabel: p.roleLabel,
        fit: p.fitOwn,
        g: p.g,
        res_g: p.res_g,
        kd: p.kd,
        dmg_g: p.dmg_g,
        orr: p.orr,
      };
      if (p.fitOwn < th.warn) demote.push(row);
      else if (p.fitOwn < th.hold) warn.push(row);
    }
    demote.sort((a, b) => a.fit - b.fit);
    warn.sort((a, b) => a.fit - b.fit);

    const byTier = { 1: 0, 2: 0, 3: 0, 4: 0 };
    let pauseCount = 0;
    const fitOwnVals = [];
    for (const p of players) {
      byTier[p.tier] = (byTier[p.tier] || 0) + 1;
      if (p.pause) pauseCount += 1;
      if (p.fitOwn != null && !p.pause) fitOwnVals.push(p.fitOwn);
    }
    const roleGap = [];
    for (const role of ROLE_ORDER) {
      const t1s = players.filter((p) => p.tier === 1 && p.role === role && !p.pause && p.fitOwn != null);
      const t2s = players.filter((p) => p.tier === 2 && p.role === role && p.g >= th.minGamesActive);
      if (!t1s.length || !t2s.length) continue;
      const best = t2s.reduce((a, b) => ((a.fitT1 || 0) >= (b.fitT1 || 0) ? a : b));
      roleGap.push({
        role,
        roleLabel: ROLE_LABEL[role],
        t1MedianFit: Math.round(median(t1s.map((p) => p.fitOwn)) * 10) / 10,
        bestT2FitT1: best.fitT1,
        bestT2: best.nick,
      });
    }

    return {
      meetingCount: ids.length,
      maxRounds,
      benches,
      tierBoards,
      candidates: { promote, demote, warn },
      analytics: {
        playersInScope: players.length,
        byTier,
        pauseCount,
        medianFitOwn: fitOwnVals.length ? Math.round(median(fitOwnVals) * 10) / 10 : null,
        promoteCount: promote.length,
        demoteCount: demote.length,
        warnCount: warn.length,
        roleGap,
        topFitT1: [...players]
          .filter((p) => p.fitT1 != null)
          .sort((a, b) => b.fitT1 - a.fitT1)
          .slice(0, 10)
          .map((p) => ({
            nick: p.nick,
            tier: p.tier,
            roleLabel: p.roleLabel,
            fit: p.fitT1,
          })),
      },
    };
  }

  function ensureFilters() {
    const years = [...new Set((payload.meetings || []).map((m) => m.year))].sort((a, b) => b - a);
    const ySel = $("tfs-year");
    const mSel = $("tfs-month");
    if (!ySel.options.length) {
      ySel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
      view.year = years[0];
      ySel.value = String(view.year);
    }
    const syncMonths = () => {
      const y = Number(ySel.value);
      const months = [
        ...new Set(
          (payload.meetings || []).filter((m) => m.year === y).map((m) => m.month)
        ),
      ].sort((a, b) => b - a);
      mSel.innerHTML = months
        .map((m) => `<option value="${m}">${MONTH_RU[m] || m}</option>`)
        .join("");
      if (!months.includes(Number(view.month))) view.month = months[0];
      mSel.value = String(view.month);
    };
    syncMonths();
    const scope = $("tfs-scope").value;
    view.scope = scope;
    $("tfs-year-wrap").hidden = scope === "all";
    $("tfs-month-wrap").hidden = scope !== "month";
  }

  function nickFilter(rows) {
    const q = view.nick.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.nick).toLowerCase().includes(q));
  }

  function sortRows(rows, key, dir) {
    return [...rows].sort((a, b) => {
      let av = a[key],
        bv = b[key];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av == null) av = dir > 0 ? Infinity : -Infinity;
      if (bv == null) bv = dir > 0 ? Infinity : -Infinity;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return String(a.nick).localeCompare(String(b.nick));
    });
  }

  function cell(val, hot, fmt) {
    const text = fmt ? fmt(val) : val;
    return `<td class="ctr${hot ? " tfs-rec" : ""}">${esc(text)}</td>`;
  }

  function renderKpis() {
    const a = computed.analytics;
    const el = $("tfs-kpis");
    el.hidden = false;
    el.innerHTML = [
      ["Встреч КВ", a.playersInScope != null ? computed.meetingCount : "—"],
      ["Игроков", a.playersInScope],
      ["↑ кандидатов", a.promoteCount],
      ["↓ форма", a.demoteCount],
      ["Пауза", a.pauseCount],
      ["Мед. Fit свой", a.medianFitOwn != null ? a.medianFitOwn + "%" : "—"],
    ]
      .map(
        ([k, v]) =>
          `<div class="hero-stat"><span class="hero-stat-label">${esc(k)}</span><strong>${esc(v)}</strong></div>`
      )
      .join("");
  }

  function renderBoards() {
    const tier = view.tier;
    const boards = computed.tierBoards[tier] || {};
    const lead = $("tfs-tier-lead");
    lead.textContent =
      tier === "4"
        ? "Тир 4 · Fit считается к эталону Тир 3 (куда тянутся). Жёлтый — лучший показатель в роли; подсветка строки — лучший в своём тире."
        : `Тир ${tier} · эталон = медиана текущих игроков тира по роли. Fit% — насколько дотягиваешь. Жёлтый = рекорд в таблице роли; золотая полоса слева — лучший игрок этого тира в роли.`;

    const nickQ = view.nick.trim().toLowerCase();
    const parts = [];
    for (const role of payload.roleOrder) {
      const block = boards[role];
      if (!block || !block.rows?.length) continue;
      let rows = nickFilter(block.rows);
      const sk = view.boardSort[role] || { key: "fit", dir: -1 };
      rows = sortRows(rows, sk.key, sk.dir);
      if (!rows.length) continue;
      const rec = block.records || {};
      const isRec = (key, val) =>
        rec[key] != null && Math.abs(Number(rec[key]) - Number(val)) < 1e-9;
      const b = block.bench;
      const benchLine = b
        ? `Эталон = медиана из ${b.n}: ${b.who.join(", ")} · res ${Number(b.res_g).toFixed(2)} · KD ${Number(b.kd).toFixed(2)} · dmg ${Math.round(b.dmg_g)} · ORR ${Math.round(b.orr)}${b.thin ? " · пул тонкий" : ""}`
        : "Эталон пока неполный для этой роли";
      parts.push(`
        <article class="tfs-role-card" data-role="${esc(role)}">
          <h3>${esc(block.roleLabel)}</h3>
          <p class="tfs-bench">${esc(benchLine)}</p>
          <div class="table-scroll">
            <table class="rating-table tfs-table">
              <thead>
                <tr>
                  <th class="sortable" data-tfs-board="${esc(role)}" data-tfsort="nick">Ник</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="tier">Тир</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="fit">Fit%</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="res_g">res/g</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="kd">KD</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="dmg_g">dmg/g</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="orr">ORR</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="g">игр</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map((r) => {
                    const pause = r.pause
                      ? ` <span class="tfs-pause">· пауза</span>`
                      : "";
                    return `<tr class="${r.bestInTier ? "tfs-row-best" : ""}">
                      <td>${esc(r.nick)}${pause}</td>
                      <td class="ctr">T${r.tier}</td>
                      ${cell(r.fit.toFixed(1), isRec("fit", r.fit))}
                      ${cell(Number(r.res_g).toFixed(2), isRec("res_g", r.res_g))}
                      ${cell(Number(r.kd).toFixed(2), isRec("kd", r.kd))}
                      ${cell(Math.round(r.dmg_g), isRec("dmg_g", r.dmg_g))}
                      ${cell(r.orr, isRec("orr", r.orr))}
                      ${cell(r.g, isRec("g", r.g))}
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
          <p class="tfs-foot">Жёлтый = лучший показатель в роли${role === "Medic" ? " (KD у медика не рекорд)" : ""}${block.bestInTier ? ` · лучший в тире: ${esc(block.bestInTier)}` : ""}</p>
        </article>`);
    }
    $("tfs-boards").innerHTML =
      parts.join("") ||
      `<p class="note">Нет данных по ролям за выбранный период${nickQ ? " / поиск" : ""}.</p>`;

    $("tfs-boards").querySelectorAll("[data-tfs-board]").forEach((th) => {
      th.addEventListener("click", () => {
        const role = th.getAttribute("data-tfs-board");
        const key = th.getAttribute("data-tfsort");
        const cur = view.boardSort[role] || { key: "fit", dir: -1 };
        view.boardSort[role] = {
          key,
          dir: cur.key === key ? -cur.dir : key === "nick" ? 1 : -1,
        };
        renderBoards();
      });
    });
  }

  function renderCandTable(tbodyId, rows, cols, sortKey) {
    const st = view.sort[sortKey] || { key: "fit", dir: -1 };
    let list = nickFilter(rows);
    list = sortRows(list, st.key, st.dir);
    const tb = $(tbodyId);
    if (!list.length) {
      tb.innerHTML = `<tr><td colspan="${cols.length}" class="muted">Нет кандидатов</td></tr>`;
      return;
    }
    tb.innerHTML = list
      .map((r) => {
        return (
          "<tr>" +
          cols
            .map((c) => {
              let v = r[c];
              let cls = "ctr";
              if (c === "nick" || c === "roleLabel") cls = "";
              if (c === "band") {
                v = r.band === "strong" ? "сильный" : "почти";
                cls += r.band === "strong" ? " tfs-band-strong" : " tfs-band-almost";
              }
              if (c === "fromTier" || c === "toTier") v = "T" + v;
              if (c === "fit") v = Number(v).toFixed(1);
              if (c === "res_g" || c === "kd") v = Number(v).toFixed(2);
              if (c === "dmg_g") v = Math.round(v);
              return `<td class="${cls}">${esc(v)}</td>`;
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
  }

  function renderCandidates() {
    renderCandTable(
      "tfs-promote-rows",
      computed.candidates.promote,
      ["nick", "fromTier", "toTier", "roleLabel", "fit", "band", "g", "kd", "dmg_g", "orr"],
      "promote"
    );
    renderCandTable(
      "tfs-demote-rows",
      computed.candidates.demote,
      ["nick", "fromTier", "toTier", "roleLabel", "fit", "g", "res_g", "kd", "orr"],
      "demote"
    );
    renderCandTable(
      "tfs-warn-rows",
      computed.candidates.warn,
      ["nick", "fromTier", "roleLabel", "fit", "g", "orr"],
      "warn"
    );
  }

  function renderAnalytics() {
    const a = computed.analytics;
    const byTier = a.byTier || {};
    const gapRows = (a.roleGap || [])
      .map(
        (g) =>
          `<tr>
            <td>${esc(g.roleLabel)}</td>
            <td class="ctr">${esc(g.t1MedianFit)}</td>
            <td>${esc(g.bestT2)}</td>
            <td class="ctr tfs-rec">${esc(g.bestT2FitT1)}</td>
          </tr>`
      )
      .join("");
    const topRows = (a.topFitT1 || [])
      .map(
        (p, i) =>
          `<tr>
            <td class="ctr">${i + 1}</td>
            <td>${esc(p.nick)}</td>
            <td class="ctr">T${p.tier}</td>
            <td>${esc(p.roleLabel)}</td>
            <td class="ctr${i === 0 ? " tfs-rec" : ""}">${esc(Number(p.fit).toFixed(1))}</td>
          </tr>`
      )
      .join("");

    $("tfs-an-body").innerHTML = `
      <section class="board tfs-card">
        <div class="board-head"><h2>Состав по тирам</h2><p class="board-sub">Игроки с КВ-статой в выбранном периоде</p></div>
        <div class="hero-stats hero-stats-inline">
          ${[1, 2, 3, 4]
            .map(
              (t) =>
                `<div class="hero-stat"><span class="hero-stat-label">Тир ${t}</span><strong>${esc(byTier[t] || 0)}</strong></div>`
            )
            .join("")}
        </div>
      </section>
      <section class="board tfs-card">
        <div class="board-head"><h2>Переходы</h2><p class="board-sub">Сводка кандидатов</p></div>
        <div class="hero-stats hero-stats-inline">
          <div class="hero-stat"><span class="hero-stat-label">Вверх</span><strong class="tfs-band-strong">${esc(a.promoteCount)}</strong></div>
          <div class="hero-stat"><span class="hero-stat-label">Вниз</span><strong>${esc(a.demoteCount)}</strong></div>
          <div class="hero-stat"><span class="hero-stat-label">Жёлтая зона</span><strong class="tfs-band-almost">${esc(a.warnCount)}</strong></div>
          <div class="hero-stat"><span class="hero-stat-label">Пауза</span><strong>${esc(a.pauseCount)}</strong></div>
        </div>
      </section>
      <section class="board tfs-card tfs-card-wide">
        <div class="board-head"><h2>Разрыв T2 → T1 по ролям</h2><p class="board-sub">Лучший T2 по Fit к эталону T1</p></div>
        <div class="table-scroll">
          <table class="rating-table tfs-table">
            <thead><tr><th>Роль</th><th class="ctr">Мед. Fit T1</th><th>Лучший T2</th><th class="ctr">Fit→T1</th></tr></thead>
            <tbody>${gapRows || `<tr><td colspan="4" class="muted">Мало данных</td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <section class="board tfs-card tfs-card-wide">
        <div class="board-head"><h2>Топ Fit → Тир 1</h2><p class="board-sub">Ближе всех к эталону T1 (любой текущий тир)</p></div>
        <div class="table-scroll">
          <table class="rating-table tfs-table">
            <thead><tr><th class="ctr">#</th><th>Ник</th><th class="ctr">Тир</th><th>Роль</th><th class="ctr">Fit%</th></tr></thead>
            <tbody>${topRows || `<tr><td colspan="5" class="muted">Нет данных</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  function showSec(sec) {
    view.sec = sec;
    document.querySelectorAll("[data-tfs-sec]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tfs-sec") === sec);
    });
    $("tfs-sec-boards").hidden = sec !== "boards";
    $("tfs-sec-cand").hidden = sec !== "cand";
    $("tfs-sec-analytics").hidden = sec !== "analytics";
  }

  function refresh() {
    if (!payload) return;
    ensureFilters();
    const ids = selectedMeetingIds();
    computed = recompute(ids);
    const note = $("tfs-note");
    note.textContent = `КВ · ${computed.meetingCount} встреч · обновлено ${payload.updatedAt} · Fit к эталону тира (медиана роли). Повышение ≥90%, удержание ≥85%, demote <75%.`;
    renderKpis();
    renderBoards();
    renderCandidates();
    renderAnalytics();
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("tfs-scope")?.addEventListener("change", () => {
      view.scope = $("tfs-scope").value;
      refresh();
    });
    $("tfs-year")?.addEventListener("change", () => {
      view.year = Number($("tfs-year").value);
      refresh();
    });
    $("tfs-month")?.addEventListener("change", () => {
      view.month = Number($("tfs-month").value);
      refresh();
    });
    let t = null;
    $("tfs-nick")?.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        view.nick = $("tfs-nick").value || "";
        renderBoards();
        renderCandidates();
      }, 120);
    });
    document.querySelectorAll("[data-tfs-sec]").forEach((btn) => {
      btn.addEventListener("click", () => showSec(btn.getAttribute("data-tfs-sec")));
    });
    document.querySelectorAll("[data-tfs-tier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        view.tier = btn.getAttribute("data-tfs-tier");
        document.querySelectorAll("[data-tfs-tier]").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
        renderBoards();
      });
    });
    document.querySelectorAll("[data-tfs-tbl]").forEach((th) => {
      th.addEventListener("click", () => {
        const tbl = th.getAttribute("data-tfs-tbl");
        const key = th.getAttribute("data-tfsort");
        const cur = view.sort[tbl] || { key: "fit", dir: -1 };
        view.sort[tbl] = {
          key,
          dir: cur.key === key ? -cur.dir : key === "nick" || key === "roleLabel" ? 1 : -1,
        };
        renderCandidates();
      });
    });
  }

  window.loadTfsFit = function loadTfsFit(fetchUrl) {
    const note = $("tfs-note");
    if (!note) return;
    if (loaded && payload) {
      refresh();
      return;
    }
    note.textContent = "Загружаем Тиры Fit…";
    const ver = new URLSearchParams(location.search).get("v") || "20261002-tfs-fit";
    const href =
      fetchUrl ||
      TFS_URL + (TFS_URL.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(ver);
    fetch(href, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        payload = data;
        loaded = true;
        const years = [...new Set((data.meetings || []).map((m) => m.year))].sort((a, b) => b - a);
        view.year = years[0];
        const months = [
          ...new Set(
            (data.meetings || []).filter((m) => m.year === view.year).map((m) => m.month)
          ),
        ].sort((a, b) => b - a);
        view.month = months[0];
        bind();
        showSec("boards");
        refresh();
      })
      .catch((err) => {
        note.textContent = "Не удалось загрузить tfs-fit.json: " + (err && err.message);
      });
  };
})();
