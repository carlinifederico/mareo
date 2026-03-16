import { Store } from './store.js';

const PAYMENT_METHODS = ['CASH', 'LEMON', 'BBVA', 'MP', 'TRANSFER', 'OTHER'];
const MONTH_NAMES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Get current month key "YYYY-MM"
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES_ES[parseInt(m) - 1]} ${y}`;
}

// Ensure monthly expenses structure exists, auto-create current month
export function ensureCurrentMonth() {
  if (!Store.data.expensesMonths) Store.data.expensesMonths = {};

  const key = currentMonthKey();
  if (!Store.data.expensesMonths[key]) {
    // Find most recent previous month to copy recurring items from
    const keys = Object.keys(Store.data.expensesMonths).sort();
    const prevKey = keys.length > 0 ? keys[keys.length - 1] : null;

    const newMonth = createEmptyMonth();

    if (prevKey) {
      const prev = Store.data.expensesMonths[prevKey];
      newMonth.monthlyIncome = prev.monthlyIncome || 0;
      newMonth.savings = prev.savings || 0;
      // Copy recurring items (unpaid, reset amounts)
      for (const section of prev.sections) {
        const targetSection = newMonth.sections.find(s => s.name === section.name);
        if (!targetSection) continue;
        for (const item of section.items) {
          if (item.recurring) {
            targetSection.items.push({
              ...item,
              id: 'ei-' + crypto.randomUUID(),
              paid: false,
              aPagar: 0
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
    monthlyIncome: 0,
    savings: 0,
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

  // === MONTH NAVIGATOR ===
  const nav = document.createElement('div');
  nav.className = 'exp-month-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-secondary';
  prevBtn.textContent = '◀';
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
  nextBtn.textContent = '▶';
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

  nav.appendChild(prevBtn);
  nav.appendChild(monthTitle);
  nav.appendChild(nextBtn);
  nav.appendChild(todayBtn);
  container.appendChild(nav);

  // === TOP: Monthly overview ===
  const overview = document.createElement('div');
  overview.className = 'exp-overview';

  const allItems = [];
  for (const section of data.sections) {
    for (const item of section.items) allItems.push(item);
  }
  const totalGastado = allItems.reduce((s, e) => s + (e.amount || 0), 0);
  const quedan = (data.monthlyIncome || 0) - totalGastado;
  const weeksLeft = activeKey === currentMonthKey() ? weeksRemainingInMonth() : 4;
  const gastarXSemana = weeksLeft > 0 ? Math.round(quedan / weeksLeft) : 0;

  overview.innerHTML = `
    <div class="exp-overview-left">
      <div class="exp-overview-row">
        <span class="exp-label">MES ACTUAL EN ARS</span>
        <input type="number" class="exp-income-input" value="${data.monthlyIncome || 0}" id="exp-monthly-income">
      </div>
      <div class="exp-overview-row">
        <span class="exp-label">AHORROS (ARS)</span>
        <input type="number" class="exp-income-input" value="${data.savings || 0}" id="exp-savings">
      </div>
      <div class="exp-summary-cards">
        <div class="exp-card">
          <div class="exp-card-label">Total</div>
          <div class="exp-card-value">${fmtARS((data.monthlyIncome || 0) - (data.savings || 0))}</div>
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
      </div>
    </div>
    <div class="exp-overview-right">
      <div class="exp-pagos-title">PAGOS</div>
      <div id="exp-pagos-list"></div>
    </div>
  `;
  container.appendChild(overview);

  // Wire income/savings
  overview.querySelector('#exp-monthly-income').addEventListener('change', (e) => {
    data.monthlyIncome = parseFloat(e.target.value) || 0;
    saveMonth(activeKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  overview.querySelector('#exp-savings').addEventListener('change', (e) => {
    data.savings = parseFloat(e.target.value) || 0;
    saveMonth(activeKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });

  renderPayments(overview.querySelector('#exp-pagos-list'), activeKey, data);

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
        name: '', amount: 0, aPagar: 0,
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
      <th class="col-montos">Pagar</th>
      <th class="col-apagar">A Pagar</th>
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
      // Amount
      tr.appendChild(tdInput('number', item.amount || '', '0', v => { item.amount = parseFloat(v) || 0; saveMonth(activeKey, data); document.dispatchEvent(new Event('mareo:render')); }));
      // A Pagar
      tr.appendChild(tdInput('number', item.aPagar || '', '0', v => { item.aPagar = parseFloat(v) || 0; saveMonth(activeKey, data); }));

      // Paid + recurring
      const tdCheck = td();
      tdCheck.className = 'col-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = item.paid;
      check.addEventListener('change', () => { item.paid = check.checked; saveMonth(activeKey, data); document.dispatchEvent(new Event('mareo:render')); });
      const recurBtn = document.createElement('button');
      recurBtn.className = 'btn-icon btn-tiny exp-recur-btn';
      recurBtn.textContent = item.recurring ? '↻' : '-';
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
      delBtn.textContent = '✕';
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

function renderPayments(container, monthKey, data) {
  container.innerHTML = '';
  const payments = data.payments || [];

  const table = document.createElement('table');
  table.className = 'exp-pagos-table';
  table.innerHTML = '<thead><tr><th>Source</th><th>Amount</th><th>Notes</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const tr = document.createElement('tr');
    tr.appendChild(tdInput('text', p.source || '', '', v => { p.source = v; saveMonth(monthKey, data); }));
    tr.appendChild(tdInput('number', p.amount || '', '', v => { p.amount = parseFloat(v) || 0; saveMonth(monthKey, data); document.dispatchEvent(new Event('mareo:render')); }));
    tr.appendChild(tdInput('text', p.notes || '', 'date/notes', v => { p.notes = v; saveMonth(monthKey, data); }));
    const tdDel = td();
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon btn-tiny';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => { payments.splice(i, 1); saveMonth(monthKey, data); document.dispatchEvent(new Event('mareo:render')); });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  const totalPagado = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totals = document.createElement('div');
  totals.className = 'exp-pagos-totals';
  totals.innerHTML = `<span>Total Pagado:</span><strong>${fmtARS(totalPagado)}</strong>`;
  container.appendChild(totals);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary exp-add-pago-btn';
  addBtn.textContent = '+ Add Payment';
  addBtn.addEventListener('click', () => {
    if (!data.payments) data.payments = [];
    data.payments.push({ source: '', amount: 0, notes: '' });
    saveMonth(monthKey, data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  container.appendChild(addBtn);
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
  cell.appendChild(input);
  return cell;
}

function td() { return document.createElement('td'); }

function fmtARS(n) {
  if (n == null || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function weeksRemainingInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = lastDay.getDate() - now.getDate();
  return Math.max(1, Math.ceil(daysLeft / 7));
}
