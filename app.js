(function () {
  const STATUS_RU = {
    win: "победа",
    lose: "поражение",
    draw: "ничья",
    upcoming: "скоро",
  };

  const MONTH = "09";
  const DATA_URL = "data/2026-09.json";

  let matches = [];
  let modalMatch = null;
  let modalTab = "total";
  let modalPlayers = null;

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
          const r1 = data.r1 || null;
          const r2 = data.r2 || null;
          modalPlayers = {
            total: data.total || data.players || sumRounds(r1, r2),
            r1,
            r2,
            details: data.details || null,
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

  function paintPlayers() {
    const hasRounds = !!(modalPlayers.r1 && modalPlayers.r1.length) || !!(modalPlayers.r2 && modalPlayers.r2.length);
    modalTabs.hidden = !hasRounds;
    modalTabs.querySelectorAll(".tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === modalTab);
    });

    let rows = modalPlayers.total || [];
    if (modalTab === "r1" && modalPlayers.r1) rows = modalPlayers.r1;
    if (modalTab === "r2" && modalPlayers.r2) rows = modalPlayers.r2;

    if (!rows.length) {
      modalBody.innerHTML = `<p class="modal-empty">Нет строк для этой вкладки.</p>`;
      return;
    }

    const sorted = rows.slice().sort((a, b) => (b.kills || 0) - (a.kills || 0) || (b.dmg || 0) - (a.dmg || 0));
    const foot = totalsRow(sorted);
    modalBody.innerHTML = `
      ${paintDetails()}
      <div class="players-scroll">
        <table class="players-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Ник</th>
              <th class="num">Ресы</th>
              <th class="num">Ноки</th>
              <th class="num">Килы</th>
              <th class="num">Смерти</th>
              <th class="num">Урон</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map(
                (p, i) => `<tr>
              <td class="ctr">${i + 1}</td>
              <td>${escapeHtml(p.nick || "—")}</td>
              <td class="num">${num(p.res)}</td>
              <td class="num">${num(p.nok)}</td>
              <td class="num">${num(p.kills)}</td>
              <td class="num">${num(p.deaths)}</td>
              <td class="num">${num(p.dmg)}</td>
            </tr>`
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td>Всего</td>
              <td class="num">${num(foot.res)}</td>
              <td class="num">${num(foot.nok)}</td>
              <td class="num">${num(foot.kills)}</td>
              <td class="num">${num(foot.deaths)}</td>
              <td class="num">${num(foot.dmg)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
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
