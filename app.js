const $ = (sel) => document.querySelector(sel);

const els = {
  fileInput: $("#fileInput"),
  teamFileInput: $("#teamFileInput"),
  txtInput: $("#txtInput"),
  teamTxtInput: $("#teamTxtInput"),
  status: $("#status"),
  output: $("#output"),
  summary: $("#summary"),
  btnLoadSample: $("#btnLoadSample"),
  btnRender: $("#btnRender"),
  btnAssign: $("#btnAssign"),
  chkShowLabels: $("#chkShowLabels"),
  chkCompact: $("#chkCompact"),
};

const SAMPLE_TXT = `# Mỗi dòng: prefix rows cols
# T = bên trái, P = bên phải
T 2 6
T 2 6
P 1 2
P 2 3
P 2 3
P 2 3
`;

function setStatus(lines, isError = false) {
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines ?? "");
  els.status.textContent = text;
  els.status.classList.toggle("err", Boolean(isError));
}

function parseSeatTxt(raw) {
  const input = String(raw ?? "");
  const lines = input.split(/\r?\n/);
  const zones = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const lineNo = i + 1;
    const line = original.trim();

    if (!line) continue;
    if (line.startsWith("#")) continue;

    const parts = line.split(/\s+/).filter(Boolean);

    let side = "T"; // mặc định bên trái nếu không ghi prefix
    let rowsPart;
    let colsPart;

    if (parts.length === 3 && /^[TP]$/i.test(parts[0])) {
      side = parts[0].toUpperCase();
      rowsPart = parts[1];
      colsPart = parts[2];
    } else if (parts.length === 2) {
      // không có prefix: giữ tương thích cũ, hiểu là bên trái
      rowsPart = parts[0];
      colsPart = parts[1];
    } else {
      errors.push(
        `Dòng ${lineNo}: cần dạng "T rows cols" hoặc "P rows cols". Nhận: "${original}"`
      );
      continue;
    }

    const rows = Number(rowsPart);
    const cols = Number(colsPart);

    const isInt = (n) => Number.isFinite(n) && Math.floor(n) === n;
    if (!isInt(rows) || !isInt(cols)) {
      errors.push(`Dòng ${lineNo}: rows/cols phải là số nguyên. Nhận: "${original}"`);
      continue;
    }
    if (rows <= 0 || cols <= 0) {
      errors.push(`Dòng ${lineNo}: rows/cols phải > 0. Nhận: "${original}"`);
      continue;
    }
    if (rows > 200 || cols > 200) {
      errors.push(
        `Dòng ${lineNo}: rows/cols quá lớn (giới hạn 200) để tránh treo trình duyệt. Nhận: "${original}"`
      );
      continue;
    }

    zones.push({ rows, cols, side, lineNo });
  }

  return { zones, errors };
}

function seatLabel(r, c) {
  // 1-based: R1-C1
  return `R${r + 1}-C${c + 1}`;
}

function clearOutput() {
  els.output.innerHTML = "";
  els.summary.textContent = "";
}

let lastZones = [];
let lastAssignment = null;

// --- Team parsing & seating -------------------------------------------------

function parseTeamTxt(raw) {
  const input = String(raw ?? "");
  const lines = input.split(/\r?\n/);
  const teams = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const lineNo = i + 1;
    const line = original.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) {
      errors.push(
        `Team dòng ${lineNo}: cần "TÊN SỐ_LƯỢNG [MÀU_HEX]". Nhận: "${original}"`
      );
      continue;
    }

    const name = parts[0];
    const count = Number(parts[1]);
    let color = parts[2] ?? null;

    if (!Number.isFinite(count) || count <= 0 || Math.floor(count) !== count) {
      errors.push(
        `Team dòng ${lineNo}: SỐ_LƯỢNG phải là số nguyên dương. Nhận: "${original}"`
      );
      continue;
    }

    if (color) {
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
        errors.push(
          `Team dòng ${lineNo}: MÀU_HEX không hợp lệ (ví dụ: #22c55e). Nhận: "${color}"`
        );
        continue;
      }
    } else {
      // auto color palette
      const palette = ["#22c55e", "#f97316", "#3b82f6", "#e11d48", "#a855f7", "#14b8a6"];
      color = palette[teams.length % palette.length];
    }

    teams.push({
      id: teams.length,
      name,
      count,
      remaining: count,
      color,
      lineNo,
    });
  }

  return { teams, errors };
}

function buildSeatsFromZones(zones) {
  const seats = [];
  zones.forEach((z, zoneIndex) => {
    for (let r = 0; r < z.rows; r++) {
      for (let c = 0; c < z.cols; c++) {
        seats.push({
          zoneIndex,
          side: z.side,
          r,
          c,
        });
      }
    }
  });
  return seats;
}

function buildNeighbors(seats, zones) {
  const neighbors = new Array(seats.length).fill(null).map(() => []);

  const keyMap = new Map();
  seats.forEach((s, idx) => {
    const key = `${s.zoneIndex}:${s.r}:${s.c}`;
    keyMap.set(key, idx);
  });

  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  seats.forEach((s, idx) => {
    deltas.forEach(([dr, dc]) => {
      const nr = s.r + dr;
      const nc = s.c + dc;
      const z = zones[s.zoneIndex];
      if (nr < 0 || nr >= z.rows || nc < 0 || nc >= z.cols) return;
      const key = `${s.zoneIndex}:${nr}:${nc}`;
      const nIdx = keyMap.get(key);
      if (nIdx != null) {
        neighbors[idx].push(nIdx);
      }
    });
  });

  return neighbors;
}

function assignTeamsToSeats(zones, teamsInput) {
  // clone teams with remaining
  const teams = teamsInput.map((t, idx) => ({
    ...t,
    id: idx,
    remaining: t.count,
  }));

  const allSeats = buildSeatsFromZones(zones);
  const totalSeats = allSeats.length;
  const totalMembers = teams.reduce((s, t) => s + t.count, 0);

  const warnings = [];
  if (totalMembers > totalSeats) {
    warnings.push(
      `Tổng số member (${totalMembers}) > số ghế (${totalSeats}). Một số thành viên sẽ không có ghế.`
    );
  }

  // Chọn tập ghế "được dùng". Nếu member ít hơn ghế, chỉ dùng
  // một cụm ghế liên tục theo thứ tự vật lý để tránh ghế trống
  // xen giữa hai nhân viên.
  let usableIndexSet = null;
  if (totalMembers < totalSeats) {
    // chọn cụm ghế liên tục, nhưng có thêm thành phần ngẫu nhiên nhỏ
    // để mỗi lần bấm có thể chọn cụm hơi khác nhau
    const baseOrder = allSeats
      .map((s, idx) => ({ ...s, idx, _rand: Math.random() }))
      .sort((a, b) => {
        if (a.side !== b.side) return a.side.localeCompare(b.side);
        if (a.zoneIndex !== b.zoneIndex) return a.zoneIndex - b.zoneIndex;
        if (a.r !== b.r) return a.r - b.r;
        if (a.c !== b.c) return a.c - b.c;
        return a._rand - b._rand;
      });
    usableIndexSet = new Set(baseOrder.slice(0, totalMembers).map((s) => s.idx));
  }

  const seats = allSeats;
  const neighbors = buildNeighbors(seats, zones);

  const assignment = new Array(seats.length).fill(null);

  // Order chỉ những ghế "usable" theo pattern checkerboard để giảm đụng hàng xóm
  const seatOrder = seats
    .map((s, idx) => ({ ...s, idx, _rand: Math.random() }))
    .filter((s) => !usableIndexSet || usableIndexSet.has(s.idx))
    .sort((a, b) => {
      const pa = (a.r + a.c) % 2;
      const pb = (b.r + b.c) % 2;
      if (pa !== pb) return pa - pb;
      if (a.side !== b.side) return a.side.localeCompare(b.side);
      if (a.zoneIndex !== b.zoneIndex) return a.zoneIndex - b.zoneIndex;
      if (a.r !== b.r) return a.r - b.r;
      if (a.c !== b.c) return a.c - b.c;
      // random tie‑breaker để cùng 1 input nhưng nhiều lần bấm vẫn cho layout khác
      return a._rand - b._rand;
    });

  function hasSameTeamNeighbor(seatIdx, teamId) {
    return neighbors[seatIdx].some((nIdx) => assignment[nIdx] === teamId);
  }

  // Vòng 1: cố gắng gán mà không có hàng xóm cùng team
  for (const s of seatOrder) {
    // Lấy các team còn chỗ, ưu tiên team còn nhiều người,
    // nhưng thêm thành phần ngẫu nhiên khi tie để có kết quả khác nhau mỗi lần
    const candidates = teams.filter((t) => t.remaining > 0);
    let chosen = null;

    if (candidates.length) {
      const nonConflict = candidates.filter(
        (t) => !hasSameTeamNeighbor(s.idx, t.id)
      );

      const pickRandomWeighted = (list) => {
        // trọng số theo remaining để team lớn vẫn được rải đều,
        // nhưng thứ tự vẫn ngẫu nhiên
        const total = list.reduce((sum, t) => sum + t.remaining, 0);
        let r = Math.random() * total;
        for (const t of list) {
          if (r < t.remaining) return t;
          r -= t.remaining;
        }
        return list[list.length - 1];
      };

      if (nonConflict.length) {
        chosen = pickRandomWeighted(nonConflict);
      } else {
        // không tránh được, chấp nhận bất kỳ team (weighted) -> có thể vi phạm điều kiện
        chosen = pickRandomWeighted(candidates);
        if (!warnings.find((w) => w.includes("Không thể tránh hoàn toàn"))) {
          warnings.push(
            "Không thể tránh hoàn toàn việc thành viên cùng team ngồi cạnh nhau. Một số ghế sẽ vi phạm điều kiện."
          );
        }
      }

    }

    if (chosen) {
      assignment[s.idx] = chosen.id;
      chosen.remaining -= 1;
    }
  }

  return { seats, assignment, neighbors, teams, warnings };
}

function renderZones(zones, opts, assignmentData) {
  clearOutput();
  if (!zones.length) {
    setStatus(
      ["Không có dữ liệu hợp lệ để vẽ.", "Hãy nhập TXT hoặc bấm “Nạp dữ liệu mẫu”."],
      true
    );
    return;
  }

  const totalSeats = zones.reduce((sum, z) => sum + z.rows * z.cols, 0);
  const leftZones = zones.filter((z) => z.side === "T");
  const rightZones = zones.filter((z) => z.side === "P");

  els.summary.textContent = `${zones.length} khu · ${totalSeats} ghế (T: ${
    leftZones.length
  } · P: ${rightZones.length})`;

  const frag = document.createDocumentFragment();

  const layout = document.createElement("div");
  layout.className = "lrLayout";

  let seatIndexOffsetByZone = [];
  if (assignmentData) {
    let offset = 0;
    zones.forEach((z, zi) => {
      seatIndexOffsetByZone[zi] = offset;
      offset += z.rows * z.cols;
    });
  }

  function getSeatTeam(zi, r, c) {
    if (!assignmentData) return null;
    const { assignment, teams } = assignmentData;
    const base = seatIndexOffsetByZone[zi];
    const idx = base + r * zones[zi].cols + c;
    const teamId = assignment[idx];
    if (teamId == null) return null;
    const team = teams.find((t) => t.id === teamId);
    return team || null;
  }

  function buildSideColumn(titleText, sideLabel, sideZones) {
    const col = document.createElement("div");
    col.className = "sideColumn";

    const title = document.createElement("div");
    title.className = "sideTitle";
    title.textContent = `${titleText} (${sideLabel})`;
    col.appendChild(title);

    if (!sideZones.length) {
      const empty = document.createElement("div");
      empty.className = "zoneMeta muted";
      empty.textContent = "Không có khu nào.";
      col.appendChild(empty);
      return col;
    }

    sideZones.forEach((z, idx) => {
      const zone = document.createElement("div");
      zone.className = "zone";

      const header = document.createElement("div");
      header.className = "zoneHeader";

      const title = document.createElement("div");
      title.className = "zoneTitle";
      title.textContent = `Khu ${idx + 1}`;

      const meta = document.createElement("div");
      meta.className = "zoneMeta";
      meta.textContent = `${z.rows} × ${z.cols} · ${
        z.rows * z.cols
      } ghế (từ dòng ${z.lineNo})`;

      header.appendChild(title);
      header.appendChild(meta);

      const grid = document.createElement("div");
      grid.className = "seatGrid";
      grid.style.gridTemplateColumns = `repeat(${z.cols}, minmax(44px, 1fr))`;
      if (opts.compact) grid.classList.add("compact");

      for (let r = 0; r < z.rows; r++) {
        for (let c = 0; c < z.cols; c++) {
          const seat = document.createElement("div");
          seat.className = "seat";
          if (opts.compact) seat.classList.add("compact");

          const span = document.createElement("span");
          span.className = "labelText";
          span.textContent = opts.showLabels ? seatLabel(r, c) : "";
          seat.appendChild(span);

          const team = getSeatTeam(zones.indexOf(z), r, c);
          if (team) {
            seat.dataset.team = team.name;
            seat.style.background = `linear-gradient(180deg, ${team.color}33, rgba(15,23,42,0.7))`;
            seat.style.borderColor = `${team.color}aa`;

            const tag = document.createElement("span");
            tag.className = "seatTag";
            tag.textContent = team.name;
            seat.appendChild(tag);
          }

          grid.appendChild(seat);
        }
      }

      zone.appendChild(header);
      zone.appendChild(grid);
      col.appendChild(zone);
    });

    return col;
  }

  layout.appendChild(buildSideColumn("Bên trái", "T", leftZones));
  layout.appendChild(buildSideColumn("Bên phải", "P", rightZones));

  frag.appendChild(layout);
  els.output.appendChild(frag);

  const statusLines = [
    "OK. Đã render xong.",
    `Tổng khu: ${zones.length} (T: ${leftZones.length}, P: ${rightZones.length})`,
    `Tổng ghế: ${totalSeats}`,
  ];
  if (assignmentData && assignmentData.warnings?.length) {
    statusLines.push("Cảnh báo:", ...assignmentData.warnings);
  }
  setStatus(statusLines);
}

function getRenderOpts() {
  return {
    showLabels: Boolean(els.chkShowLabels.checked),
    compact: Boolean(els.chkCompact.checked),
  };
}

async function loadFileText(file) {
  // File.text() is broadly supported in modern browsers
  return await file.text();
}

function renderFromTextarea() {
  const raw = els.txtInput.value;
  const { zones, errors } = parseSeatTxt(raw);

  if (errors.length) {
    setStatus(["Có lỗi trong dữ liệu:", ...errors], true);
    // vẫn render phần hợp lệ nếu có
  }
  lastZones = zones;
  lastAssignment = null;
  renderZones(zones, getRenderOpts(), null);
}

function wire() {
  els.btnLoadSample.addEventListener("click", () => {
    els.txtInput.value = SAMPLE_TXT;
    setStatus("Đã nạp dữ liệu mẫu. Bấm “Vẽ sơ đồ”.");
  });

  els.btnRender.addEventListener("click", renderFromTextarea);

  els.chkShowLabels.addEventListener("change", renderFromTextarea);
  els.chkCompact.addEventListener("change", renderFromTextarea);

  els.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await loadFileText(file);
      els.txtInput.value = text;
      setStatus(`Đã đọc file: ${file.name}. Bấm “Vẽ sơ đồ”.`);
    } catch (err) {
      setStatus(`Không đọc được file: ${String(err?.message ?? err)}`, true);
    } finally {
      // allow selecting same file again
      e.target.value = "";
    }
  });

  els.teamFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await loadFileText(file);
      els.teamTxtInput.value = text;
      setStatus(`Đã đọc file team: ${file.name}. Bấm “Sắp xếp chỗ ngồi theo team”.`);
    } catch (err) {
      setStatus(`Không đọc được file team: ${String(err?.message ?? err)}`, true);
    } finally {
      e.target.value = "";
    }
  });

  els.btnAssign.addEventListener("click", () => {
    if (!lastZones.length) {
      setStatus(
        "Chưa có sơ đồ ghế. Hãy nhập/đọc file sơ đồ, bấm “Vẽ sơ đồ”, sau đó mới sắp xếp team.",
        true
      );
      return;
    }

    const { teams, errors } = parseTeamTxt(els.teamTxtInput.value);
    if (!teams.length) {
      setStatus(
        errors.length
          ? ["Không có team hợp lệ:", ...errors]
          : "Không có team hợp lệ. Hãy nhập dữ liệu team.",
        true
      );
      return;
    }

    const assignResult = assignTeamsToSeats(lastZones, teams);
    lastAssignment = assignResult;
    renderZones(lastZones, getRenderOpts(), assignResult);
  });

  // initial
  els.txtInput.value = SAMPLE_TXT;
  setStatus("Sẵn sàng. Bạn có thể sửa TXT rồi bấm “Vẽ sơ đồ”.");
}

wire();
