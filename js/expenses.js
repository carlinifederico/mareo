import { Store } from './store.js';
import { icon } from './icons.js';

const PAYMENT_METHODS = ['CASH', 'LEMON', 'BBVA', 'MP', 'TRANSFER', 'OTHER'];
const MONTH_NAMES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES_ES[parseInt(m) - 1]} ${y}`;
}

export function ensureCurrentMonth() {
  if (!Store.data.expensesMonths) Store.data.expensesMonths = {};

  const key = currentMonthKey();
  if (!Store.data.expensesMonths[key]) {
    const keys = Object.keys(Store.data.expensesMonths).sort();
    const prevKey = keys.length > 0 ? keys[keys.length - 1] : null;

    const newMonth = createEmptyMonth();

    if (prevKey) {
      const prev = Store.data.expensesMonths[prevKey];
      newMonth.savingsUSD = prev.savingsUSD || 0;
      newMonth.exchangeRate = prev.exchangeRate || 0;
      if (prev.incomes && prev.incomes.length > 0) {
        newMonth.incomes = prev.incomes.map(inc => ({
          id: 'inc-' + crypto.randomUUID(),
          source: inc.source,
          amountUSD: 0,
          fees: inc.fees || ''
        }));
      }
      for (const section of prev.sections) {
        const targetSection = newMonth.sections.find(s => s.name === section.name);
        if (!targetSection) continue;
        for (const item of section.items) {
          if (item.recurring) {
            targetSection.items.push({
              ...item,
              id: 'ei-' + crypto.randomUUID(),
              paid: false
            });
          }
        }
      }
    }

    Store.data.expensesMonths[key] = newMonth;
    if (!Store.data.currentExpenseMonth) Store.data.currentExpenseMonth = key;
    Store.save();
  }

  if (!Store.data.currentExpenseMonth) {
    Store.data.currentExpenseMonth = key;
    Store.save();
  }
}

function createEmptyMonth() {
  return {
    exchangeRate: 0,
    savingsUSD: 0,
    incomes: [],
    sections: [
      { name: 'GASTOS FIJOS', items: [] },
      { name: 'GASTOS NO FIJOS', items: [] },
      { name: 'GASTOS EXTRAS', items: [] }
    ],
    payments: []
  };
}

export function renderExpenses(container) {
  container.innerHTML = '';
  ensureCurrentMonth();

  const allKeys = Object.keys(Store.data.expensesMonths).sort();
  const activeKey = Store.data.currentExpenseMonth || currentMonthKey();
  const data = Store.data.expensesMonths[activeKey] || createEmptyMonth();

  if (!data.incomes) data.incomes = [];

  const rate = data.exchangeRate || 0;

  // === MONTH NAVIGATOR + EXCHANGE RATE + SAVINGS ===
  const nav = document.createElement('div');
  nav.className = 'exp-month-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-secondary';
  prevBtn.innerHTML = icon('chevron-left');
  const idx = allKeys.indexOf(activeKey);
  prevBtn.disabled = idx <= 0;
  prevBtn.addEventListener('click', () => {
    if (idx > 0) {
      Store.data.currentExpenseMonth = allKeys[idx - 1];
      Store.save();
      document.dispatchEvent(new Event('mareo:render'));
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-secondary';
  nextBtn.innerHTML = icon('chevron-right');
  nextBtn.disabled = idx >= allKeys.length - 1;
  nextBtn.addEventListener('click', () => {
    if (idx < allKeys.length - 1) {
      Store.data.currentExpenseMonth = allKeys[idx + 1];
      Store.save();
      document.dispatchEvent(new Event('mareo:render'));
    }
  });

  const monthTitle = document.createElement('span');
  monthTitle.className = 'exp-month-title';
  monthTitle.textContent = monthLabel(activeKey);
  if (activeKey === currentMonthKey()) monthTitle.classList.add('current');

  const todayBtn = document.createElement('button');
  todayBtn.className = 'btn btn-secondary exp-today-btn';
  todayBtn.textContent = 'Hoy';
  todayBtn.addEventListener('click', () => {
    Store.data.currentExpenseMonth = currentMonthKey();
    Store.save();
    document.dispatchEvent(new Event('mareo:render'));
  });

  const rateGroup = document.createElement('div');
  rateGroup.className = 'exp-rate-group';
  rateGroup.innerHTML = `
    <span class="exp-rate-label">USD→ARS</span>
    <input type="number" class="exp-rate-input" value="${data.exchangeRate || 0}" id="exp-exchange-rate">
  `;

  const savingsGroup = document.createElement('div');
  savingsGroup.className = 'exp-rate-group';
  savingsGroup.innerHTML = `
    <span class="exp-rate-label">AHORROS USD</span>
    <input type="number" class="exp-rate-input" value="${data.savingsUSD || 0}" id="exp-savings">
  `;

  nav.appendChild(prevBtn);
  nav.appendChild(monthTitle);
  nav.appendChild(nextBtn);
  nav.appendChild(rateGroup);
  nav.appendChild(savingsGroup);
  nav.appendChild(todayBtn);
  container.appendChild(nav);

  const rateInput = nav.querySelector('#exp-exchange-rate');
  rateInput.addEventListener('change', (e) => {
    data.exchangeRate = parseFloat(e.target.value) || 0;
    saveMonth(activeKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  rateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') rateInput.blur(); });

  const savingsInput = nav.querySelector('#exp-savings');
  savingsInput.addEventListener('change', (e) => {
    data.savingsUSD = parseFloat(e.target.value) || 0;
    saveMonth(activeKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  savingsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') savingsInput.blur(); });

  // === INCOMES + OUTCOMES SIDE BY SIDE ===
  const totalIncomesUSD = (data.incomes || []).reduce((s, inc) => s + (inc.amountUSD || 0), 0);
  const totalDisponible = (totalIncomesUSD - (data.savingsUSD || 0)) * rate;

  const ioRow = document.createElement('div');
  ioRow.className = 'exp-io-row';

  renderIncomes(ioRow, activeKey, data, rate);
  renderPayments(ioRow, activeKey, data, rate, totalDisponible);

  container.appendChild(ioRow);

  // === SUMMARY CARDS ===
  const allItems = [];
  for (const section of data.sections) {
    for (const item of section.items) allItems.push(item);
  }
  const totalGastado = allItems.reduce((s, e) => s + (e.amount || 0), 0);
  const quedan = totalDisponible - totalGastado;
  const weeksLeft = activeKey === currentMonthKey() ? weeksRemainingInMonth() : 4;
  const gastarXSemana = weeksLeft > 0 ? Math.round(quedan / weeksLeft) : 0;

  const summary = document.createElement('div');
  summary.className = 'exp-summary-cards';
  summary.innerHTML = `
    <div class="exp-card">
      <div class="exp-card-label">Total</div>
      <div class="exp-card-value">${fmtARS(totalDisponible)}</div>
    </div>
    <div class="exp-card exp-card-danger">
      <div class="exp-card-label">Gastado</div>
      <div class="exp-card-value">${fmtARS(totalGastado)}</div>
    </div>
    <div class="exp-card exp-card-success">
      <div class="exp-card-label">Quedan</div>
      <div class="exp-card-value">${fmtARS(quedan)}</div>
    </div>
    <div class="exp-card exp-card-warn">
      <div class="exp-card-label">Gastar x Semana</div>
      <div class="exp-card-value">${fmtARS(gastarXSemana)}</div>
    </div>
  `;
  container.appendChild(summary);

  // === SECTIONS ===
  const sectionsContainer = document.createElement('div');
  sectionsContainer.className = 'exp-sections';

  for (const section of data.sections) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'exp-section';
    const sectionTotal = section.items.reduce((s, e) => s + (e.amount || 0), 0);

    const header = document.createElement('div');
    header.className = 'exp-section-header';
    header.innerHTML = `
      <span class="exp-section-name">${section.name}</span>
      <span class="exp-section-total">Total: ${fmtARS(sectionTotal)}</span>
      <button class="btn btn-secondary exp-add-item-btn">+ Add</button>
    `;
    header.querySelector('.exp-add-item-btn').addEventListener('click', () => {
      section.items.push({
        id: 'ei-' + crypto.randomUUID(),
        name: '', amount: 0,
        paid: false, recurring: false,
        method: 'CASH', notes: ''
      });
      saveMonth(activeKey, data);
      document.dispatchEvent(new Event('mareo:render'));
    });
    sectionEl.appendChild(header);

    const table = document.createElement('table');
    table.className = 'exp-table';
    table.innerHTML = `<thead><tr>
      <th class="col-name">Name</th>
      <th class="col-montos">Monto</th>
      <th class="col-check"></th>
      <th class="col-method">Method</th>
      <th class="col-notes">Notes</th>
      <th class="col-del"></th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    for (let ii = 0; ii < section.items.length; ii++) {
      const item = section.items[ii];
      const tr = document.createElement('tr');
      if (item.paid) tr.classList.add('row-paid');
      if (item.recurring) tr.classList.add('row-recurring');

      // Name
      tr.appendChild(tdInput('text', item.name, 'Expense name...', v => { item.name = v; saveMonth(activeKey, data); }));

      // Amount (ARS)
      tr.appendChild(tdInput('number', item.amount || '', '0', v => {
        item.amount = parseFloat(v) || 0;
        saveMonth(activeKey, data);
        document.dispatchEvent(new Event('mareo:render'));
      }));

      // Paid + recurring
      const tdCheck = td();
      tdCheck.className = 'col-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = item.paid;
      check.addEventListener('change', () => { item.paid = check.checked; saveMonth(activeKey, data); document.dispatchEvent(new Event('mareo:render')); });
      const recurBtn = document.createElement('button');
      recurBtn.className = 'btn-icon btn-tiny exp-recur-btn';
      recurBtn.innerHTML = item.recurring ? icon('refresh') : '-';
      recurBtn.title = item.recurring ? 'Recurring (copies to next month)' : 'One-time';
      recurBtn.addEventListener('click', () => { item.recurring = !item.recurring; saveMonth(activeKey, data); document.dispatchEvent(new Event('mareo:render')); });
      tdCheck.appendChild(check);
      tdCheck.appendChild(recurBtn);
      tr.appendChild(tdCheck);

      // Method
      const tdM = td();
      const sel = document.createElement('select');
      sel.className = 'exp-method-select';
      for (const m of PAYMENT_METHODS) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        if (m === item.method) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.dataset.method = (item.method || '').toLowerCase();
      sel.addEventListener('change', () => { item.method = sel.value; sel.dataset.method = sel.value.toLowerCase(); saveMonth(activeKey, data); });
      tdM.appendChild(sel);
      tr.appendChild(tdM);

      // Notes
      tr.appendChild(tdInput('text', item.notes || '', 'Notes...', v => { item.notes = v; saveMonth(activeKey, data); }));

      // Delete
      const tdDel = td();
      tdDel.className = 'col-del';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon';
      delBtn.innerHTML = icon('close');
      delBtn.addEventListener('click', () => { section.items.splice(ii, 1); saveMonth(activeKey, data); document.dispatchEvent(new Event('mareo:render')); });
      tdDel.appendChild(delBtn);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    sectionEl.appendChild(table);
    sectionsContainer.appendChild(sectionEl);
  }
  container.appendChild(sectionsContainer);
}

function renderIncomes(container, monthKey, data, rate) {
  const incomes = data.incomes || [];

  const wrapper = document.createElement('div');
  wrapper.className = 'exp-io-panel exp-io-incomes';

  const header = document.createElement('div');
  header.className = 'exp-io-header';
  header.innerHTML = `
    <span class="exp-io-title exp-io-title-income">INCOMES</span>
    <button class="btn btn-secondary exp-io-add-btn">+ Add</button>
  `;
  header.querySelector('.exp-io-add-btn').addEventListener('click', () => {
    data.incomes.push({
      id: 'inc-' + crypto.randomUUID(),
      source: '',
      amountUSD: 0,
      fees: ''
    });
    saveMonth(monthKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  wrapper.appendChild(header);

  if (incomes.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-state empty-state-sm';
    hint.textContent = 'Add your first income source';
    wrapper.appendChild(hint);
  }

  const table = document.createElement('table');
  table.className = 'exp-io-table';
  table.innerHTML = `<thead><tr>
    <th>USD</th>
    <th>Source</th>
    <th>ARS</th>
    <th>Fees</th>
    <th></th>
  </tr></thead>`;

  const tbody = document.createElement('tbody');
  let totalUSD = 0;
  let totalARS = 0;

  for (let i = 0; i < incomes.length; i++) {
    const inc = incomes[i];
    const rowARS = (inc.amountUSD || 0) * rate;
    totalUSD += inc.amountUSD || 0;
    totalARS += rowARS;

    const tr = document.createElement('tr');
    tr.className = 'exp-io-row-income';

    tr.appendChild(tdInput('number', inc.amountUSD || '', '0', v => {
      inc.amountUSD = parseFloat(v) || 0;
      saveMonth(monthKey, data);
      document.dispatchEvent(new Event('mareo:render'));
    }));

    tr.appendChild(tdInput('text', inc.source || '', 'Source...', v => {
      inc.source = v;
      saveMonth(monthKey, data);
    }));

    const tdTotal = td();
    const totalSpan = document.createElement('span');
    totalSpan.className = 'exp-io-ars-value';
    totalSpan.textContent = fmtARS(rowARS);
    tdTotal.appendChild(totalSpan);
    tr.appendChild(tdTotal);

    tr.appendChild(tdInput('text', inc.fees || '', 'Fees...', v => {
      inc.fees = v;
      saveMonth(monthKey, data);
    }));

    const tdDel = td();
    tdDel.className = 'col-del';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon btn-tiny';
    delBtn.innerHTML = icon('close');
    delBtn.addEventListener('click', () => {
      incomes.splice(i, 1);
      saveMonth(monthKey, data);
      document.dispatchEvent(new Event('mareo:render'));
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const tfr = document.createElement('tr');
  tfr.innerHTML = `
    <td><strong>${fmtUSD(totalUSD)}</strong></td>
    <td></td>
    <td><strong>${fmtARS(totalARS)}</strong></td>
    <td></td>
    <td></td>
  `;
  tfoot.appendChild(tfr);
  table.appendChild(tfoot);

  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

function renderPayments(container, monthKey, data, rate, totalDisponible) {
  const payments = data.payments || [];

  const wrapper = document.createElement('div');
  wrapper.className = 'exp-io-panel exp-io-outcomes';

  const header = document.createElement('div');
  header.className = 'exp-io-header';
  header.innerHTML = `
    <span class="exp-io-title exp-io-title-outcome">OUTCOMES</span>
    <button class="btn btn-secondary exp-io-add-btn">+ Add</button>
  `;
  header.querySelector('.exp-io-add-btn').addEventListener('click', () => {
    if (!data.payments) data.payments = [];
    data.payments.push({ source: '', amount: 0, notes: '' });
    saveMonth(monthKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  wrapper.appendChild(header);

  const table = document.createElement('table');
  table.className = 'exp-io-table';
  table.innerHTML = '<thead><tr><th>Source</th><th>USD</th><th>Notes</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const tr = document.createElement('tr');
    tr.className = 'exp-io-row-outcome';
    tr.appendChild(tdInput('text', p.source || '', 'Source...', v => { p.source = v; saveMonth(monthKey, data); }));

    tr.appendChild(tdInput('number', p.amount || '', '0', v => {
      p.amount = parseFloat(v) || 0;
      saveMonth(monthKey, data);
      document.dispatchEvent(new Event('mareo:render'));
    }));

    tr.appendChild(tdInput('text', p.notes || '', 'Notes...', v => { p.notes = v; saveMonth(monthKey, data); }));
    const tdDel = td();
    tdDel.className = 'col-del';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon btn-tiny';
    delBtn.innerHTML = icon('close');
    delBtn.addEventListener('click', () => { payments.splice(i, 1); saveMonth(monthKey, data); document.dispatchEvent(new Event('mareo:render')); });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);

  const totalPagadoUSD = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totals = document.createElement('div');
  totals.className = 'exp-io-totals';
  totals.innerHTML = `
    <div class="exp-io-total-row">
      <span>Total Pagado:</span><strong class="exp-io-paid">${fmtUSD(totalPagadoUSD)}</strong>
    </div>
    <div class="exp-io-total-row">
      <span>Total a Pagar:</span><strong class="exp-io-topay">${fmtARS(totalDisponible)}</strong>
    </div>
  `;
  wrapper.appendChild(totals);

  container.appendChild(wrapper);
}

function saveMonth(key, data) {
  Store.data.expensesMonths[key] = data;
  Store.save();
}

function tdInput(type, value, placeholder, onChange) {
  const cell = td();
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('change', () => onChange(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  cell.appendChild(input);
  return cell;
}

function td() { return document.createElement('td'); }

function fmtARS(n) {
  if (n == null || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function fmtUSD(n) {
  if (n == null || isNaN(n)) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function weeksRemainingInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = lastDay.getDate() - now.getDate();
  return Math.max(1, Math.ceil(daysLeft / 7));
}
