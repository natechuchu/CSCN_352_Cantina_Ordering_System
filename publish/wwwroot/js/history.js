// History page: lists closed orders, newest first.

const rows = document.getElementById('history-rows');
const summary = document.getElementById('history-summary');

async function loadHistory() {
  let orders;
  try {
    orders = await api.getHistory();
    setSync(true);
  } catch {
    setSync(false);
    return;
  }

  const total = orders.reduce((sum, o) => sum + o.subtotal, 0);
  summary.textContent = `${orders.length} closed order${orders.length === 1 ? '' : 's'} · ${money(total)} total`;

  rows.innerHTML = orders.length
    ? orders.map(o => `
        <tr>
          <td class="id">#${o.id}</td>
          <td>T${o.table}</td>
          <td>${esc(o.waiter)}</td>
          <td>${dateTime(o.closedAt)}</td>
          <td class="items">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join(', ')}</td>
          <td class="num">${money(o.subtotal)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" class="empty">No closed orders yet.</td></tr>`;
}

loadHistory();
setInterval(loadHistory, 5000);
