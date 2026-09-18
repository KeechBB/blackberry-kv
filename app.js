(function () {
  const STATUS_RU = {
    win: "победа",
    lose: "поражение",
    draw: "ничья",
    upcoming: "скоро",
  };

  const MONTH = "09";
  const DATA_URL = "data/2026-09.json";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function render(data) {
    document.getElementById("title").textContent = data.title || "КВ — слоты месяца";
    document.getElementById("note").textContent = data.note || "";

    const matches = data.matches || [];
    const played = matches.filter((m) => m.status !== "upcoming");
    const upcoming = matches.filter((m) => m.status === "upcoming");
    const wins = played.filter((m) => m.status === "win").length;
    const draws = played.filter((m) => m.status === "draw").length;
    const losses = played.filter((m) => m.status === "lose").length;
    const wr = played.length ? Math.round((100 * wins) / played.length) : 0;

    document.getElementById("stats").innerHTML = [
      ["Всего", matches.length],
      ["Сыграно", played.length],
      ["Впереди", upcoming.length],
      ["W–D–L", `${wins}–${draws}–${losses}`],
      ["Winrate", `${wr}%`],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`
      )
      .join("");

    const tbody = document.getElementById("rows");
    tbody.innerHTML = matches
      .map((m) => {
        const st = m.status || "upcoming";
        return `<tr class="${st}">
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
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

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
