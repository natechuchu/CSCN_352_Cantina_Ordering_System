// Shared by every page: the fixed table list, server names, and small helpers.

const TABLES = [
  { number: 1, seats: 4, kind: 'Booth' },
  { number: 2, seats: 4, kind: 'Booth' },
  { number: 3, seats: 4, kind: 'Booth' },
  { number: 4, seats: 4, kind: 'Four-top' },
  { number: 5, seats: 4, kind: 'Four-top' },
  { number: 6, seats: 4, kind: 'Four-top' },
  { number: 7, seats: 2, kind: 'Two-top' },
  { number: 8, seats: 2, kind: 'Two-top' },
  { number: 9, seats: 6, kind: 'Round table' },
  { number: 10, seats: 6, kind: 'Round table' },
];

const WAITERS = ['WaiterBot002', 'WaiterBot003', 'DrinkBot001', 'HostessBot006', 'ManagerBot007'];

// Prices are shown in Galactic credits: ξ (written as an escape so it survives any file encoding).
const money = v => 'ξ' + Number(v).toFixed(2);
const timeOf = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateTime = d => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked; not critical */ }
}

// Updates the "Live" badge in the page header after each data load.
function setSync(ok) {
  const badge = document.getElementById('sync');
  if (!badge) return;
  badge.classList.toggle('is-error', !ok);
  badge.querySelector('.sync-text').textContent = ok
    ? 'Live · ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : 'Offline · retrying';
}
