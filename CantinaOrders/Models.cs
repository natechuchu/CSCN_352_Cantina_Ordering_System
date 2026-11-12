namespace CantinaOrders;

// Shapes sent to and from the browser as JSON (property names become camelCase).

public sealed record MenuItemDto(int Id, string Name, string Category, decimal Price);

public sealed record OrderItemDto(int Id, int MenuItemId, string Name, int Qty, decimal UnitPrice);

public sealed record OrderDto(
    int Id,
    int Table,
    string Waiter,
    string Status,
    DateTime CreatedAt,
    DateTime? ClosedAt,
    List<OrderItemDto> Items)
{
    public decimal Subtotal => Items.Sum(i => i.Qty * i.UnitPrice);
    public int ItemCount => Items.Sum(i => i.Qty);
}

public sealed record TableStatusDto(int Number, OrderDto? Order);

// Body of POST /api/tables/{n}/items
public sealed record AddItemRequest(int MenuItemId, int? Quantity, string? Waiter);

// Outcome of a write, translated to an HTTP status code in Program.cs.
public enum OpStatus { Ok, NotFound, Conflict, Invalid }

public sealed record OpResult(OpStatus Status, OrderDto? Order = null, string? Error = null)
{
    public static OpResult Success(OrderDto? order) => new(OpStatus.Ok, order);
    public static OpResult NotFound(string error) => new(OpStatus.NotFound, Error: error);
    public static OpResult Conflict(string error) => new(OpStatus.Conflict, Error: error);
    public static OpResult Invalid(string error) => new(OpStatus.Invalid, Error: error);
}
