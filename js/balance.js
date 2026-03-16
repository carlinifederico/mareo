import { Store } from './store.js';

const MONTH_NAMES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Historical data from spreadsheet — all values converted to USD
// Months before 2024-03 use approximate USD blue dollar rates of the time
// From 2024-03 onwards, rates come from the spreadsheet
const HISTORICAL = [
  // 2017-2019: USD blue ~17-60 ARS (savings=0 for these months)
  { key:'2017-10', rate:17, income:2647, gastado:3306, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2017-11', rate:17, income:2647, gastado:2786, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-01', rate:19, income:2579, gastado:2352, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-02', rate:20, income:2386, gastado:2298, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-03', rate:20, income:3005, gastado:2695, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-04', rate:21, income:2862, gastado:2550, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-05', rate:25, income:2404, gastado:2119, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-06', rate:28, income:2146, gastado:2020, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-07', rate:29, income:2072, gastado:1754, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-08', rate:34, income:1985, gastado:1834, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-09', rate:40, income:1941, gastado:1713, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-10', rate:38, income:1783, gastado:2095, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-11', rate:38, income:1783, gastado:1744, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2018-12', rate:39, income:1641, gastado:1715, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2019-01', rate:40, income:2500, gastado:2074, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2019-02', rate:41, income:2744, gastado:1781, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2019-03', rate:43, income:2616, gastado:1649, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2019-04', rate:46, income:2446, gastado:1619, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2019-05', rate:48, income:3750, gastado:2357, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2019-06', rate:47, income:3830, gastado:2127, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2019-07', rate:47, income:3830, gastado:1876, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2019-08', rate:60, income:3000, gastado:1480, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2019-09', rate:65, income:3462, gastado:1605, savings:1000, fijos:0, noFijos:0, extras:0 },
  // 2020: USD blue 80-160 ARS
  { key:'2020-01', rate:82, income:3415, gastado:2287, savings:500, fijos:0, noFijos:0, extras:0 },
  { key:'2020-02', rate:85, income:3294, gastado:1823, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2020-03', rate:90, income:3111, gastado:1939, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2020-04', rate:110, income:2545, gastado:1440, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2020-05', rate:125, income:2804, gastado:1414, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2020-06', rate:130, income:3754, gastado:1582, savings:1950, fijos:0, noFijos:0, extras:0 },
  { key:'2020-07', rate:133, income:3317, gastado:1649, savings:1500, fijos:0, noFijos:0, extras:0 },
  { key:'2020-08', rate:138, income:3623, gastado:1257, savings:1500, fijos:0, noFijos:0, extras:0 },
  { key:'2020-09', rate:145, income:3586, gastado:1509, savings:1500, fijos:0, noFijos:0, extras:0 },
  { key:'2020-10', rate:165, income:3515, gastado:1437, savings:1500, fijos:0, noFijos:0, extras:0 },
  { key:'2020-11', rate:160, income:3950, gastado:1460, savings:1500, fijos:0, noFijos:0, extras:0 },
  { key:'2020-12', rate:165, income:3515, gastado:1334, savings:1500, fijos:0, noFijos:0, extras:0 },
  // 2021: USD blue 155-200 ARS
  { key:'2021-01', rate:165, income:3758, gastado:1705, savings:1000, fijos:0, noFijos:0, extras:0 },
  { key:'2021-02', rate:155, income:2581, gastado:1767, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-03', rate:150, income:3717, gastado:2065, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-04', rate:155, income:3474, gastado:1504, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-05', rate:160, income:3366, gastado:1588, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-06', rate:168, income:3521, gastado:1853, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-07', rate:180, income:5539, gastado:2782, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-08', rate:185, income:3784, gastado:1649, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-09', rate:190, income:3747, gastado:2017, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-10', rate:197, income:6039, gastado:3195, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-11', rate:200, income:3850, gastado:1515, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2021-12', rate:208, income:3739, gastado:2478, savings:0, fijos:0, noFijos:0, extras:0 },
  // 2022: USD blue 210-320 ARS
  { key:'2022-01', rate:215, income:3621, gastado:2541, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-02', rate:215, income:4838, gastado:3528, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-03', rate:200, income:5250, gastado:3904, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-04', rate:210, income:4543, gastado:2264, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-05', rate:220, income:4337, gastado:2302, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-06', rate:240, income:4167, gastado:2661, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-07', rate:290, income:4273, gastado:2708, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-08', rate:295, income:4798, gastado:1421, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-09', rate:290, income:4881, gastado:2529, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-10', rate:300, income:4834, gastado:3665, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-11', rate:310, income:4678, gastado:2808, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2022-12', rate:320, income:4532, gastado:2273, savings:0, fijos:0, noFijos:0, extras:0 },
  // 2023: USD blue 380-1000 ARS
  { key:'2023-01', rate:380, income:4534, gastado:2173, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-02', rate:390, income:4697, gastado:1986, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-03', rate:400, income:4579, gastado:2170, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-04', rate:430, income:4466, gastado:2131, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-05', rate:480, income:4736, gastado:2385, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-06', rate:500, income:4547, gastado:2036, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-07', rate:550, income:4379, gastado:2268, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-08', rate:650, income:4194, gastado:1910, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-09', rate:750, income:3634, gastado:2076, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-10', rate:900, income:6144, gastado:1546, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-11', rate:1000, income:6173, gastado:1884, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2023-12', rate:1050, income:5879, gastado:2446, savings:0, fijos:0, noFijos:0, extras:0 },
  // 2024: rates from spreadsheet
  { key:'2024-01', rate:1100, income:5612, gastado:2231, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2024-02', rate:1150, income:6672, gastado:2343, savings:0, fijos:0, noFijos:0, extras:0 },
  { key:'2024-03', rate:1000, income:6998, gastado:2866, savings:3000, fijos:1321, noFijos:300, extras:0 },
  { key:'2024-04', rate:980, income:6946, gastado:2185, savings:3020, fijos:1391, noFijos:182, extras:0 },
  { key:'2024-05', rate:1005, income:6920, gastado:4272, savings:3020, fijos:1630, noFijos:288, extras:0 },
  { key:'2024-06', rate:1185, income:6920, gastado:2704, savings:3020, fijos:1354, noFijos:400, extras:0 },
  { key:'2024-07', rate:1395, income:7000, gastado:2393, savings:3000, fijos:1222, noFijos:571, extras:0 },
  { key:'2024-08', rate:1340, income:7000, gastado:2843, savings:3000, fijos:1340, noFijos:811, extras:692 },
  { key:'2024-09', rate:1280, income:7000, gastado:2918, savings:3000, fijos:1472, noFijos:825, extras:621 },
  { key:'2024-10', rate:1200, income:7000, gastado:3186, savings:3000, fijos:1626, noFijos:921, extras:639 },
  { key:'2024-11', rate:1180, income:6850, gastado:2993, savings:0, fijos:1685, noFijos:308, extras:1000 },
  { key:'2024-12', rate:1080, income:7000, gastado:1899, savings:3000, fijos:1178, noFijos:66, extras:656 },
  // 2025
  { key:'2025-01', rate:1190, income:7000, gastado:2084, savings:4270, fijos:627, noFijos:462, extras:995 },
  { key:'2025-02', rate:1190, income:6973, gastado:2165, savings:4270, fijos:825, noFijos:645, extras:695 },
  { key:'2025-03', rate:1210, income:7000, gastado:3233, savings:2000, fijos:2122, noFijos:388, extras:685 },
  { key:'2025-04', rate:1290, income:7000, gastado:3438, savings:1876, fijos:2032, noFijos:705, extras:700 },
  { key:'2025-05', rate:1180, income:7000, gastado:4291, savings:2051, fijos:2330, noFijos:1262, extras:700 },
  { key:'2025-06', rate:1140, income:7000, gastado:4497, savings:2070, fijos:2459, noFijos:1007, extras:1032 },
  { key:'2025-07', rate:1140, income:7000, gastado:5196, savings:2000, fijos:2532, noFijos:1430, extras:1233 },
  { key:'2025-08', rate:1140, income:7000, gastado:4745, savings:2000, fijos:2591, noFijos:1430, extras:725 },
  { key:'2025-09', rate:1350, income:7000, gastado:4057, savings:1689, fijos:2374, noFijos:1072, extras:612 },
  { key:'2025-10', rate:1350, income:7000, gastado:4186, savings:1689, fijos:2439, noFijos:1222, extras:524 },
  { key:'2025-11', rate:1400, income:7000, gastado:2766, savings:2000, fijos:1052, noFijos:1357, extras:357 },
  { key:'2025-12', rate:1400, income:7000, gastado:5162, savings:2000, fijos:2469, noFijos:2286, extras:407 },
  // 2026
  { key:'2026-01', rate:1400, income:7000, gastado:5164, savings:0, fijos:2471, noFijos:2286, extras:407 },
  { key:'2026-02', rate:1450, income:7000, gastado:4466, savings:2000, fijos:2370, noFijos:1694, extras:402 },
];

function labelFromKey(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES_ES[parseInt(m) - 1]} ${y.slice(2)}`;
}

function getMonthData() {
  const map = new Map();

  for (const h of HISTORICAL) {
    map.set(h.key, { ...h, balance: h.income - h.gastado });
  }

  // Override / add from Store live data (converted to USD)
  const months = Store.data.expensesMonths || {};
  for (const [key, data] of Object.entries(months)) {
    const rate = data.exchangeRate || 0;
    if (rate === 0) continue;

    const totalIncomesUSD = (data.incomes || []).reduce((s, i) => s + (i.amountUSD || 0), 0);
    const savingsUSD = data.savingsUSD || 0;

    let fijos = 0, noFijos = 0, extras = 0;
    for (const sec of (data.sections || [])) {
      const totalARS = sec.items.reduce((s, e) => s + (e.amount || 0), 0);
      const totalUSD = Math.round(totalARS / rate);
      if (sec.name === 'GASTOS FIJOS') fijos = totalUSD;
      else if (sec.name === 'GASTOS NO FIJOS') noFijos = totalUSD;
      else if (sec.name === 'GASTOS EXTRAS') extras = totalUSD;
    }
    const gastado = fijos + noFijos + extras;

    map.set(key, {
      key,
      rate,
      income: totalIncomesUSD,
      gastado,
      savings: savingsUSD,
      fijos,
      noFijos,
      extras,
      balance: totalIncomesUSD - gastado
    });
  }

  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function renderBalance(container) {
  container.innerHTML = '';

  const allData = getMonthData();

  if (allData.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No balance data yet — start tracking expenses to see your history';
    container.appendChild(empty);
    return;
  }

  const years = [...new Set(allData.map(d => d.key.split('-')[0]))].sort();

  const toolbar = document.createElement('div');
  toolbar.className = 'bal-toolbar';

  const yearSelect = document.createElement('select');
  yearSelect.className = 'bal-year-select';
  yearSelect.innerHTML = '<option value="all">Todos</option>';
  for (const y of years) {
    yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
  }
  yearSelect.value = 'all';

  const rangeSelect = document.createElement('select');
  rangeSelect.className = 'bal-year-select';
  rangeSelect.innerHTML = `
    <option value="12">12 meses</option>
    <option value="24" selected>24 meses</option>
    <option value="36">36 meses</option>
    <option value="0">Todo</option>
  `;

  toolbar.innerHTML = '<span class="bal-title">BALANCE MENSUAL (USD)</span>';
  toolbar.appendChild(yearSelect);
  toolbar.appendChild(rangeSelect);
  container.appendChild(toolbar);

  function draw() {
    let filtered = allData;
    if (yearSelect.value !== 'all') {
      filtered = allData.filter(d => d.key.startsWith(yearSelect.value));
    }
    const rangeVal = parseInt(rangeSelect.value);
    if (rangeVal > 0 && yearSelect.value === 'all') {
      filtered = filtered.slice(-rangeVal);
    }
    renderChart(container, filtered);
  }

  yearSelect.addEventListener('change', draw);
  rangeSelect.addEventListener('change', draw);
  draw();
}

function renderChart(container, data) {
  const old = container.querySelector('.bal-chart-wrap');
  if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.className = 'bal-chart-wrap';

  const canvas = document.createElement('canvas');
  canvas.className = 'bal-canvas';
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(data.length * 60, 800);
  const H = 500;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 40, right: 30, bottom: 80, left: 80 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const maxVal = Math.max(...data.map(d => Math.max(d.income, d.gastado, d.fijos + d.noFijos + d.extras)));
  const scale = ch / (maxVal * 1.1 || 1);

  const barW = Math.min(30, (cw / data.length) * 0.6);
  const gap = cw / data.length;

  // Background
  ctx.fillStyle = '#0d0b1a';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  const gridLines = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = '#8b82a8';
  ctx.textAlign = 'right';
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + ch - (ch / gridLines) * i;
    const val = (maxVal * 1.1 / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmtShortUSD(val), pad.left - 8, y + 3);
  }

  // Stacked bars
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const x = pad.left + i * gap + gap / 2;
    const hasBreakdown = d.fijos > 0 || d.noFijos > 0 || d.extras > 0;

    if (hasBreakdown) {
      const hF = d.fijos * scale;
      ctx.fillStyle = 'rgba(248, 113, 113, 0.7)';
      ctx.fillRect(x - barW / 2, pad.top + ch - hF, barW, hF);

      const hNF = d.noFijos * scale;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.7)';
      ctx.fillRect(x - barW / 2, pad.top + ch - hF - hNF, barW, hNF);

      const hE = d.extras * scale;
      ctx.fillStyle = 'rgba(167, 139, 250, 0.7)';
      ctx.fillRect(x - barW / 2, pad.top + ch - hF - hNF - hE, barW, hE);
    } else {
      const hG = d.gastado * scale;
      ctx.fillStyle = 'rgba(248, 113, 113, 0.5)';
      ctx.fillRect(x - barW / 2, pad.top + ch - hG, barW, hG);
    }

    // X labels
    ctx.save();
    ctx.translate(x, pad.top + ch + 8);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#8b82a8';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(labelFromKey(d.key), 0, 0);
    ctx.restore();
  }

  // Income line (green)
  ctx.beginPath();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 2;
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + i * gap + gap / 2;
    const y = pad.top + ch - data[i].income * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + i * gap + gap / 2;
    const y = pad.top + ch - data[i].income * scale;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4ade80';
    ctx.fill();
  }

  // Gastado line (red)
  ctx.beginPath();
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 2;
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + i * gap + gap / 2;
    const y = pad.top + ch - data[i].gastado * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + i * gap + gap / 2;
    const y = pad.top + ch - data[i].gastado * scale;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#f87171';
    ctx.fill();
  }

  // Savings line (blue)
  ctx.beginPath();
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + i * gap + gap / 2;
    const y = pad.top + ch - (data[i].savings || 0) * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < data.length; i++) {
    const x = pad.left + i * gap + gap / 2;
    const y = pad.top + ch - (data[i].savings || 0) * scale;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#60a5fa';
    ctx.fill();
  }

  // Legend
  const legY = 16;
  const legends = [
    { color: '#4ade80', label: 'Income (USD)' },
    { color: '#f87171', label: 'Gastado (USD)' },
    { color: '#60a5fa', label: 'Ahorros (USD)' },
    { color: 'rgba(248, 113, 113, 0.7)', label: 'Fijos' },
    { color: 'rgba(251, 191, 36, 0.7)', label: 'No Fijos' },
    { color: 'rgba(167, 139, 250, 0.7)', label: 'Extras' },
  ];
  let lx = pad.left;
  ctx.font = '11px Inter, sans-serif';
  for (const leg of legends) {
    ctx.fillStyle = leg.color;
    ctx.fillRect(lx, legY - 8, 12, 12);
    ctx.fillStyle = '#f0eef5';
    ctx.textAlign = 'left';
    ctx.fillText(leg.label, lx + 16, legY + 2);
    lx += ctx.measureText(leg.label).width + 36;
  }

  // Tooltip on hover
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.floor((mx - pad.left) / gap);
    if (idx >= 0 && idx < data.length) {
      const d = data[idx];
      canvas.title = `${labelFromKey(d.key)}` +
        `\nIncome: ${fmtFullUSD(d.income)}` +
        `\nGastado: ${fmtFullUSD(d.gastado)}` +
        `\nAhorros: ${fmtFullUSD(d.savings || 0)}` +
        `\nBalance: ${fmtFullUSD(d.balance)}` +
        (d.fijos ? `\n  Fijos: ${fmtFullUSD(d.fijos)}\n  No Fijos: ${fmtFullUSD(d.noFijos)}\n  Extras: ${fmtFullUSD(d.extras)}` : '') +
        (d.rate ? `\nTipo cambio: $${d.rate}` : '');
    } else {
      canvas.title = '';
    }
  });
}

function fmtShortUSD(n) {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + Math.round(n);
}

function fmtFullUSD(n) {
  return 'USD $' + Math.round(n).toLocaleString('en-US');
}
