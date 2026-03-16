import { Store } from './store.js';

const PAYMENT_METHODS = ['CASH', 'LEMON', 'BBVA', 'MP', 'TRANSFER', 'OTHER'];
const EXPENSE_SECTIONS = ['GASTOS FIJOS', 'GASTOS NO FIJOS', 'GASTOS EXTRAS'];

export function renderExpenses(container) {
  container.innerHTML = '';
  const data = Store.data.expensesData || getDefaultExpensesData();

  // === TOP: Monthly overview ===
  const overview = document.createElement('div');
  overview.className = 'exp-overview';

  // Calculate totals
  const allItems = [];
  for (const section of data.sections) {
    for (const item of section.items) allItems.push(item);
  }
  const totalGastado = allItems.reduce((s, e) => s + (e.amount || 0), 0);
  const totalAPagar = allItems.filter(e => !e.paid).reduce((s, e) => s + (e.aPagar || e.amount || 0), 0);
  const quedan = (data.monthlyIncome || 0) - totalGastado;
  const weeksLeft = weeksRemainingInMonth();
  const gastarXSemana = weeksLeft > 0 ? Math.round(quedan / weeksLeft) : 0;
  const totalPagos = (data.payments || []).reduce((s, p) => s + (p.amount || 0), 0);

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
          <div class="exp-card-value">${fmtARS(data.monthlyIncome - (data.savings || 0))}</div>
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

  // Wire income/savings inputs
  const incomeInput = overview.querySelector('#exp-monthly-income');
  incomeInput.addEventListener('change', () => {
    data.monthlyIncome = parseFloat(incomeInput.value) || 0;
    Store.data.expensesData = data;
    Store.save();
    document.dispatchEvent(new Event('mareo:render'));
  });

  const savingsInput = overview.querySelector('#exp-savings');
  savingsInput.addEventListener('change', () => {
    data.savings = parseFloat(savingsInput.value) || 0;
    Store.data.expensesData = data;
    Store.save();
    document.dispatchEvent(new Event('mareo:render'));
  });

  // Render payments (right panel)
  renderPayments(overview.querySelector('#exp-pagos-list'), data);

  // === SECTIONS ===
  const sectionsContainer = document.createElement('div');
  sectionsContainer.className = 'exp-sections';

  for (let si = 0; si < data.sections.length; si++) {
    const section = data.sections[si];
    const sectionEl = document.createElement('div');
    sectionEl.className = 'exp-section';

    const sectionTotal = section.items.reduce((s, e) => s + (e.amount || 0), 0);

    // Section header
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
      Store.data.expensesData = data;
      Store.save();
      document.dispatchEvent(new Event('mareo:render'));
    });

    sectionEl.appendChild(header);

    // Table
    const table = document.createElement('table');
    table.className = 'exp-table';
    table.innerHTML = `
      <thead><tr>
        <th class="col-name">Name</th>
        <th class="col-montos">Pagar</th>
        <th class="col-apagar">A Pagar</th>
        <th class="col-check"></th>
        <th class="col-method">Method</th>
        <th class="col-notes">Notes</th>
        <th class="col-del"></th>
      </tr></thead>
    `;

    const tbody = document.createElement('tbody');

    for (let ii = 0; ii < section.items.length; ii++) {
      const item = section.items[ii];
      const tr = document.createElement('tr');
      if (item.paid) tr.classList.add('row-paid');
      if (item.recurring) tr.classList.add('row-recurring');

      // Name
      const tdName = td();
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = item.name || '';
      nameInput.placeholder = 'Expense name...';
      nameInput.addEventListener('change', () => {
        item.name = nameInput.value;
        saveExpenses(data);
      });
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);

      // Amount (Pagar)
      const tdAmount = td();
      const amtInput = document.createElement('input');
      amtInput.type = 'number';
      amtInput.value = item.amount || '';
      amtInput.placeholder = '0';
      amtInput.addEventListener('change', () => {
        item.amount = parseFloat(amtInput.value) || 0;
        saveExpenses(data);
        document.dispatchEvent(new Event('mareo:render'));
      });
      tdAmount.appendChild(amtInput);
      tr.appendChild(tdAmount);

      // A Pagar
      const tdAPagar = td();
      const apInput = document.createElement('input');
      apInput.type = 'number';
      apInput.value = item.aPagar || '';
      apInput.placeholder = '0';
      apInput.addEventListener('change', () => {
        item.aPagar = parseFloat(apInput.value) || 0;
        saveExpenses(data);
      });
      tdAPagar.appendChild(apInput);
      tr.appendChild(tdAPagar);

      // Paid checkbox
      const tdCheck = td();
      tdCheck.className = 'col-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = item.paid;
      check.addEventListener('change', () => {
        item.paid = check.checked;
        saveExpenses(data);
        document.dispatchEvent(new Event('mareo:render'));
      });
      // Recurring indicator
      const recurBtn = document.createElement('button');
      recurBtn.className = 'btn-icon btn-tiny exp-recur-btn';
      recurBtn.textContent = item.recurring ? '↻' : '-';
      recurBtn.title = item.recurring ? 'Recurring' : 'One-time';
      recurBtn.addEventListener('click', () => {
        item.recurring = !item.recurring;
        saveExpenses(data);
        document.dispatchEvent(new Event('mareo:render'));
      });
      tdCheck.appendChild(check);
      tdCheck.appendChild(recurBtn);
      tr.appendChild(tdCheck);

      // Method
      const tdMethod = td();
      const methodSelect = document.createElement('select');
      methodSelect.className = 'exp-method-select';
      for (const m of PAYMENT_METHODS) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        if (m === item.method) opt.selected = true;
        methodSelect.appendChild(opt);
      }
      methodSelect.addEventListener('change', () => {
        item.method = methodSelect.value;
        saveExpenses(data);
      });
      // Color the method badge
      const methodClass = (item.method || '').toLowerCase();
      methodSelect.dataset.method = methodClass;
      tdMethod.appendChild(methodSelect);
      tr.appendChild(tdMethod);

      // Notes
      const tdNotes = td();
      const notesInput = document.createElement('input');
      notesInput.type = 'text';
      notesInput.value = item.notes || '';
      notesInput.placeholder = 'Notes...';
      notesInput.addEventListener('change', () => {
        item.notes = notesInput.value;
        saveExpenses(data);
      });
      tdNotes.appendChild(notesInput);
      tr.appendChild(tdNotes);

      // Delete
      const tdDel = td();
      tdDel.className = 'col-del';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        section.items.splice(ii, 1);
        saveExpenses(data);
        document.dispatchEvent(new Event('mareo:render'));
      });
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

function renderPayments(container, data) {
  container.innerHTML = '';
  const payments = data.payments || [];

  const table = document.createElement('table');
  table.className = 'exp-pagos-table';
  table.innerHTML = '<thead><tr><th>Source</th><th>Amount</th><th>Date</th><th></th></tr></thead>';

  const tbody = document.createElement('tbody');
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const tr = document.createElement('tr');

    // Source
    const tdSrc = td();
    const srcInput = document.createElement('input');
    srcInput.type = 'text'; srcInput.value = p.source || '';
    srcInput.addEventListener('change', () => { p.source = srcInput.value; saveExpenses(data); });
    tdSrc.appendChild(srcInput);
    tr.appendChild(tdSrc);

    // Amount
    const tdAmt = td();
    const amtInput = document.createElement('input');
    amtInput.type = 'number'; amtInput.value = p.amount || '';
    amtInput.addEventListener('change', () => {
      p.amount = parseFloat(amtInput.value) || 0;
      saveExpenses(data);
      document.dispatchEvent(new Event('mareo:render'));
    });
    tdAmt.appendChild(amtInput);
    tr.appendChild(tdAmt);

    // Notes/Date
    const tdDate = td();
    const dateInput = document.createElement('input');
    dateInput.type = 'text'; dateInput.value = p.notes || '';
    dateInput.placeholder = 'date/notes';
    dateInput.addEventListener('change', () => { p.notes = dateInput.value; saveExpenses(data); });
    tdDate.appendChild(dateInput);
    tr.appendChild(tdDate);

    // Delete
    const tdDel = td();
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon btn-tiny';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      payments.splice(i, 1);
      saveExpenses(data);
      document.dispatchEvent(new Event('mareo:render'));
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  // Totals
  const totalPagado = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totals = document.createElement('div');
  totals.className = 'exp-pagos-totals';
  totals.innerHTML = `<span>Total Pagado:</span><strong>${fmtARS(totalPagado)}</strong>`;
  container.appendChild(totals);

  // Add payment button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary exp-add-pago-btn';
  addBtn.textContent = '+ Add Payment';
  addBtn.addEventListener('click', () => {
    if (!data.payments) data.payments = [];
    data.payments.push({ source: '', amount: 0, notes: '' });
    saveExpenses(data);
    document.dispatchEvent(new Event('mareo:render'));
  });
  container.appendChild(addBtn);
}

function saveExpenses(data) {
  Store.data.expensesData = data;
  Store.save();
}

function getDefaultExpensesData() {
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

function td() {
  return document.createElement('td');
}
