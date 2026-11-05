"use strict";

const ALL_CARE = "all_care";
const BREAKS = [80, 90, 97, 103, 110, 120];
const COLORS = ["#1f6aa8", "#6ea6d6", "#bcd7ec", "#e9e8e4", "#f3c1ad", "#df7a62", "#b3312c"];
const RULER_MIN = 60;
const RULER_MAX = 160;
const RELIABILITY = ["참고용", "낮음", "보통", "높음"];
const VERSUS = { "-1": "낮음", 0: "비슷", 1: "높음" };
const AGE_NAMES = { all: "전 연령", "80+": "80세 이상" };
const SIDO_LABELS = [
  ["서울", 37.56, 126.98], ["인천", 37.47, 126.5], ["경기", 37.75, 127.2], ["강원", 37.75, 128.3],
  ["충북", 36.8, 127.8], ["충남", 36.5, 126.75], ["세종", 36.6, 127.26], ["대전", 36.35, 127.39],
  ["전북", 35.72, 127.15], ["광주", 35.16, 126.85], ["전남", 34.8, 126.95], ["경북", 36.35, 128.85],
  ["대구", 35.87, 128.6], ["울산", 35.55, 129.25], ["경남", 35.33, 128.2], ["부산", 35.18, 129.05],
  ["제주", 33.38, 126.55],
];

const state = {
  indicator: "hypertension", age: "all", year: "", mode: "std", code: null, view: "map",
  sort: { key: "index", direction: -1 },
};

let DATA = null;
let map = null;
let regionLayer = null;
const layers = {};
const $ = (id) => document.getElementById(id);
const fmt = (value, digits = 0) => Number(value).toLocaleString("ko-KR", {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const isCare = () => state.indicator === ALL_CARE;
const indicator = () => DATA.indicators.find((item) => item.id === state.indicator);
const femaleBase = () => !isCare() && indicator().denominator === "female";
const unitLabel = () => (femaleBase() ? "여성 10만 명당" : "10만 명당");
const hasModes = () => !isCare() || state.age === "all";
const regionTitle = (code) => {
  const region = DATA.regions[code];
  return region.sido === "세종" ? "세종시" : `${region.sido} ${region.name}`;
};

function ageName(age) {
  return AGE_NAMES[age] || `${age.replace("-", "~")}세`;
}

function indicatorName() {
  if (!isCare()) return indicator().name_ko;
  return state.age === "all" ? "전체 진료" : `${ageName(state.age)} 전체 진료`;
}

function record(code, year = state.year) {
  if (isCare()) {
    const row = DATA.care[state.age][year][code];
    return {
      patients: row[0], population: row[1], rate: row[2], crude: row[3], std: row[4],
      low: row[5], high: row[6], versus: row[7], reliability: row[8],
      national: DATA.careNational[state.age][year],
    };
  }
  const row = DATA.disease[state.indicator][year][code];
  return {
    patients: row[0], population: row[1], rate: row[2], crude: row[5], std: row[6],
    low: row[7], high: row[8], versus: row[9], reliability: row[10], change: row[11], trend: row[12],
    national: DATA.national[state.indicator][year],
  };
}

function indexOf(row) {
  return state.mode === "std" || !hasModes() ? row.std : row.crude;
}

function colorOf(value) {
  const position = BREAKS.findIndex((limit) => value < limit);
  return COLORS[position === -1 ? COLORS.length - 1 : position];
}

function rulerPercent(value) {
  const clamped = Math.min(RULER_MAX, Math.max(RULER_MIN, value));
  return ((clamped - RULER_MIN) / (RULER_MAX - RULER_MIN)) * 100;
}

function rulerStrip() {
  const stops = [RULER_MIN, ...BREAKS, RULER_MAX];
  return COLORS.map((color, i) => {
    const width = rulerPercent(stops[i + 1]) - rulerPercent(stops[i]);
    return `<i style="background:${color};flex:${width} 1 0"></i>`;
  }).join("");
}

/* 조작부 */

function buildControls() {
  const groups = [
    ["전체", [{ id: ALL_CARE, name_ko: "전체 진료" }]],
    ["암", DATA.indicators.filter((item) => item.category === "cancer")],
    ["주요질환", DATA.indicators.filter((item) => item.category === "chronic")],
  ];
  $("indicators").innerHTML = groups.map(([title, items]) => `
    <div class="indicator-group"><h3>${title}</h3>
      ${items.map((item) => `<button type="button" data-id="${item.id}">${esc(item.name_ko)}</button>`).join("")}
    </div>`).join("");
  $("indicators").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.indicator = button.dataset.id;
    if (!isCare()) state.age = "all";
    render();
  });

  $("age").innerHTML = DATA.ages.map((age) => `<option value="${age}">${ageName(age)}</option>`).join("");
  $("age").addEventListener("change", (event) => { state.age = event.target.value; render(); });

  $("years").innerHTML = DATA.years.map((year) => `
    <label><input type="radio" name="year" value="${year}"><span>${year}</span></label>`).join("");
  $("years").addEventListener("change", (event) => { state.year = event.target.value; render(); });

  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener("change", () => { state.mode = input.value; render(); });
  });

  document.querySelectorAll(".view-switch button").forEach((button) => {
    button.addEventListener("click", () => { state.view = button.dataset.view; render(); });
  });

  const names = Object.keys(DATA.regions).map((code) => [regionTitle(code), code])
    .sort((a, b) => a[0].localeCompare(b[0], "ko"));
  $("region-list").innerHTML = names.map(([name]) => `<option value="${esc(name)}"></option>`).join("");
  const lookup = new Map(names);
  const pick = () => {
    const typed = $("search").value.trim();
    const match = lookup.get(typed)
      || names.filter(([name]) => name.includes(typed)).map(([, code]) => code)[0];
    if (typed && match) {
      selectRegion(match);
      $("search").value = "";
      $("status").textContent = "";
    } else if (typed) {
      $("status").textContent = `'${typed}' 지역을 찾지 못했습니다. 시군구 이름을 확인하세요.`;
    }
  };
  $("search").addEventListener("change", pick);
}

function syncControls() {
  document.querySelectorAll("#indicators button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.id === state.indicator));
  });
  $("age").value = state.age;
  $("age").disabled = !isCare();
  $("age-help").textContent = isCare() ? "" : "이 지표는 연령별 자료가 없어 전 연령만 볼 수 있습니다.";
  document.querySelectorAll('input[name="year"]').forEach((input) => { input.checked = input.value === state.year; });
  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.disabled = !hasModes();
    input.checked = input.value === (hasModes() ? state.mode : "std");
  });
  $("mode-help").textContent = !hasModes()
    ? "연령대를 고르면 같은 나이끼리 비교하므로 보정이 필요 없습니다."
    : state.mode === "std"
      ? "지역의 나이 구조가 전국과 같다고 가정해 비교합니다."
      : "나이 구조를 고려하지 않아 고령 인구가 많은 지역이 높게 나옵니다.";
  document.querySelectorAll(".view-switch button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  });
  $("map-view").hidden = state.view !== "map";
  $("table-view").hidden = state.view !== "table";
}

/* 지도 */

function styleFor(feature) {
  const code = feature.properties.unit_code;
  const row = record(code);
  const selected = code === state.code;
  return {
    fillColor: row.reliability === 0 ? "url(#hatch)" : colorOf(indexOf(row)),
    fillOpacity: 1,
    color: selected ? "#16302b" : "#ffffff",
    weight: selected ? 2.5 : 0.5,
  };
}

function tooltipHtml(code) {
  const row = record(code);
  const tag = row.reliability === 0 ? " (참고용)" : "";
  return `<strong>${esc(regionTitle(code))}</strong><br>지수 ${fmt(indexOf(row), 1)}${tag}<br>${unitLabel()} ${fmt(row.rate)}명`;
}

function addHatchPattern() {
  const svg = document.querySelector("#map svg");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="#e9e8e4"></rect><rect width="1.6" height="6" fill="#8b9a96"></rect></pattern>`;
  svg.prepend(defs);
}

function buildMap(boundaries) {
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  map = L.map("map", {
    zoomSnap: 0.25, minZoom: 5.5, maxZoom: 11, attributionControl: false,
    maxBounds: [[31.5, 122.5], [40, 133.5]], dragging: !mobile, zoomControl: true,
  });
  map.zoomControl.setPosition("topright");
  L.control.attribution({ prefix: false, position: "bottomright" }).addTo(map)
    .addAttribution("경계: 국가데이터처 SGIS 2025년 2분기");
  map.createPane("sidoLines").style.zIndex = 450;
  map.getPane("sidoLines").style.pointerEvents = "none";

  const fit = () => map.fitBounds([[33.1, 125.1], [38.65, 131.9]], { padding: [6, 6] });
  fit();

  regionLayer = L.geoJSON(boundaries, {
    style: styleFor,
    onEachFeature(feature, layer) {
      const code = feature.properties.unit_code;
      layers[code] = layer;
      layer.bindTooltip(() => tooltipHtml(code), { sticky: true, className: "region-tip", direction: "auto" });
      layer.on("click", () => selectRegion(code, { pan: false }));
      layer.on("mouseover", () => layer.setStyle({ weight: 2, color: "#16302b" }));
      layer.on("mouseout", () => layer.setStyle(styleFor(feature)));
    },
  }).addTo(map);
  addHatchPattern();

  SIDO_LABELS.forEach(([name, lat, lng]) => {
    L.marker([lat, lng], {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: "sido-label", html: name, iconSize: [36, 16], iconAnchor: [18, 8] }),
    }).addTo(map);
  });

  const zoomClass = () => $("map").classList.toggle("far", map.getZoom() < 6.5);
  map.on("zoomend", zoomClass);
  zoomClass();
  new ResizeObserver(() => map.invalidateSize()).observe($("map"));

  fetch("data/sido.json").then((response) => response.json()).then((lines) => {
    L.geoJSON(lines, {
      pane: "sidoLines", interactive: false,
      style: { color: "#16302b", weight: 1, opacity: 0.55, fill: false },
    }).addTo(map);
  }).catch(() => {});
}

function repaint() {
  regionLayer.eachLayer((layer) => {
    layer.setStyle(styleFor(layer.feature));
    if (layer.feature.properties.unit_code === state.code) layer.bringToFront();
  });
}

function renderLegend() {
  const ticks = BREAKS.map((value, i) => {
    const left = ((i + 1) / COLORS.length) * 100;
    return `<span class="ruler-tick" style="left:${left}%">${value}</span>`;
  }).join("");
  const segments = COLORS.map((color) => `<i style="background:${color}"></i>`).join("");
  $("legend").innerHTML = `
    <div class="legend-title">전국 평균을 100으로 본 지수</div>
    <div class="legend-scale">
      <div class="ruler">${ticks}${segments}</div>
      <div class="legend-foot"><span>전국보다 낮음</span><span>전국보다 높음</span></div>
    </div>
    <div class="legend-ref"><span class="hatch"></span><span>참고용: 인구나 환자가 적어 값이 불안정</span></div>`;
}

/* 표 */

const COLUMNS = [
  ["name", "지역", (code) => regionTitle(code)],
  ["rate", () => `${unitLabel()} 진료인원`, (code, row) => fmt(row.rate)],
  ["index", "지수", (code, row) => fmt(indexOf(row), 1)],
  ["range", "95% 구간", (code, row) => (hasModes() && state.mode === "crude" ? "-" : `${fmt(row.low, 1)}~${fmt(row.high, 1)}`)],
  ["versus", "전국 대비", (code, row) => VERSUS[row.versus]],
  ["reliability", "신뢰도", (code, row) => RELIABILITY[row.reliability]],
];

function sortValue(code, row, key) {
  if (key === "name") return regionTitle(code);
  if (key === "index") return indexOf(row);
  if (key === "range") return row.high - row.low;
  return row[key];
}

function renderTable() {
  const { key, direction } = state.sort;
  const rows = Object.keys(DATA.regions).map((code) => [code, record(code)]).sort((a, b) => {
    const left = sortValue(a[0], a[1], key);
    const right = sortValue(b[0], b[1], key);
    return (typeof left === "string" ? left.localeCompare(right, "ko") : left - right) * direction;
  });
  const head = COLUMNS.map(([id, title]) => {
    const label = typeof title === "function" ? title() : title;
    const sort = id === key ? ` aria-sort="${direction > 0 ? "ascending" : "descending"}"` : "";
    return `<th scope="col"${sort}><button type="button" data-sort="${id}">${label}</button></th>`;
  }).join("");
  const body = rows.map(([code, row]) => {
    const classes = [code === state.code ? "is-selected" : "", row.reliability === 0 ? "is-ref" : ""].join(" ");
    const cells = COLUMNS.map(([id, , read], i) => (i === 0
      ? `<td><button type="button" data-code="${code}">${esc(read(code, row))}</button></td>`
      : `<td>${read(code, row)}</td>`)).join("");
    return `<tr class="${classes}" data-code="${code}">${cells}</tr>`;
  }).join("");
  $("table-view").innerHTML = `<table><caption>${esc(indicatorName())}, ${state.year}년. 제목을 누르면 정렬합니다.</caption>
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

$("table-view").addEventListener("click", (event) => {
  const sort = event.target.closest("[data-sort]");
  if (sort) {
    const key = sort.dataset.sort;
    state.sort = { key, direction: state.sort.key === key ? -state.sort.direction : key === "name" ? 1 : -1 };
    renderTable();
    return;
  }
  const row = event.target.closest("[data-code]");
  if (row) selectRegion(row.dataset.code, { pan: false });
});

/* 지역 패널 */

function selectRegion(code, { pan = true } = {}) {
  state.code = code;
  render();
  if (pan && map && state.view === "map" && layers[code]) {
    map.fitBounds(layers[code].getBounds(), { maxZoom: 9.5, padding: [40, 40] });
  }
  if (window.matchMedia("(max-width: 1100px)").matches) {
    document.querySelector(".panel").scrollIntoView({ block: "start" });
  }
}

function readingText(row, value) {
  const gap = Math.abs(value - 100);
  const direction = value >= 100 ? "많습니다" : "적습니다";
  const base = hasModes() && state.mode === "std" ? "나이 구조를 감안한 기대치보다" : "전국 평균보다";
  const lead = gap < 0.5 ? "전국 평균과 거의 같습니다." : `${base} ${fmt(gap, 1)}% ${direction}.`;
  if (row.reliability === 0) return `${lead} 인구나 환자가 적어 해마다 크게 달라질 수 있으니 참고만 하세요.`;
  if (hasModes() && state.mode === "crude") return `${lead} 나이 구조를 보정하지 않은 값입니다.`;
  if (row.versus === 0) return `${lead} 다만 우연한 변동 범위 안이라 전국과 비슷하다고 봅니다.`;
  return `${lead} 우연한 변동 범위를 벗어난 차이입니다.`;
}

function gaugeHtml(row, value) {
  const showRange = !hasModes() || state.mode === "std";
  const left = rulerPercent(row.low);
  const right = rulerPercent(row.high);
  const labels = [80, 100, 120, 140].map((tick) => `
    <span class="${tick === 100 ? "mid" : ""}" style="left:${rulerPercent(tick)}%">${tick}</span>`).join("");
  return `<div class="gauge">
      <div class="ruler">${rulerStrip()}</div>
      ${showRange ? `<span class="gauge-ci" style="left:${left}%;width:${Math.max(right - left, 0.6)}%"></span>` : ""}
      <span class="gauge-mark" style="left:${rulerPercent(value)}%"></span>
    </div>
    <div class="gauge-labels">${labels}</div>`;
}

function trendHtml(code) {
  const years = DATA.years;
  const local = years.map((year) => record(code, year).rate);
  const national = years.map((year) => record(code, year).national);
  const all = [...local, ...national];
  const low = Math.min(...all);
  const high = Math.max(...all);
  const pad = (high - low || high * 0.05) * 0.18;
  const [width, height, left, right, top, bottom] = [300, 124, 8, 8, 14, 22];
  const x = (i) => left + (i / (years.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - (value - low + pad) / (high - low + 2 * pad)) * (height - top - bottom);
  const line = (values) => values.map((value, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const dots = local.map((value, i) => `<circle cx="${x(i)}" cy="${y(value)}" r="4" fill="#16302b" stroke="#fbfcfb" stroke-width="2">
      <title>${years[i]}년 이 지역 ${fmt(value)}명, 전국 ${fmt(national[i])}명</title></circle>`).join("");
  const axis = years.map((year, i) => `<text x="${x(i)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === years.length - 1 ? "end" : "middle"}" font-size="11" fill="#4f6660">${year}</text>`).join("");
  const edge = years.length - 1;
  const description = `${years[0]}년 ${fmt(local[0])}명에서 ${years[edge]}년 ${fmt(local[edge])}명으로 변했습니다. 전국은 ${fmt(national[0])}명에서 ${fmt(national[edge])}명입니다.`;
  return `<div class="trend-key"><span><i></i>이 지역</span><span class="nat"><i></i>전국</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${description}">
      <path d="${line(national)}" fill="none" stroke="#7c8f8a" stroke-width="2" stroke-dasharray="5 4"></path>
      <path d="${line(local)}" fill="none" stroke="#16302b" stroke-width="2"></path>
      ${dots}${axis}
      <text x="${x(0) + 4}" y="${y(local[0]) - 8}" font-size="11" fill="#16302b">${fmt(local[0])}</text>
      <text x="${x(edge) - 4}" y="${y(local[edge]) - 8}" font-size="11" fill="#16302b" text-anchor="end">${fmt(local[edge])}</text>
    </svg>`;
}

function trendNote(code) {
  if (isCare()) return "";
  const row = record(code, DATA.years[DATA.years.length - 1]);
  if (row.trend === null || row.trend === undefined) return "";
  const text = { 1: "전국 대비 위치가 2021년보다 높아졌습니다", 0: "전국 대비 위치는 2021년과 뚜렷한 차이가 없습니다", "-1": "전국 대비 위치가 2021년보다 낮아졌습니다" }[row.trend];
  const sign = row.change > 0 ? "+" : "";
  return `<p class="trend-note">${text} (지수 ${sign}${fmt(row.change, 1)}).</p>`;
}

function renderRegion(code) {
  const region = DATA.regions[code];
  const row = record(code);
  const value = indexOf(row);
  const badge = row.reliability === 0
    ? '<span class="badge ref">참고용</span>'
    : `<span class="badge">${RELIABILITY[row.reliability]}</span>`;
  const rangeFact = !hasModes() || state.mode === "std"
    ? `<dt>지수 95% 구간</dt><dd>${fmt(row.low, 1)}~${fmt(row.high, 1)}</dd>` : "";
  $("panel").innerHTML = `
    <p class="panel-sido">${region.sido === "세종" ? "세종특별자치시" : esc(region.sido)}</p>
    <h2 class="panel-name">${esc(region.name)}</h2>
    <p class="panel-metric">${esc(indicatorName())}, ${state.year}년</p>
    <div class="index-big">${fmt(value, 1)}<small>전국 평균 100 기준</small></div>
    ${gaugeHtml(row, value)}
    <p class="reading">${readingText(row, value)}</p>
    <dl class="facts">
      <dt>${unitLabel()} 진료인원</dt><dd>${fmt(row.rate)}명</dd>
      <dt>전국</dt><dd>${fmt(row.national)}명</dd>
      <dt>연간 진료인원</dt><dd>${fmt(row.patients)}명</dd>
      <dt>${femaleBase() ? "여성 적용인구" : "적용인구"}</dt><dd>${fmt(row.population)}명</dd>
      ${rangeFact}
      <dt>신뢰도</dt><dd>${badge}</dd>
    </dl>
    <h3>해마다 어떻게 달라졌나요</h3>
    <div class="trend-chart">${trendHtml(code)}</div>
    ${trendNote(code)}
    <button type="button" class="clear" id="clear-region">지역 선택 해제</button>`;
  $("clear-region").addEventListener("click", () => { state.code = null; render(); });
}

function renderOverview() {
  const rows = Object.keys(DATA.regions).map((code) => [code, record(code)]).filter(([, row]) => row.reliability > 0);
  rows.sort((a, b) => indexOf(b[1]) - indexOf(a[1]));
  const list = (items) => `<ol class="rank">${items.map(([code, row]) => `
    <li><button type="button" data-code="${code}"><span>${esc(regionTitle(code))}</span><b>${fmt(indexOf(row), 1)}</b></button></li>`).join("")}</ol>`;
  $("panel").innerHTML = `<div class="panel-empty">
    <h2>지역을 골라 보세요</h2>
    <p>지도를 누르거나 위에서 시군구 이름을 찾으면 자세한 수치가 나옵니다.</p>
    <h3>지수가 높은 지역</h3>${list(rows.slice(0, 5))}
    <h3>지수가 낮은 지역</h3>${list(rows.slice(-5).reverse())}
  </div>`;
}

$("panel").addEventListener("click", (event) => {
  const button = event.target.closest("[data-code]");
  if (button) selectRegion(button.dataset.code);
});

/* 화면 전체 */

function renderHead() {
  $("stage-title").textContent = `${indicatorName()} ${state.year}년`;
  const base = !hasModes() ? "같은 연령대의 전국 평균과 비교" : state.mode === "std" ? "나이 구조를 보정한 지수" : "보정하지 않은 지수";
  $("stage-sub").textContent = `${base}. 값은 진료받은 사람 수이며 발생 환자 수가 아닙니다.`;
  const note = isCare() ? "" : indicator().note;
  $("notice").textContent = note;
  $("notice").hidden = !note;
}

function saveHash() {
  const params = new URLSearchParams({ i: state.indicator, y: state.year });
  if (state.age !== "all") params.set("a", state.age);
  if (state.mode !== "std") params.set("m", state.mode);
  if (state.code) params.set("r", state.code);
  history.replaceState(null, "", `#${params}`);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("i");
  if (id === ALL_CARE || DATA.indicators.some((item) => item.id === id)) state.indicator = id;
  if (DATA.years.includes(params.get("y"))) state.year = params.get("y");
  if (isCare() && DATA.ages.includes(params.get("a"))) state.age = params.get("a");
  if (params.get("m") === "crude") state.mode = "crude";
  if (DATA.regions[params.get("r")]) state.code = params.get("r");
}

function render() {
  syncControls();
  renderHead();
  if (regionLayer) repaint();
  if (state.view === "table") renderTable();
  if (state.view === "map" && map) requestAnimationFrame(() => map.invalidateSize());
  if (state.code) renderRegion(state.code); else renderOverview();
  saveHash();
}

async function start() {
  try {
    const [metrics, boundaries] = await Promise.all([
      fetch("data/metrics.json").then((response) => response.json()),
      fetch("data/boundaries.json").then((response) => response.json()),
    ]);
    DATA = metrics;
    state.year = DATA.years[DATA.years.length - 1];
    readHash();
    buildControls();
    renderLegend();
    buildMap(boundaries);
    render();
  } catch (error) {
    $("status").textContent = "자료를 불러오지 못했습니다. 페이지를 새로 고치세요.";
    console.error(error);
  }
}

start();
