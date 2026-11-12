using CantinaOrders;

var builder = WebApplication.CreateBuilder(args);

// Build an absolute path from the app folder. Under IIS the working directory isn't the app folder.
var dbPath = Path.Combine(builder.Environment.ContentRootPath, "App_Data", "cantina.db");
builder.Services.AddSingleton(new CantinaDb(dbPath));

var app = builder.Build();

var database = app.Services.GetRequiredService<CantinaDb>();
database.Initialize();
app.Logger.LogInformation("Cantina database: {Path}", database.DbPath);

// Serve the front end from wwwroot (index.html is the default page).
app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");

// Menu items waiters can add to an order.
api.MapGet("/menu", (CantinaDb db) => db.GetMenu());

// All 10 tables, each with its open order (or null).
api.MapGet("/tables", (CantinaDb db) => db.GetTables());

// One table's open order. 204 No Content when the table is free.
api.MapGet("/tables/{table:int}/order", (int table, CantinaDb db) =>
{
    if (!CantinaDb.IsValidTable(table)) return Results.NotFound(Error($"There is no table {table}."));
    var order = db.GetOpenOrder(table);
    return order is null ? Results.NoContent() : Results.Ok(order);
});

// Add an item to a table. Opens a new order if the table has none.
// Body: { "menuItemId": 3, "quantity": 1, "waiter": "WaiterBot002" }
api.MapPost("/tables/{table:int}/items", (int table, AddItemRequest body, CantinaDb db) =>
{
    if (!CantinaDb.IsValidTable(table)) return Results.NotFound(Error($"There is no table {table}."));

    var quantity = body.Quantity ?? 1;
    if (quantity is < 1 or > 20) return Results.BadRequest(Error("Quantity must be between 1 and 20."));

    var waiter = body.Waiter?.Trim();
    if (waiter is { Length: > 40 }) return Results.BadRequest(Error("Server name must be 40 characters or fewer."));

    return ToHttp(db.AddItem(table, body.MenuItemId, quantity, waiter));
});

// Remove one of an item. 204 No Content when that emptied (and deleted) the order.
api.MapDelete("/orders/{id:int}/items/{itemId:int}", (int id, int itemId, CantinaDb db) =>
    ToHttp(db.RemoveOne(id, itemId)));

// Close an order (payment happens in a separate system).
api.MapPost("/orders/{id:int}/close", (int id, CantinaDb db) => ToHttp(db.Close(id)));

// One order by number, open or closed.
api.MapGet("/orders/{id:int}", (int id, CantinaDb db) =>
    db.GetOrder(id) is { } order ? Results.Ok(order) : Results.NotFound(Error($"Order {id} does not exist.")));

// Order list, newest first. ?status=Closed for History, ?status=Open, or no filter for both.
api.MapGet("/orders", (string? status, CantinaDb db) =>
{
    if (status is not null && status is not ("Open" or "Closed"))
        return Results.BadRequest(Error("status must be Open or Closed."));
    return Results.Ok(db.GetOrders(status));
});

app.Run();

static object Error(string message) => new { error = message };

static IResult ToHttp(OpResult result) => result.Status switch
{
    OpStatus.Ok => result.Order is null ? Results.NoContent() : Results.Ok(result.Order),
    OpStatus.NotFound => Results.NotFound(Error(result.Error!)),
    OpStatus.Conflict => Results.Conflict(Error(result.Error!)),
    _ => Results.BadRequest(Error(result.Error!)),
};
