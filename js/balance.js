import { Store } from './store.js';

const MONTH_NAMES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function labelFromKey(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES_ES[parseInt(m) - 1]} ${y.slice(2)}`;
}

function getMonthData() {
  const months = Store.data.expensesMonths || {};
  const result = [];

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

    result.push({
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

  return result.sort((a, b) => a.key.localeCompare(b.key));
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
