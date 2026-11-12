// Order page: pick a table, tap menu items to add them, see the running subtotal.

const tableSelect = document.getElementById('table');
const waiterSelect = document.getElementById('waiter');
const menuEl = document.getElementById('menu');
const ticketEl = document.getElementById('ticket');
const titleEl = document.getElementById('order-title');

let table = null;
let order = null;
let lastSnapshot = '';

TABLES.forEach(t => tableSelect.add(new Option(`Table ${t.number} · ${t.kind} (${t.seats})`, t.number)));
WAITERS.forEach(w => waiterSelect.add(new Option(w, w)));
waiterSelect.value = storageGet('cantina-waiter') || WAITERS[0];

const requested = Number(new URLSearchParams(location.search).get('table'));
if (TABLES.some(t => t.number === requested)) {
  table = requested;
  tableSelect.value = String(requested);
}

async function renderMenu() {
  const menu = await api.getMenu();
  const groups = [['Drink', 'Drinks'], ['Food', 'Food']];
  menuEl.innerHTML = groups.map(([category, title]) => `
    <div class="menu-section">
      <h2 class="section-title">${title}</h2>
      <div class="menu-grid">
        ${menu.filter(m => m.category === category).map(m => `
          <button type="button" class="menu-item" data-id="${m.id}">
            <span class="menu-name">${esc(m.name)}</span>
            <span class="menu-price">${money(m.price)}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function renderTicket() {
  titleEl.textContent = table ? `Table ${table}` : 'New order';
  menuEl.querySelectorAll('.menu-item').forEach(b => { b.disabled = !table; });

  // An open order keeps the server who started it.
  waiterSelect.disabled = !!order;
  if (order) {
    if (![...waiterSelect.options].some(o => o.value === order.waiter)) waiterSelect.add(new Option(order.waiter, order.waiter));
    waiterSelect.value = order.waiter;
  } else {
    waiterSelect.value = storageGet('cantina-waiter') || waiterSelect.value;
  }

  if (!table) {
    ticketEl.innerHTML = `
      <p class="eyebrow">Ticket</p>
      <h2>No table selected</h2>
      <p class="empty">Choose a table above, then tap menu items to add them.</p>
      <a class="btn-ghost" href="index.html">Back to floor</a>`;
    return;
  }

  const items = order ? order.items : [];
  ticketEl.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">${order ? `Order #${order.id} · ${esc(order.waiter)}` : 'New ticket'}</p>
        <h2>Table ${table}</h2>
      </div>
      <span class="pill ${order ? 'pill-open' : 'pill-free'}">${order ? 'Open' : 'Empty'}</span>
    </div>
    ${items.length ? `
      <ul class="lines">
        ${items.map(i => `
          <li>
            <button type="button" class="icon-btn" data-remove="${i.id}" aria-label="Remove one ${esc(i.name)}">−</button>
            <span><span class="qty">${i.qty}×</span> ${esc(i.name)}</span>
            <span class="amt">${money(i.qty * i.unitPrice)}</span>
          </li>`).join('')}
      </ul>` : `<p class="empty">Tap a menu item to start this table's order.</p>`}
    <div class="subtotal"><span>Subtotal</span><strong>${money(order ? order.subtotal : 0)}</strong></div>
    <button type="button" class="btn btn-amber" data-close ${order ? '' : 'disabled'}>Close order</button>
    <p class="fine">Payment is taken at the register. Closing moves the order to History.</p>
    <a class="btn-ghost" href="index.html">Back to floor</a>`;
}

// Re-render only when something changed, so polling doesn't steal focus.
function show(nextOrder) {
  order = nextOrder;
  const snapshot = JSON.stringify([table, order]);
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  renderTicket();
}

async function loadOrder() {
  if (!table) { show(null); return; }
  try {
    const current = await api.getOpenOrder(table);
    setSync(true);
    show(current);
  } catch {
    setSync(false);
  }
}

tableSelect.addEventListener('change', () => {
  table = Number(tableSelect.value) || null;
  const url = new URL(location.href);
  if (table) url.searchParams.set('table', table); else url.searchParams.delete('table');
  history.replaceState(null, '', url);
  loadOrder();
});

waiterSelect.addEventListener('change', () => storageSet('cantina-waiter', waiterSelect.value));

menuEl.addEventListener('click', async e => {
  const button = e.target.closest('.menu-item');
  if (!button || !table) return;
  try {
    show(await api.addItem(table, Number(button.dataset.id), waiterSelect.value));
    setSync(true);
    button.classList.remove('added');
    void button.offsetWidth; // restart the glow animation
    button.classList.add('added');
  } catch {
    setSync(false);
  }
});

ticketEl.addEventListener('click', async e => {
  const remove = e.target.closest('[data-remove]');
  if (remove && order) {
    try { show(await api.removeItem(order.id, Number(remove.dataset.remove))); setSync(true); } catch { setSync(false); }
    return;
  }
  if (e.target.closest('[data-close]') && order) {
    if (!confirm(`Close order #${order.id} for Table ${table}? Subtotal ${money(order.subtotal)}.`)) return;
    try { await api.closeOrder(order.id); location.href = 'index.html'; } catch { setSync(false); }
  }
});

renderMenu().then(loadOrder);
setInterval(loadOrder, 5000);
