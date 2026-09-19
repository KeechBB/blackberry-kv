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
          modalPlayers = {
            total: data.total || data.players || [],
            r1: data.r1 || null,
            r2: data.r2 || null,
          };
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
    modalBody.innerHTML = `
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
        </table>
      </div>`;
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
