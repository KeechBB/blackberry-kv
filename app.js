(function () {
  const STATUS_RU = {
    win: "победа",
    lose: "поражение",
    draw: "ничья",
    upcoming: "скоро",
  };

  const MONTH = "09";
  const DATA_URL = "data/2026-09.json";
  const MVP_ICONS = {
    medic: "assets/mvp/medic.svg",
    killer: "assets/mvp/killer.svg",
    damage: "assets/mvp/damage.svg",
    antiDeath: "assets/mvp/anti-death.svg",
  };
  const MVP_LABEL = {
    medic: "MVP Medic",
    killer: "MVP Killer",
    damage: "MVP Damage",
    antiDeath: "Anti-MVP Death",
  };

  let matches = [];
  let modalMatch = null;
  let modalTab = "total";
  let modalPlayers = null;
  let sortKey = "kills";
  let sortDir = "desc";

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

  function render(data) {
    document.getElementById("title").textContent = data.title || "КВ — слоты месяца";
    document.getElementById("note").textContent = data.note || "";

    matches = data.matches || [];
    const played = matches.filter((m) => m.status !== "upcoming");
    const upcoming = matches.filter((m) => m.status === "upcoming");
    const wins = played.filter((m) => m.status === "win").length;
    const draws = played.filter((m) => m.status === "draw").length;
    const losses = played.filter((m) => m.status === "lose").length;
    const wr = played.length ? Math.round((100 * wins) / played.length) : 0;

    document.getElementById("stats").innerHTML = [
      ["Всего", matches.length, ""],
      ["Сыграно", played.length, ""],
      ["Впереди", upcoming.length, ""],
      ["W–D–L", `${wins}–${draws}–${losses}`, ""],
      ["Winrate", `${wr}%`, "winrate"],
    ]
      .map(
        ([k, v, cls]) =>
          `<div class="stat ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`
      )
      .join("");

    const tbody = document.getElementById("rows");
    tbody.innerHTML = matches
      .map((m, i) => {
        const st = m.status || "upcoming";
        return `<tr class="${st} clickable" data-i="${i}" tabindex="0" role="button">
          <td>${pad(m.day)}.${MONTH}</td>
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
    modalTitle.textContent = `${pad(m.day)}.${MONTH} vs ${m.opp || "—"}`;
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
      modalBody.innerHTML =
        `<p class="modal-empty">Катка ещё не сыграна — статистики нет.</p>`;
      return;
    }

    if (m.players && Array.isArray(m.players)) {
      modalPlayers = { total: m.players, r1: m.playersR1 || null, r2: m.playersR2 || null };
      labelTabs(m);
      paintPlayers();
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
          // Всегда пересчитываем MVP на клиенте (ничья → KD), файл mvp — канон для ledger.
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
            `Ресы / ноки / килы / смерти / урон возьмём со скринов табло этой катки.</p>`;
        });
      return;
    }

    modalBody.innerHTML =
      `<p class="modal-empty">Статистика игроков ещё не внесена.<br>` +
      `Ресы / ноки / килы / смерти / урон возьмём со скринов табло этой катки.</p>`;
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
    // За раунд: 1 Medic + 1 Killer + 1 Damage + 1 Anti-MVP.
    // Ничья: MVP → выше KD; Anti-MVP Death → ниже KD (хуже играл).
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
    ["medic", "killer", "damage", "antiDeath"].forEach((kind) => {
      const n = counts[kind];
      if (!n) return;
      const cls = kind === "antiDeath" ? "mvp-badge anti" : "mvp-badge";
      const label = n > 1 ? `×${n} ${MVP_LABEL[kind]}` : MVP_LABEL[kind];
      parts.push(
        `<span class="${cls}" title="${escapeHtml(label)}">` +
          `<img src="${MVP_ICONS[kind]}" alt="" width="14" height="14" />` +
          `<span>${escapeHtml(label)}</span>` +
          `</span>`
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
      if (sortKey === "nick") {
        return dir * String(a.nick || "").localeCompare(String(b.nick || ""), "ru");
      }
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
              ${th("dmg", "Урон", "ctr")}
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map((p, i) => {
                const kd = kdValue(p);
                return `<tr>
              <td class="ctr">${i + 1}</td>
              <td>
                <div class="nick-cell">
                  <span class="nick-name">${escapeHtml(p.nick || "—")}</span>
                  ${renderMedals(p.nick)}
                </div>
              </td>
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
    const block =
      modalTab === "r1" ? d.r1 : modalTab === "r2" ? d.r2 : d.total;
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

  function num(v) {
    return v == null || v === "" ? "—" : escapeHtml(v);
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

  fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error("Не удалось загрузить данные");
      return r.json();
    })
    .then(render)
    .catch((err) => {
      document.getElementById("note").textContent = String(err.message || err);
    });
})();
