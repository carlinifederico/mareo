import { Store } from './store.js';

const EXPENSE_CATEGORIES = [
  'Production', 'Equipment', 'Travel', 'Studio', 'Marketing',
  'Legal', 'Software', 'Materials', 'Services', 'Other'
];

export function renderExpenses(container) {
  container.innerHTML = '';

  const expenses = Store.data.expenses || [];

  // Summary cards
  const summary = document.createElement('div');
  summary.className = 'expenses-summary';

  const totalAmount = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const paidAmount = expenses.filter(e => e.paid).reduce((s, e) => s + (e.amount || 0), 0);
  const pendingAmount = totalAmount - paidAmount;

  summary.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">Total</div>
      <div class="summary-value">$${formatNum(totalAmount)}</div>
    </div>
    <div class="summary-card summary-paid">
      <div class="summary-label">Paid</div>
      <div class="summary-value">$${formatNum(paidAmount)}</div>
    </div>
    <div class="summary-card summary-pending">
      <div class="summary-label">Pending</div>
      <div class="summary-value">$${formatNum(pendingAmount)}</div>
    </div>
  `;
  container.appendChild(summary);

  // Table
  const table = document.createElement('table');
  table.className = 'expenses-table';

  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-paid">Paid</th>
        <th class="col-date">Date</th>
        <th class="col-project">Project</th>
        <th class="col-category">Category</th>
        <th class="col-description">Description</th>
        <th class="col-amount">Amount</th>
        <th class="col-actions"></th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  // Get all projects for dropdown
  const allProjects = [];
  for (const cat of Store.data.categories) {
    for (const proj of cat.projects) {
      allProjects.push({ id: proj.id, name: proj.name, color: proj.color });
    }
  }

  // Sort: unpaid first, then by date desc
  const sorted = [...expenses].sort((a, b) => {
    if (a.paid && !b.paid) return 1;
    if (!a.paid && b.paid) return -1;
    return (b.date || '').localeCompare(a.date || '');
  });

  for (const exp of sorted) {
    const tr = document.createElement('tr');
    if (exp.paid) tr.classList.add('row-paid');

    // Paid checkbox
    const tdPaid = document.createElement('td');
    tdPaid.className = 'col-paid';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = exp.paid;
    checkbox.addEventListener('change', () => {
      Store.updateExpense(exp.id, { paid: checkbox.checked });
      document.dispatchEvent(new Event('mareo:render'));
    });
    tdPaid.appendChild(checkbox);
    tr.appendChild(tdPaid);

    // Date
    const tdDate = document.createElement('td');
    tdDate.className = 'col-date';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = exp.date || '';
    dateInput.addEventListener('change', () => {
      Store.updateExpense(exp.id, { date: dateInput.value });
    });
    tdDate.appendChild(dateInput);
    tr.appendChild(tdDate);

    // Project
    const tdProj = document.createElement('td');
    tdProj.className = 'col-project';
    const projSelect = document.createElement('select');
    projSelect.innerHTML = '<option value="">— None —</option>';
    for (const p of allProjects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === exp.projectId) opt.selected = true;
      projSelect.appendChild(opt);
    }
    projSelect.addEventListener('change', () => {
      Store.updateExpense(exp.id, { projectId: projSelect.value || null });
    });
    tdProj.appendChild(projSelect);
    tr.appendChild(tdProj);

    // Category
    const tdCat = document.createElement('td');
    tdCat.className = 'col-category';
    const catSelect = document.createElement('select');
    for (const c of EXPENSE_CATEGORIES) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (c === exp.category) opt.selected = true;
      catSelect.appendChild(opt);
    }
    catSelect.addEventListener('change', () => {
      Store.updateExpense(exp.id, { category: catSelect.value });
    });
    tdCat.appendChild(catSelect);
    tr.appendChild(tdCat);

    // Description
    const tdDesc = document.createElement('td');
    tdDesc.className = 'col-description';
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.value = exp.description || '';
    descInput.placeholder = 'Description...';
    descInput.addEventListener('change', () => {
      Store.updateExpense(exp.id, { description: descInput.value });
    });
    tdDesc.appendChild(descInput);
    tr.appendChild(tdDesc);

    // Amount
    const tdAmount = document.createElement('td');
    tdAmount.className = 'col-amount';
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.value = exp.amount || 0;
    amountInput.step = '0.01';
    amountInput.addEventListener('change', () => {
      Store.updateExpense(exp.id, { amount: parseFloat(amountInput.value) || 0 });
      document.dispatchEvent(new Event('mareo:render'));
    });
    tdAmount.appendChild(amountInput);
    tr.appendChild(tdAmount);

    // Delete
    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      Store.removeExpense(exp.id);
      document.dispatchEvent(new Event('mareo:render'));
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);

  if (expenses.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'expenses-empty';
    empty.textContent = 'No expenses yet. Click "+ Add Expense" to start tracking.';
    container.appendChild(empty);
  }
}

function formatNum(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
