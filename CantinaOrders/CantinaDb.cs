using System.Globalization;
using Microsoft.Data.Sqlite;

namespace CantinaOrders;

// All database work lives here: schema, seed data, and the queries behind each API route.
// SQLite keeps everything in one file (App_Data\cantina.db), so there is no database server to install.
public sealed class CantinaDb
{
    public const int TableCount = 10;

    private const string Schema = """
        CREATE TABLE IF NOT EXISTS MenuItems (
            Id          INTEGER PRIMARY KEY,
            Name        TEXT    NOT NULL UNIQUE,
            Category    TEXT    NOT NULL CHECK (Category IN ('Drink', 'Food')),
            PriceCents  INTEGER NOT NULL CHECK (PriceCents >= 0),
            IsActive    INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS Orders (
            Id          INTEGER PRIMARY KEY,
            TableNumber INTEGER NOT NULL CHECK (TableNumber BETWEEN 1 AND 10),
            Waiter      TEXT    NOT NULL,
            Status      TEXT    NOT NULL DEFAULT 'Open' CHECK (Status IN ('Open', 'Closed')),
            CreatedAt   TEXT    NOT NULL,   -- UTC, ISO 8601
            ClosedAt    TEXT                -- UTC, ISO 8601; NULL while open
        );

        -- A table can have only one open order at a time.
        CREATE UNIQUE INDEX IF NOT EXISTS IX_Orders_OneOpenPerTable
            ON Orders (TableNumber) WHERE Status = 'Open';

        CREATE TABLE IF NOT EXISTS OrderItems (
            Id             INTEGER PRIMARY KEY,
            OrderId        INTEGER NOT NULL REFERENCES Orders (Id) ON DELETE CASCADE,
            MenuItemId     INTEGER NOT NULL REFERENCES MenuItems (Id),
            Quantity       INTEGER NOT NULL CHECK (Quantity > 0),
            UnitPriceCents INTEGER NOT NULL,   -- price when ordered, so later menu changes don't rewrite history
            UNIQUE (OrderId, MenuItemId)
        );
        """;

    private static readonly (string Name, string Category, int PriceCents)[] SeedMenu =
    [
        ("Blue Milk", "Drink", 450),
        ("Jawa Juice", "Drink", 500),
        ("Corellian Ale", "Drink", 700),
        ("Tatooine Sunset", "Drink", 950),
        ("Spotchka", "Drink", 800),
        ("Bantha Burger", "Food", 1400),
        ("Ronto Wrap", "Food", 1150),
        ("Nerf Nuggets", "Food", 900),
        ("Mynock Wings", "Food", 1050),
        ("Dewback Ribs", "Food", 1800),
    ];

    private readonly string _connectionString;

    public CantinaDb(string dbPath)
    {
        DbPath = dbPath;
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            ForeignKeys = true,
        }.ToString();
    }

    public string DbPath { get; }

    public static bool IsValidTable(int table) => table is >= 1 and <= TableCount;

    // Creates the folder, tables, and menu on first run. Safe to call every startup.
    public void Initialize()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(DbPath)!);
        using var c = Open();
        Exec(c, null, "PRAGMA journal_mode = WAL;"); // lets readers and a writer work at the same time
        Exec(c, null, Schema);

        if (Convert.ToInt64(Scalar(c, null, "SELECT COUNT(*) FROM MenuItems")) > 0) return;

        using var tx = c.BeginTransaction();
        foreach (var (name, category, price) in SeedMenu)
        {
            Exec(c, tx, "INSERT INTO MenuItems (Name, Category, PriceCents) VALUES ($name, $category, $price)",
                ("$name", name), ("$category", category), ("$price", price));
        }
        tx.Commit();
    }

    // ---------- Reads ----------

    public List<MenuItemDto> GetMenu()
    {
        using var c = Open();
        using var cmd = Cmd(c, null, """
            SELECT Id, Name, Category, PriceCents FROM MenuItems
            WHERE IsActive = 1
            ORDER BY CASE Category WHEN 'Drink' THEN 0 ELSE 1 END, Id
            """);
        using var r = cmd.ExecuteReader();
        var menu = new List<MenuItemDto>();
        while (r.Read()) menu.Add(new MenuItemDto(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetInt64(3) / 100m));
        return menu;
    }

    public List<TableStatusDto> GetTables()
    {
        using var c = Open();
        var open = LoadOrders(c, null, "o.Status = 'Open'", "o.TableNumber").ToDictionary(o => o.Table);
        return Enumerable.Range(1, TableCount)
            .Select(n => new TableStatusDto(n, open.GetValueOrDefault(n)))
            .ToList();
    }

    public OrderDto? GetOpenOrder(int table)
    {
        using var c = Open();
        return LoadOrders(c, null, "o.TableNumber = $t AND o.Status = 'Open'", "o.Id", ("$t", table)).FirstOrDefault();
    }

    public OrderDto? GetOrder(int id)
    {
        using var c = Open();
        return LoadOrders(c, null, "o.Id = $id", "o.Id", ("$id", id)).FirstOrDefault();
    }

    // Newest first; status is "Open", "Closed", or null for both. Capped so History stays quick.
    public List<OrderDto> GetOrders(string? status, int limit = 200)
    {
        using var c = Open();
        var statusFilter = status is null ? "" : "WHERE Status = $status";
        return LoadOrders(c, null,
            $"o.Id IN (SELECT Id FROM Orders {statusFilter} ORDER BY COALESCE(ClosedAt, CreatedAt) DESC LIMIT $limit)",
            "COALESCE(o.ClosedAt, o.CreatedAt) DESC",
            ("$status", status), ("$limit", limit));
    }

    // ---------- Writes ----------

    // Adds a menu item to the table's open order, opening a new order first if there isn't one.
    public OpResult AddItem(int table, int menuItemId, int quantity, string? waiter)
    {
        using var c = Open();
        using var tx = c.BeginTransaction(); // BEGIN IMMEDIATE: two devices can't open two orders for one table

        var price = Scalar(c, tx, "SELECT PriceCents FROM MenuItems WHERE Id = $id AND IsActive = 1", ("$id", menuItemId));
        if (price is null) return OpResult.NotFound($"Menu item {menuItemId} does not exist.");

        var orderId = Scalar(c, tx, "SELECT Id FROM Orders WHERE TableNumber = $t AND Status = 'Open'", ("$t", table));
        if (orderId is null)
        {
            if (string.IsNullOrWhiteSpace(waiter)) return OpResult.Invalid("A server name is required to open a new order.");
            orderId = Scalar(c, tx, """
                INSERT INTO Orders (TableNumber, Waiter, Status, CreatedAt)
                VALUES ($t, $waiter, 'Open', $now)
                RETURNING Id
                """, ("$t", table), ("$waiter", waiter), ("$now", Now()));
        }

        Exec(c, tx, """
            INSERT INTO OrderItems (OrderId, MenuItemId, Quantity, UnitPriceCents)
            VALUES ($order, $item, $qty, $price)
            ON CONFLICT (OrderId, MenuItemId) DO UPDATE SET Quantity = Quantity + excluded.Quantity
            """, ("$order", orderId), ("$item", menuItemId), ("$qty", quantity), ("$price", price));

        var order = LoadOrders(c, tx, "o.Id = $id", "o.Id", ("$id", orderId)).Single();
        tx.Commit();
        return OpResult.Success(order);
    }

    // Removes one of an item. If that empties the order, the order is deleted and Order is null.
    public OpResult RemoveOne(int orderId, int orderItemId)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();

        var check = CheckOpen(c, tx, orderId);
        if (check is not null) return check;

        var qty = Scalar(c, tx, "SELECT Quantity FROM OrderItems WHERE Id = $item AND OrderId = $order",
            ("$item", orderItemId), ("$order", orderId));
        if (qty is null) return OpResult.NotFound($"Item {orderItemId} is not on order {orderId}.");

        if (Convert.ToInt64(qty) > 1)
            Exec(c, tx, "UPDATE OrderItems SET Quantity = Quantity - 1 WHERE Id = $item", ("$item", orderItemId));
        else
            Exec(c, tx, "DELETE FROM OrderItems WHERE Id = $item", ("$item", orderItemId));

        OrderDto? order = null;
        if (Convert.ToInt64(Scalar(c, tx, "SELECT COUNT(*) FROM OrderItems WHERE OrderId = $order", ("$order", orderId))) == 0)
            Exec(c, tx, "DELETE FROM Orders WHERE Id = $order", ("$order", orderId));
        else
            order = LoadOrders(c, tx, "o.Id = $id", "o.Id", ("$id", orderId)).Single();

        tx.Commit();
        return OpResult.Success(order);
    }

    // Marks an order paid/closed so it moves to History and frees the table.
    public OpResult Close(int orderId)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();

        var check = CheckOpen(c, tx, orderId);
        if (check is not null) return check;

        Exec(c, tx, "UPDATE Orders SET Status = 'Closed', ClosedAt = $now WHERE Id = $id", ("$now", Now()), ("$id", orderId));
        var order = LoadOrders(c, tx, "o.Id = $id", "o.Id", ("$id", orderId)).Single();
        tx.Commit();
        return OpResult.Success(order);
    }

    // ---------- Helpers ----------

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        return c;
    }

    private static OpResult? CheckOpen(SqliteConnection c, SqliteTransaction tx, int orderId)
    {
        var status = Scalar(c, tx, "SELECT Status FROM Orders WHERE Id = $id", ("$id", orderId)) as string;
        if (status is null) return OpResult.NotFound($"Order {orderId} does not exist.");
        if (status != "Open") return OpResult.Conflict($"Order {orderId} is already closed.");
        return null;
    }

    // Loads orders with their items in one query. `where` and `orderBy` are fixed strings
    // from this file; user input only ever goes in through parameters.
    private static List<OrderDto> LoadOrders(SqliteConnection c, SqliteTransaction? tx, string where, string orderBy,
        params (string Name, object? Value)[] args)
    {
        using var cmd = Cmd(c, tx, $"""
            SELECT o.Id, o.TableNumber, o.Waiter, o.Status, o.CreatedAt, o.ClosedAt,
                   i.Id, i.MenuItemId, m.Name, i.Quantity, i.UnitPriceCents
            FROM Orders o
            LEFT JOIN OrderItems i ON i.OrderId = o.Id
            LEFT JOIN MenuItems m ON m.Id = i.MenuItemId
            WHERE {where}
            ORDER BY {orderBy}, o.Id, i.Id
            """, args);
        using var r = cmd.ExecuteReader();

        var orders = new List<OrderDto>();
        OrderDto? current = null;
        while (r.Read())
        {
            var id = r.GetInt32(0);
            if (current?.Id != id)
            {
                current = new OrderDto(id, r.GetInt32(1), r.GetString(2), r.GetString(3),
                    ParseUtc(r.GetString(4)), r.IsDBNull(5) ? null : ParseUtc(r.GetString(5)), []);
                orders.Add(current);
            }
            if (!r.IsDBNull(6))
                current.Items.Add(new OrderItemDto(r.GetInt32(6), r.GetInt32(7), r.GetString(8), r.GetInt32(9), r.GetInt64(10) / 100m));
        }
        return orders;
    }

    private static SqliteCommand Cmd(SqliteConnection c, SqliteTransaction? tx, string sql, params (string Name, object? Value)[] args)
    {
        var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    private static void Exec(SqliteConnection c, SqliteTransaction? tx, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = Cmd(c, tx, sql, args);
        cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection c, SqliteTransaction? tx, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = Cmd(c, tx, sql, args);
        var value = cmd.ExecuteScalar();
        return value is DBNull ? null : value;
    }

    private static string Now() => DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);

    private static DateTime ParseUtc(string value) =>
        DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
