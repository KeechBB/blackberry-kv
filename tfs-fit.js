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
    const shareCfg = payload.crewShare || {};
    const shareAlpha = Number(shareCfg.alpha) || 0;
    const driverGunners = {};
    for (const pair of shareCfg.pairs || []) {
      const d = String(pair.driver || "")
        .trim()
        .toLowerCase();
      const guns = (pair.gunners || [])
        .map((g) => String(g || "").trim().toLowerCase())
        .filter(Boolean);
      if (d && guns.length) driverGunners[d] = guns;
    }
    const meetLookup = {};
    for (const rp of payload.rawPlayers || []) {
      const key = String(rp.nick || "")
        .trim()
        .toLowerCase();
      meetLookup[key] = rp.meets || {};
    }

    for (const rp of payload.rawPlayers || []) {
      let res = 0,
        kills = 0,
        deaths = 0,
        dmg = 0,
        g = 0,
        used = 0,
        shareMeets = 0;
      const nickKey = String(rp.nick || "")
        .trim()
        .toLowerCase();
      for (const [mid, slot] of Object.entries(rp.meets || {})) {
        if (!sel.has(mid)) continue;
        used += 1;
        g += slot.r || 0;
        res += slot.res || 0;
        kills += slot.k || 0;
        deaths += slot.d || 0;
        dmg += slot.dmg || 0;

        if (shareAlpha > 0 && driverGunners[nickKey]) {
          let best = null;
          let bestDmg = -1;
          for (const gk of driverGunners[nickKey]) {
            const gslot = (meetLookup[gk] || {})[mid];
            if (!gslot) continue;
            const gd = Number(gslot.dmg) || 0;
            if (gd > bestDmg) {
              bestDmg = gd;
              best = gslot;
            }
          }
          if (best) {
            shareMeets += 1;
            kills += shareAlpha * (Number(best.k) || 0);
            dmg += shareAlpha * (Number(best.dmg) || 0);
          }
        }
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
        crewShareMeets: shareMeets,
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
    const METRIC_RU = payload.metricLabels
      ? Object.fromEntries(
          Object.entries(payload.metricLabels).map(([k, title]) => [
            k,
            [title, ""],
          ])
        )
      : {
          res: ["Ресы/игра", "чаще поднимай союзников"],
          kd: ["KD", "больше фрагов / меньше смертей"],
          dmg: ["Урон/игра", "больше урона"],
          orr: ["ORR", "польза в КВ"],
          pres: ["Активность", "заходи в КВ"],
        };
    const METRIC_HOW = {
      res: "чаще поднимай союзников",
      kd: "больше фрагов / меньше смертей",
      dmg: "больше урона по пехоте и технике",
      orr: "польза в КВ-составах",
      pres: "заходи стабильно в клановые войны",
    };

    function fitDetail(p, bench, role) {
      const b = bench[role];
      let w = W[role] ? { ...W[role] } : null;
      if (!b || !w) return null;
      const f = (val, tgt) => (!tgt ? 0 : Math.min(100, (100 * val) / tgt));
      const comps = {
        res: f(p.res_g, b.res_g),
        kd: f(p.kd, b.kd),
        dmg: f(p.dmg_g, b.dmg_g),
        orr: f(p.orr, b.orr || 1),
        pres: f(p.pres, 0.45),
      };
      if (role === "Medic") {
        comps.kd = Math.min(comps.kd, 50);
        w.kd = 0;
      }
      const wsum = Object.values(w).reduce((s, x) => s + x, 0) || 1;
      Object.keys(w).forEach((k) => {
        w[k] = w[k] / wsum;
      });
      const fit =
        Math.round(
          Object.keys(w).reduce((s, k) => s + w[k] * comps[k], 0) * 10
        ) / 10;
      const gaps = [];
      for (const [k, wt] of Object.entries(w)) {
        if (wt < 0.04) continue;
        const short = Math.max(0, 100 - comps[k]);
        if (short < 8) continue;
        gaps.push({ score: wt * short, k, comp: comps[k], wt });
      }
      gaps.sort((a, b) => b.score - a.score);
      const tips = gaps.slice(0, 2).map((g) => {
        const title = (METRIC_RU[g.k] && METRIC_RU[g.k][0]) || g.k;
        const how = METRIC_HOW[g.k] || "";
        return {
          metric: g.k,
          title,
          how,
          you: Math.round(g.comp),
          weightPct: Math.round(g.wt * 100),
          text: `${title}: ${Math.round(g.comp)}% от эталона — ${how}`,
        };
      });
      if (!tips.length) {
        tips.push({
          metric: "pres",
          title: "Активность",
          how: "заходи в КВ",
          you: Math.round(comps.pres),
          weightPct: Math.round((w.pres || 0) * 100),
          text:
            fit >= 95
              ? "Ты выше эталона — держи объём КВ и роль."
              : "Нет явного провала — копи объём КВ на своей роли.",
        });
      }
      return { fit, comps, tips, lever: tips[0] ? tips[0].text : "" };
    }

    function fitTo(p, bench, role) {
      const d = fitDetail(p, bench, role);
      return d ? d.fit : null;
    }

    for (const p of players) {
      let own =
        p.tier <= 3 && benches[p.tier]
          ? fitDetail(p, benches[p.tier], p.role)
          : null;
      if (p.tier === 4) own = fitDetail(p, benches[3] || {}, p.role);
      p.fitOwn = own ? own.fit : null;
      p.compsOwn = own ? own.comps : null;
      p.tips = own ? own.tips : [];
      p.lever = own ? own.lever : "";
      p.fitT1 = fitTo(p, benches[1], p.role);
      p.fitT2 = fitTo(p, benches[2], p.role);
      p.fitT3 = fitTo(p, benches[3], p.role);
      const upTier = p.tier >= 4 ? 3 : p.tier === 3 ? 2 : p.tier === 2 ? 1 : null;
      if (upTier) {
        const up = fitDetail(p, benches[upTier] || {}, p.role);
        if (up) {
          p.tipsUp = up.tips;
          p.leverUp = up.lever;
        }
      }
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
            crewShareMeets: r.crewShareMeets || 0,
            lever: r.lever || "",
            tips: (r.tips || []).slice(0, 2),
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
      if (p.g < th.minGamesActive) continue;
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
        lever: p.leverUp || p.lever || "",
        tips: p.tipsUp || p.tips || [],
      });
    }
    promote.sort((a, b) => b.fit - a.fit || a.fromTier - b.fromTier);

    const demote = [];
    const warn = [];
    for (const p of players) {
      if (![1, 2, 3].includes(p.tier) || p.pause || p.fitOwn == null) continue;
      const benchRole = (benches[p.tier] || {})[p.role] || {};
      if (benchRole.thin && p.fitOwn >= th.warn - 5) continue;
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
        lever: p.lever || "",
        tips: p.tips || [],
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
          `<div class="stat tfs-kpi"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`
      )
      .join("");
  }

  function renderBoards() {
    const tier = view.tier;
    const boards = computed.tierBoards[tier] || {};
    const lead = $("tfs-tier-lead");
    if (lead) {
      lead.hidden = true;
      lead.textContent = "";
    }

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
      parts.push(`
        <article class="tfs-role-card" data-role="${esc(role)}">
          <h3>${esc(block.roleLabel)}</h3>
          <div class="table-scroll">
            <table class="rating-table tfs-table">
              <thead>
                <tr>
                  <th class="sortable" data-tfs-board="${esc(role)}" data-tfsort="nick">Ник</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="tier">Тир</th>
                  <th class="ctr sortable" data-tfs-board="${esc(role)}" data-tfsort="fit">Fit%</th>
                  <th data-tfs-board="${esc(role)}">Как стать лучше</th>
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
                    const share =
                      r.crewShareMeets > 0
                        ? ` <span class="tfs-share" title="Мех-шаринг ×${r.crewShareMeets}">· мех×${r.crewShareMeets}</span>`
                        : "";
                    const lever = r.lever
                      ? `<td class="tfs-lever">${esc(r.lever)}</td>`
                      : `<td class="muted">—</td>`;
                    return `<tr class="${r.bestInTier ? "tfs-row-best" : ""}">
                      <td>${esc(r.nick)}${pause}${share}</td>
                      <td class="ctr">T${r.tier}</td>
                      ${cell(r.fit.toFixed(1), isRec("fit", r.fit))}
                      ${lever}
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
              if (c === "lever") {
                cls = "tfs-lever";
                v = v || "—";
              }
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
      ["nick", "fromTier", "toTier", "roleLabel", "fit", "band", "lever", "g", "kd", "orr"],
      "promote"
    );
    renderCandTable(
      "tfs-demote-rows",
      computed.candidates.demote,
      ["nick", "fromTier", "toTier", "roleLabel", "fit", "lever", "g", "orr"],
      "demote"
    );
    renderCandTable(
      "tfs-warn-rows",
      computed.candidates.warn,
      ["nick", "fromTier", "roleLabel", "fit", "lever", "g"],
      "warn"
    );
  }

  function renderGuide() {
    const el = $("tfs-guide");
    if (!el) return;
    const g = payload.guide;
    if (!g) {
      el.innerHTML = `<p><strong>FIT</strong> — % от эталона тира по роли (только КВ). Рядом с ником — что качать.</p>`;
      return;
    }
    const bands = (g.bands || [])
      .map(
        (b) =>
          `<li><strong>${esc(b.label)}</strong> — ${esc(b.rule)}</li>`
      )
      .join("");
    const steps = (g.steps || [])
      .slice(0, 5)
      .map((s) => `<li>${esc(s)}</li>`)
      .join("");
    el.innerHTML = `
      <p class="tfs-guide-title"><strong>${esc(g.title || "Как работает Fit")}</strong></p>
      <ol class="tfs-guide-steps">${steps}</ol>
      <ul class="tfs-guide-bands">${bands}</ul>
      <p class="tfs-guide-auto muted">${esc(g.autonomy || "")}</p>`;
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
        <div class="board-head"><h2>Состав по тирам</h2></div>
        <div class="tfs-stat-grid tfs-stat-grid-4">
          ${[1, 2, 3, 4]
            .map(
              (t) =>
                `<div class="stat tfs-kpi"><span class="k">Тир ${t}</span><span class="v">${esc(byTier[t] || 0)}</span></div>`
            )
            .join("")}
        </div>
      </section>
      <section class="board tfs-card">
        <div class="board-head"><h2>Переходы</h2></div>
        <div class="tfs-stat-grid tfs-stat-grid-4">
          <div class="stat tfs-kpi"><span class="k">Вверх</span><span class="v tfs-band-strong">${esc(a.promoteCount)}</span></div>
          <div class="stat tfs-kpi"><span class="k">Вниз</span><span class="v">${esc(a.demoteCount)}</span></div>
          <div class="stat tfs-kpi"><span class="k">Жёлтая зона</span><span class="v tfs-band-almost">${esc(a.warnCount)}</span></div>
          <div class="stat tfs-kpi"><span class="k">Пауза</span><span class="v">${esc(a.pauseCount)}</span></div>
        </div>
      </section>
      <section class="board tfs-card tfs-card-wide">
        <div class="board-head"><h2>Разрыв T2 → T1 по ролям</h2></div>
        <div class="table-scroll">
          <table class="rating-table tfs-table">
            <thead><tr><th>Роль</th><th class="ctr">Мед. Fit T1</th><th>Лучший T2</th><th class="ctr">Fit→T1</th></tr></thead>
            <tbody>${gapRows || `<tr><td colspan="4" class="muted">Мало данных</td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <section class="board tfs-card tfs-card-wide">
        <div class="board-head"><h2>Топ Fit → Тир 1</h2></div>
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
    if (note) {
      note.hidden = true;
      note.textContent = "";
    }
    renderGuide();
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
    if (loaded && payload) {
      refresh();
      return;
    }
    if (note) {
      note.hidden = false;
      note.textContent = "Загружаем…";
    }
    const ver = new URLSearchParams(location.search).get("v") || "20261002-akin-gp";
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
        if (note) {
          note.hidden = false;
          note.textContent = "Не удалось загрузить tfs-fit.json: " + (err && err.message);
        }
      });
  };
})();
