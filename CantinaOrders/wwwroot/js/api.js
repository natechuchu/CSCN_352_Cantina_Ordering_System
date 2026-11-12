// Data layer for the front end: each function calls one route of the ASP.NET back end
// (see Program.cs). The page scripts only use these functions, never fetch() directly.
//
// URLs are relative ("api/..." with no leading slash) so the app still works if IIS hosts it
// in a sub-folder such as http://ORRR-W2025/CantinaOrders/.

const api = (() => {
  // Thrown for any non-success response. `status` is the HTTP code; 0 means the server
  // couldn't be reached at all.
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        cache: 'no-store', // always show current orders, never a cached copy
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Cannot reach the server.', 0);
    }

    if (res.status === 204) return null; // e.g. a free table, or an order that was emptied
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status);
    return data;
  }

  return {
    ApiError,

    // GET /api/menu
    getMenu: () => request('GET', 'api/menu'),

    // GET /api/tables, merged with the seat/shape info the floor plan needs.
    async getTables() {
      const statuses = await request('GET', 'api/tables');
      const byNumber = new Map(statuses.map(s => [s.number, s.order]));
      return TABLES.map(t => ({ ...t, order: byNumber.get(t.number) ?? null }));
    },

    // GET /api/tables/{n}/order  (null when the table has no open order)
    getOpenOrder: table => request('GET', `api/tables/${table}/order`),

    // POST /api/tables/{n}/items  (opens an order if the table has none)
    addItem: (table, menuItemId, waiter) =>
      request('POST', `api/tables/${table}/items`, { menuItemId, quantity: 1, waiter }),

    // DELETE /api/orders/{id}/items/{itemId}  (removes one; null if that emptied the order)
    removeItem: (orderId, itemId) => request('DELETE', `api/orders/${orderId}/items/${itemId}`),

    // POST /api/orders/{id}/close
    closeOrder: orderId => request('POST', `api/orders/${orderId}/close`),

    // GET /api/orders?status=Closed  (newest first)
    getHistory: () => request('GET', 'api/orders?status=Closed'),
  };
})();
