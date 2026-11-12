// Floor plan page: draws the 10 tables and shows the open order for the selected one.

// Where each table sits in the SVG (viewBox 1000 x 690) and what shape it is.
const LAYOUT = {
  1: { shape: 'booth', x: 95, y: 210 },
  2: { shape: 'booth', x: 95, y: 370 },
  3: { shape: 'booth', x: 95, y: 530 },
  4: { shape: 'square', x: 340, y: 265 },
  5: { shape: 'square', x: 500, y: 265 },
  6: { shape: 'square', x: 660, y: 265 },
  7: { shape: 'round2', x: 380, y: 455 },
  8: { shape: 'round2', x: 620, y: 455 },
  9: { shape: 'round6', x: 870, y: 310 },
  10: { shape: 'round6', x: 870, y: 510 },
};

const SVGNS = 'http://www.w3.org/2000/svg';
const tablesLayer = document.getElementById('tables-layer');
const panel = document.getElementById('panel');
const nodes = {};
let tables = [];
let selected = null;
let lastSnapshot = '';

function svgEl(tag, attrs, parent) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

function drawStools() {
  const group = document.getElementById('stools');
  for (let x = 215; x <= 705; x += 49) svgEl('circle', { class: 'stool', cx: x, cy: 110, r: 10 }, group);
}

function drawTable(t) {
  const { shape, x, y } = LAYOUT[t.number];
  // Scale each table 1.2x around its own center so furniture and labels read clearly.
  const g = svgEl('g', { class: 'table', tabindex: 0, role: 'button', transform: `translate(${x} ${y}) scale(1.2) translate(${-x} ${-y})` }, tablesLayer);

  if (shape === 'booth') {
    svgEl('rect', { class: 'seat', x: x - 44, y: y - 52, width: 88, height: 16, rx: 6 }, g);
    svgEl('rect', { class: 'seat', x: x - 44, y: y + 36, width: 88, height: 16, rx: 6 }, g);
    svgEl('rect', { class: 'top', x: x - 40, y: y - 30, width: 80, height: 60, rx: 8 }, g);
  } else if (shape === 'square') {
    const chairs = [[x - 16, y - 50, 32, 12], [x - 16, y + 38, 32, 12], [x - 50, y - 16, 12, 32], [x + 38, y - 16, 12, 32]];
    for (const [cx, cy, w, h] of chairs) svgEl('rect', { class: 'seat', x: cx, y: cy, width: w, height: h, rx: 4 }, g);
    svgEl('rect', { class: 'top', x: x - 34, y: y - 34, width: 68, height: 68, rx: 8 }, g);
  } else {
    const big = shape === 'round6';
    const count = big ? 6 : 2;
    const dist = big ? 62 : 44;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count - Math.PI / 2;
      svgEl('circle', { class: 'seat', cx: x + dist * Math.cos(a), cy: y + dist * Math.sin(a), r: 11 }, g);
    }
    svgEl('circle', { class: 'top', cx: x, cy: y, r: big ? 44 : 30 }, g);
  }

  svgEl('text', { class: 'label', x, y: y - 6 }, g).textContent = 'T' + t.number;
  const sub = svgEl('text', { class: 'sub', x, y: y + 12 }, g);

  g.addEventListener('click', () => select(t.number));
  g.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.number); }
  });
  nodes[t.number] = { g, sub };
}

function renderTables() {
  for (const t of tables) {
    const { g, sub } = nodes[t.number];
    g.classList.toggle('is-open', !!t.order);
    g.classList.toggle('is-selected', t.number === selected);
    sub.textContent = t.order ? money(t.order.subtotal) : `${t.seats} seats`;
    g.setAttribute('aria-label', `Table ${t.number}, ${t.kind}, ` + (t.order ? `open order ${money(t.order.subtotal)}` : 'available'));
  }
}

function renderPanel() {
  const t = tables.find(x => x.number === selected);

  if (!t) {
    const open = tables.filter(x => x.order);
    const openTotal = open.reduce((sum, x) => sum + x.order.subtotal, 0);
    panel.innerHTML = `
      <p class="eyebrow">Floor status</p>
      <h2>Select a table</h2>
      <div class="stats">
        <div class="warm"><strong>${open.length}</strong><span>Open orders</span></div>
        <div><strong>${tables.length - open.length}</strong><span>Tables free</span></div>
        <div class="warm"><strong>${money(openTotal)}</strong><span>Open total</span></div>
      </div>
      <p class="empty">Tables glowing amber have an open order. Click one to see what's on it.</p>
      <a class="btn" href="order.html">New order</a>`;
    return;
  }

  const o = t.order;
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">${esc(t.kind)} · ${t.seats} seats</p>
        <h2>Table ${t.number}</h2>
      </div>
      <span class="pill ${o ? 'pill-open' : 'pill-free'}">${o ? 'Open order' : 'Available'}</span>
    </div>
    ${o ? `
      <p class="meta">Order #${o.id} · ${esc(o.waiter)} · opened ${timeOf(o.createdAt)}</p>
      <ul class="lines">
        ${o.items.map(i => `
          <li><span class="qty">${i.qty}×</span><span>${esc(i.name)}</span><span class="amt">${money(i.qty * i.unitPrice)}</span></li>`).join('')}
      </ul>
      <div class="subtotal"><span>Subtotal</span><strong>${money(o.subtotal)}</strong></div>
      <a class="btn" href="order.html?table=${t.number}">Add items</a>
    ` : `
      <p class="empty">No open order at this table.</p>
      <a class="btn" href="order.html?table=${t.number}">Start order</a>
    `}
    <button class="btn-ghost" type="button" data-deselect>Back to overview</button>`;
}

function select(number) {
  selected = number;
  renderTables();
  renderPanel();
  if (number && matchMedia('(max-width: 960px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

panel.addEventListener('click', e => {
  if (e.target.closest('[data-deselect]')) select(null);
});

// Reload table status every few seconds so orders added on another device show up here.
async function refresh() {
  try {
    tables = await api.getTables();
    setSync(true);
  } catch {
    setSync(false);
    return;
  }
  const snapshot = JSON.stringify(tables);
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  renderTables();
  renderPanel();
}

drawStools();
TABLES.forEach(drawTable);
refresh();
setInterval(refresh, 5000);
