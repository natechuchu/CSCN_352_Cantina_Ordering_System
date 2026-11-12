# Deploying Cantina Orders to IIS on ORRR-W2025

The app is a single ASP.NET Core site. IIS hosts it, the pages and the API come from the same address, and the orders are stored in one SQLite file on the server.

| Setting | Value |
|---|---|
| Server | `ORRR-W2025` |
| Site folder | `C:\inetpub\CantinaOrders` |
| Database file | `C:\inetpub\CantinaOrders\App_Data\cantina.db` (created on first start) |
| IIS site name | `CantinaOrders` |
| Application pool | `CantinaOrders` (No Managed Code) |
| Port | `8080` |
| Address from workstations | `http://ORRR-W2025:8080` |

Port 8080 keeps the Default Web Site on port 80 untouched. If you'd rather use port 80, stop the Default Web Site and use 80 everywhere this guide says 8080.

Run all server commands in **PowerShell as Administrator**. Each step also gives the IIS Manager (GUI) route, which is better for screenshots.

---

## Part A: On the server: one-time setup

### A1. Install the IIS role

**GUI:** Server Manager → Manage → Add Roles and Features → Server Roles → **Web Server (IIS)** → keep the default role services → Install.

**PowerShell:**

```powershell
Install-WindowsFeature Web-Server -IncludeManagementTools
```

Check it: browse to `http://localhost` on the server. You should see the blue IIS welcome page.

### A2. Install the ASP.NET Core 10 Hosting Bundle

The Hosting Bundle adds the .NET 10 runtime and the **ASP.NET Core Module**, which is how IIS runs the app.

1. On any machine with internet, go to <https://dotnet.microsoft.com/download/dotnet/10.0>. Under **ASP.NET Core Runtime 10.0.x → Windows**, download **Hosting Bundle** (`dotnet-hosting-10.0.x-win.exe`).
2. Copy it to the server and run it.
3. Restart IIS so it loads the new module:

   ```powershell
   net stop was /y
   net start w3svc
   ```

4. Check it:

   ```powershell
   Get-WebGlobalModule -Name AspNetCoreModuleV2
   dotnet --list-runtimes    # should list Microsoft.AspNetCore.App 10.0.x
   ```

> **Install IIS first, then the Hosting Bundle.** If the bundle went on before IIS, run the bundle installer again and choose **Repair**.

---

## Part B: On the server: create the site

### B1. Put the files in place

```powershell
New-Item -ItemType Directory -Force C:\inetpub\CantinaOrders | Out-Null
Unblock-File .\CantinaOrders.zip     # only matters if the zip was downloaded from the internet
Expand-Archive .\CantinaOrders.zip -DestinationPath C:\inetpub\CantinaOrders -Force
New-Item -ItemType Directory -Force C:\inetpub\CantinaOrders\App_Data | Out-Null
```

Check that `C:\inetpub\CantinaOrders` now contains `web.config`, `CantinaOrders.dll`, `wwwroot\`, and the empty `App_Data\`.

### B2. Create the application pool

**GUI:** IIS Manager → *ORRR-W2025* → **Application Pools** → Add Application Pool:

- Name: `CantinaOrders`
- .NET CLR version: **No Managed Code**
- Managed pipeline mode: Integrated

**PowerShell:**

```powershell
Import-Module WebAdministration
New-WebAppPool -Name CantinaOrders
Set-ItemProperty IIS:\AppPools\CantinaOrders -Name managedRuntimeVersion -Value ''
```

"No Managed Code" is correct here. ASP.NET Core runs through the ASP.NET Core Module, not the old .NET Framework CLR.

### B3. Create the website

**GUI:** IIS Manager → **Sites** → Add Website:

- Site name: `CantinaOrders`
- Application pool: **Select…** → `CantinaOrders`
- Physical path: `C:\inetpub\CantinaOrders`
- Binding: http, All Unassigned, port **8080**, host name blank

**PowerShell:**

```powershell
New-Website -Name CantinaOrders -Port 8080 -PhysicalPath C:\inetpub\CantinaOrders -ApplicationPool CantinaOrders
```

### B4. Give the app pool NTFS permissions

The site runs as the virtual account **`IIS AppPool\CantinaOrders`**. That account exists only after step B2.

| Folder | Permission | Why |
|---|---|---|
| `C:\inetpub\CantinaOrders` | Read & execute | Load the app and serve the pages |
| `C:\inetpub\CantinaOrders\App_Data` | **Modify** | SQLite writes the database plus its `-wal` and `-shm` side files here |

Grant write access on `App_Data` only, not the whole site. If the app were ever compromised, it couldn't rewrite its own code.

**GUI:** right-click the folder → Properties → Security → Edit → Add → click **Locations…** and choose the **server itself (ORRR-W2025)**, not the ORRR domain. Type `IIS AppPool\CantinaOrders`, click Check Names, then OK, and tick the permission.

**PowerShell:**

```powershell
icacls "C:\inetpub\CantinaOrders" /grant "IIS AppPool\CantinaOrders:(OI)(CI)RX"
icacls "C:\inetpub\CantinaOrders\App_Data" /grant "IIS AppPool\CantinaOrders:(OI)(CI)M"
icacls "C:\inetpub\CantinaOrders\App_Data"   # check: the account should show (M)
```

### B5. Open the firewall port

**GUI:** Windows Defender Firewall with Advanced Security → Inbound Rules → New Rule → Port → TCP **8080** → Allow → profiles **Domain** and **Private** → name it `Cantina Orders (TCP 8080)`.

**PowerShell:**

```powershell
New-NetFirewallRule -DisplayName 'Cantina Orders (TCP 8080)' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Domain,Private
Get-NetConnectionProfile    # the lab network should show DomainAuthenticated
```

---

## Part C: Test it

### C1. On the server

```powershell
Invoke-RestMethod http://localhost:8080/api/menu | Format-Table    # 10 menu items
Test-Path C:\inetpub\CantinaOrders\App_Data\cantina.db             # True after the first request
```

Then browse to `http://localhost:8080`. You should see the floor plan with a green **Live** badge.

### C2. From a workstation

```powershell
Test-NetConnection ORRR-W2025 -Port 8080    # TcpTestSucceeded : True
```

Browse to `http://ORRR-W2025:8080`. If the name doesn't resolve, which is common on the Linux workstation, use the server's full DNS name or its IP address from `ipconfig`.

```bash
curl http://ORRR-W2025:8080/api/menu
```

### C3. View and add data from two devices (the assignment demo)

Open the site on two machines at once, for example the Windows workstation and the Linux workstation. Sign each one in as a different user if you can, such as WaiterBot002 and WaiterBot003.

| # | Device | Action | Expected |
|---|---|---|---|
| 1 | Workstation A | Order page → Table 4 → add 2× Blue Milk and 1× Bantha Burger | Ticket shows a ξ23.00 subtotal |
| 2 | Workstation B | Floor page, no refresh | Within 5 seconds Table 4 turns amber with ξ23.00. Click it to see the items |
| 3 | Workstation B | Add Items → add 1× Corellian Ale | Subtotal ξ30.00 |
| 4 | Workstation A | Watch the ticket | Updates to ξ30.00 within 5 seconds |
| 5 | Workstation A | Close order | Table 4 goes back to cyan on both screens |
| 6 | Workstation B | History page | Order listed with its items and ξ30.00 |

**Screenshots to capture:**

- [ ] Server Manager or `Get-WindowsFeature Web-Server` showing IIS installed
- [ ] `Get-WebGlobalModule -Name AspNetCoreModuleV2` or `dotnet --list-runtimes` (Hosting Bundle installed)
- [ ] IIS Manager: the `CantinaOrders` app pool set to No Managed Code
- [ ] IIS Manager: the `CantinaOrders` site with its port 8080 binding
- [ ] `icacls` output for `App_Data` showing `IIS AppPool\CantinaOrders:(M)`
- [ ] The firewall rule
- [ ] Each step of the C3 demo, with the machine's name visible (run `hostname` in a window beside the browser)

---

## Part D: Updating the app later

1. Copy the new `CantinaOrders.zip` to the server.
2. On the server:

   ```powershell
   Stop-WebAppPool CantinaOrders
   Expand-Archive .\CantinaOrders.zip -DestinationPath C:\inetpub\CantinaOrders -Force
   Start-WebAppPool CantinaOrders
   ```

3. On each workstation, press **Ctrl+F5** so the browser picks up the new pages.

The zip has no `App_Data`, so copying over the old files keeps every order. **Don't delete the site folder before copying.** That would delete the database.

**Back up the orders:** stop the pool, copy `App_Data\cantina.db*` somewhere safe, then start the pool.

**Start with an empty database:** stop the pool, delete `App_Data\cantina.db*`, then start the pool. The menu is added again automatically.

---

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| **HTTP Error 500.19** (configuration data is invalid) | The ASP.NET Core Module isn't installed | Install or repair the Hosting Bundle (A2), then restart IIS |
| **500.31** Failed to locate ASP.NET Core framework | The server has an older .NET runtime, not 10 | Install the **.NET 10** Hosting Bundle |
| **500.30** In-process start failure | The app crashed while starting, usually because it couldn't create `App_Data` or the database | Check the B4 permissions and that `App_Data` exists. See "Find the real error" below |
| **503** Service Unavailable | The app pool is stopped | IIS Manager → Application Pools → start `CantinaOrders`. Event Viewer → System says why it stopped |
| Pages load, but adding an item shows "Request failed (500)" | The app can read but not write `App_Data` | `icacls ...\App_Data /grant "IIS AppPool\CantinaOrders:(OI)(CI)M"` |
| Works on the server but not from a workstation | Firewall or name resolution | `Test-NetConnection ORRR-W2025 -Port 8080`. Check the B5 rule. Try the IP address |
| Live badge says "Offline · retrying" | The browser can't reach the API | Same checks as above. Confirm `http://ORRR-W2025:8080/api/menu` returns data |
| Old pages after an update | Browser cache | Ctrl+F5 |
| Headings aren't in the futuristic font | No internet access for Google Fonts | Cosmetic only. The pages fall back to Segoe UI |

**Find the real error.** Open Event Viewer → Windows Logs → **Application** and look for source **IIS AspNetCore Module V2**. For more detail, turn on the app's own log for a short time:

1. Create `C:\inetpub\CantinaOrders\logs`, and grant the app pool Modify on it the same way as `App_Data`.
2. In `C:\inetpub\CantinaOrders\web.config`, change `stdoutLogEnabled="false"` to `"true"`.
3. Reload the page and read the newest `logs\stdout_*.log`.
4. Set it back to `"false"` when you're done. The logs grow without limit.
