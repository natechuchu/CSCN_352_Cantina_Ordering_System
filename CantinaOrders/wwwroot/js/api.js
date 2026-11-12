// Data layer for the front end.
//
// For now this is a MOCK: it keeps orders in the browser's localStorage so the pages
// can be built and tested before the ASP.NET + SQLite back end exists. Each function
// matches a planned back-end route; later this file gets rewritten to call fetch(),
// and the page scripts (floor.js, order.js, history.js) stay the same.

const api = (() => {
  // Will come from the MenuItems table.
  const MENU = [
    { id: 1, name: 'Blue Milk', category: 'Drink', price: 4.5 },
    { id: 2, name: 'Jawa Juice', category: 'Drink', price: 5.0 },
    { id: 3, name: 'Corellian Ale', category: 'Drink', price: 7.0 },
    { id: 4, name: 'Tatooine Sunset', category: 'Drink', price: 9.5 },
    { id: 5, name: 'Spotchka', category: 'Drink', price: 8.0 },
    { id: 6, name: 'Bantha Burger', category: 'Food', price: 14.0 },
    { id: 7, name: 'Ronto Wrap', category: 'Food', price: 11.5 },
    { id: 8, name: 'Nerf Nuggets', category: 'Food', price: 9.0 },
    { id: 9, name: 'Mynock Wings', category: 'Food', price: 10.5 },
    { id: 10, name: 'Dewback Ribs', category: 'Food', price: 18.0 },
  ];

  const KEY = 'cantina-mock-v1';
  let memory = null;

  const clone = v => JSON.parse(JSON.stringify(v));
  const withTotals = o => ({
    ...clone(o),
    subtotal: o.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0),
    itemCount: o.items.reduce((sum, i) => sum + i.qty, 0),
  });
  const openFor = (state, table) => state.orders.find(o => o.table === table && o.status === 'Open');

  function seed() {
    const now = Date.now();
    const min = 60000;
    let nextItem = 1;
    const line = (menuItemId, qty) => {
      const m = MENU.find(x => x.id === menuItemId);
      return { id: nextItem++, menuItemId, name: m.name, qty, unitPrice: m.price };
    };
    const orders = [
      { id: 101, table: 3, waiter: 'WaiterBot002', status: 'Closed', createdAt: now - 180 * min, closedAt: now - 130 * min, items: [line(6, 2), line(1, 2)] },
      { id: 102, table: 9, waiter: 'WaiterBot003', status: 'Closed', createdAt: now - 150 * min, closedAt: now - 95 * min, items: [line(10, 3), line(3, 4), line(8, 1)] },
      { id: 103, table: 2, waiter: 'WaiterBot002', status: 'Open', createdAt: now - 25 * min, closedAt: null, items: [line(7, 1), line(2, 2)] },
      { id: 104, table: 5, waiter: 'WaiterBot003', status: 'Open', createdAt: now - 12 * min, closedAt: null, items: [line(6, 2), line(3, 2), line(9, 1)] },
      { id: 105, table: 9, waiter: 'DrinkBot001', status: 'Open', createdAt: now - 4 * min, closedAt: null, items: [line(4, 3)] },
    ];
    return { nextOrderId: 106, nextItemId: nextItem, orders };
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* blocked or corrupt storage: fall back to memory */ }
    if (!memory) { memory = seed(); write(memory); }
    return memory;
  }

  function write(state) {
    memory = state;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* memory only */ }
  }

  return {
    // GET /api/menu
    async getMenu() {
      return clone(MENU);
    },

    // GET /api/tables
    async getTables() {
      const state = read();
      return TABLES.map(t => {
        const o = openFor(state, t.number);
        return { ...t, order: o ? withTotals(o) : null };
      });
    },

    // GET /api/tables/{n}/order  (null when the table has no open order)
    async getOpenOrder(table) {
      const o = openFor(read(), table);
      return o ? withTotals(o) : null;
    },

    // POST /api/tables/{n}/items  (opens an order if the table has none)
    async addItem(table, menuItemId, waiter) {
      const state = read();
      let o = openFor(state, table);
      if (!o) {
        o = { id: state.nextOrderId++, table, waiter, status: 'Open', createdAt: Date.now(), closedAt: null, items: [] };
        state.orders.push(o);
      }
      const m = MENU.find(x => x.id === menuItemId);
      const existing = o.items.find(i => i.menuItemId === menuItemId);
      if (existing) existing.qty += 1;
      else o.items.push({ id: state.nextItemId++, menuItemId, name: m.name, qty: 1, unitPrice: m.price });
      write(state);
      return withTotals(o);
    },

    // DELETE /api/orders/{id}/items/{itemId}  (removes one; an empty order is dropped)
    async removeItem(orderId, itemId) {
      const state = read();
      const o = state.orders.find(x => x.id === orderId && x.status === 'Open');
      if (!o) return null;
      const existing = o.items.find(i => i.id === itemId);
      if (existing) {
        existing.qty -= 1;
        if (existing.qty <= 0) o.items = o.items.filter(i => i !== existing);
      }
      if (!o.items.length) {
        state.orders = state.orders.filter(x => x !== o);
        write(state);
        return null;
      }
      write(state);
      return withTotals(o);
    },

    // POST /api/orders/{id}/close
    async closeOrder(orderId) {
      const state = read();
      const o = state.orders.find(x => x.id === orderId && x.status === 'Open');
      if (o) {
        o.status = 'Closed';
        o.closedAt = Date.now();
        write(state);
      }
    },

    // GET /api/orders?status=Closed
    async getHistory() {
      return read().orders
        .filter(o => o.status === 'Closed')
        .sort((a, b) => b.closedAt - a.closedAt)
        .map(withTotals);
    },
  };
})();
