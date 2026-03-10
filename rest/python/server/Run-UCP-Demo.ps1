<#
.SYNOPSIS
  End-to-end runner for UCP samples: sync repos, rebuild DB, start server, run discovery,
  create checkout session, and compare response shape with README example.

.PARAMETER SdkPath
  Path to the Python SDK repo relative to the current folder. Default: "sdk/python".

.PARAMETER ServerPath
  Path to the UCP sample server (FastAPI) relative to the current folder. Default: "samples/rest/python/server".

.PARAMETER DataDir
  Path to flower shop test data relative to ServerPath. Default: "../test_data/flower_shop".

.PARAMETER DbRoot
  Folder for local SQLite DBs. Default: "/tmp/ucp_test".

.PARAMETER Port
  Port for the server. Default: 8182.

.PARAMETER UseExistingRepos
  If $true, skip cloning and only run uv sync. Default: $true.

.PARAMETER AutoKill
  If $true, stops the server at the end. Default: $false.

.NOTES
  Requires: PowerShell 7+ recommended (works on Windows PowerShell 5.1 with -UseBasicParsing in Invoke-WebRequest),
            uv installed and available on PATH, python & FastAPI dependencies resolved via uv.

#>

param(
  [string]$SdkPath = "sdk/python",
  [string]$ServerPath = "samples/rest/python/server",
  [string]$DataDir = "../test_data/flower_shop",
  [string]$DbRoot = "/tmp/ucp_test",
  [int]$Port = 8182,
  [bool]$UseExistingRepos = $true,
  [bool]$AutoKill = $false
)

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' not found on PATH. Please install it and try again."
  }
}

function Invoke-UV {
  param([string]$WorkingDir, [string[]]$Args)
  Push-Location $WorkingDir
  try {
    Write-Host ">> uv $($Args -join ' ')" -ForegroundColor Cyan
    & uv @Args
  } finally {
    Pop-Location
  }
}

function Wait-For-Server {
  param([string]$Url, [int]$TimeoutSec = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    try {
      $r = Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 5
      return $true
    } catch {
      Start-Sleep -Seconds 1
    }
  } while ((Get-Date) -lt $deadline)
  return $false
}

function ConvertTo-PrettyJson {
  param([Parameter(ValueFromPipeline=$true)]$InputObject, [int]$Depth = 50)
  $InputObject | ConvertTo-Json -Depth $Depth | Out-String -Width 4096
}

function Compare-JsonShape {
  <#
    Compares the "shape" (keys) of two JSON objects recursively.
    Ignores value differences except for type mismatches.
  #>
  param(
    [Parameter(Mandatory=$true)]$Expected,
    [Parameter(Mandatory=$true)]$Actual,
    [string]$Path = "$"
  )

  $diffs = New-Object System.Collections.Generic.List[object]

  if ($Expected -is [System.Collections.IDictionary] -and $Actual -is [System.Collections.IDictionary]) {
    $expKeys = [string[]]$Expected.Keys
    $actKeys = [string[]]$Actual.Keys

    foreach ($k in ($expKeys | Sort-Object)) {
      $newPath = "$Path.$k"
      if (-not $Actual.ContainsKey($k)) {
        $diffs.Add([pscustomobject]@{ Path = $newPath; Issue = "Missing in Actual" })
        continue
      }
      # recurse
      $diffs.AddRange( (Compare-JsonShape -Expected $Expected[$k] -Actual $Actual[$k] -Path $newPath) )
    }
    foreach ($k in ($actKeys | Sort-Object)) {
      if (-not $Expected.ContainsKey($k)) {
        $diffs.Add([pscustomobject]@{ Path = "$Path.$k"; Issue = "Extra in Actual" })
      }
    }
  }
  elseif ($Expected -is [System.Collections.IEnumerable] -and $Expected -isnot [string] `
       -and $Actual   -is [System.Collections.IEnumerable] -and $Actual   -isnot [string]) {
    # Compare first element shape (representative) if any
    $expFirst = $Expected | Select-Object -First 1
    $actFirst = $Actual   | Select-Object -First 1
    if ($null -ne $expFirst -and $null -ne $actFirst) {
      $diffs.AddRange( (Compare-JsonShape -Expected $expFirst -Actual $actFirst -Path "$Path[0]") )
    } elseif ($null -ne $expFirst -and $null -eq $actFirst) {
      $diffs.Add([pscustomobject]@{ Path = "$Path[]"; Issue = "Expected non-empty array, Actual empty" })
    } elseif ($null -eq $expFirst -and $null -ne $actFirst) {
      $diffs.Add([pscustomobject]@{ Path = "$Path[]"; Issue = "Expected empty array, Actual non-empty" })
    }
  }
  else {
    # Basic type check (optional)
    if ($Expected.GetType().FullName -ne $Actual.GetType().FullName) {
      $diffs.Add([pscustomobject]@{ Path = $Path; Issue = "Type differs (Expected: $($Expected.GetType().Name), Actual: $($Actual.GetType().Name))" })
    }
  }

  return ,$diffs
}

# ----- Preconditions -----
Assert-Command -Name "uv"
Assert-Command -Name "python"

# ----- Repo Sync (optional clone steps are commented; the README shows the expected layout) -----
# If needed, you can uncomment the clone steps below to match the README exactly:
#   mkdir sdk
#   git clone https://github.com/Universal-Commerce-Protocol/python-sdk.git sdk/python
#   pushd sdk/python; uv sync; popd
#   git clone https://github.com/Universal-Commerce-Protocol/samples.git
#   cd samples/rest/python/server; uv sync
# The README expects this layout and uses 'uv sync' in both SDK and Samples. (Reference)  [README] [1](https://opussoft-my.sharepoint.com/personal/manas_singh_opustechglobal_com/Documents/Microsoft%20Copilot%20Chat%20Files/README.md)

Write-Host "Syncing SDK and Server via uv..." -ForegroundColor Green
Invoke-UV -WorkingDir $SdkPath    -Args @("sync")
Invoke-UV -WorkingDir $ServerPath -Args @("sync")

# ----- DB Rebuild -----
Write-Host "Rebuilding sample SQLite DB at $DbRoot..." -ForegroundColor Green
# Clean DB folder
try { Remove-Item -Recurse -Force $DbRoot -ErrorAction SilentlyContinue } catch {}
New-Item -ItemType Directory -Path $DbRoot -Force | Out-Null

$productsDb     = Join-Path $DbRoot "products.db"
$transactionsDb = Join-Path $DbRoot "transactions.db"

Invoke-UV -WorkingDir $ServerPath -Args @(
  "run","import_csv.py",
  "--products_db_path=$productsDb",
  "--transactions_db_path=$transactionsDb",
  "--data_dir=$DataDir"
)

# ----- Start Server -----
Write-Host "Starting UCP Merchant Server on port $Port..." -ForegroundColor Green
$serverArgs = @(
  "run","server.py",
  "--products_db_path=$productsDb",
  "--transactions_db_path=$transactionsDb",
  "--port=$Port"
)

# Start as a background process
$serverProc = Start-Process -FilePath "uv" -ArgumentList $serverArgs -NoNewWindow -PassThru
Write-Host "Server PID: $($serverProc.Id)"

# Wait for readiness by polling discovery endpoint
$discUrl = "http://localhost:$Port/.well-known/ucp"
if (-not (Wait-For-Server -Url $discUrl -TimeoutSec 60)) {
  throw "Server did not become ready on $discUrl within timeout."
}

# ----- Fetch Discovery -----
Write-Host "`n=== Discovery (Pretty JSON) ===" -ForegroundColor Yellow
$discovery = Invoke-RestMethod -Uri $discUrl -Method GET
$discovery | ConvertTo-PrettyJson

# Basic check for expected capabilities/handlers (from README)
$expectedCaps = @("dev.ucp.shopping.checkout","dev.ucp.shopping.discount","dev.ucp.shopping.fulfillment")
$discCaps = @($discovery.ucp.capabilities | ForEach-Object { $_.name })
Write-Host "`nCapabilities advertised: $($discCaps -join ', ')" -ForegroundColor Cyan

$missingCaps = $expectedCaps | Where-Object { $_ -notin $discCaps }
if ($missingCaps.Count -gt 0) {
  Write-Warning "Missing capabilities vs README: $($missingCaps -join ', ')"
}

# ----- Create Checkout Session -----
# Use the same body you used previously (can be adjusted here as a hashtable and converted to JSON)
$bodyJson = @'
{
  "line_items": [
    {
      "item": { "id": "bouquet_roses", "title": "Red Rose" },
      "quantity": 1
    }
  ],
  "buyer": { "full_name": "John Doe", "email": "john.doe@example.com" },
  "currency": "USD",
  "payment": {
    "instruments": [],
    "handlers": [
      {
        "id": "shop_pay",
        "name": "com.shopify.shop_pay",
        "version": "2026-01-11",
        "spec": "https://shopify.dev/ucp/handlers/shop_pay",
        "config_schema": "https://shopify.dev/ucp/handlers/shop_pay/config.json",
        "instrument_schemas": [
          "https://shopify.dev/ucp/handlers/shop_pay/instrument.json"
        ],
        "config": {
          "shop_id": "8f1947e7-0d98-4d5c-a65a-2b622ef07239"
        }
      },
      {
        "id": "google_pay",
        "name": "google.pay",
        "version": "2026-01-11",
        "spec": "https://example.com/spec",
        "config_schema": "https://example.com/schema",
        "instrument_schemas": [
          "https://ucp.dev/schemas/shopping/types/gpay_card_payment_instrument.json"
        ],
        "config": {
          "api_version": 2,
          "api_version_minor": 0,
          "merchant_info": {
            "merchant_name": "Flower Shop",
            "merchant_id": "TEST",
            "merchant_origin": "localhost"
          },
          "allowed_payment_methods": [
            {
              "type": "CARD",
              "parameters": {
                "allowedAuthMethods": ["PAN_ONLY", "CRYPTOGRAM_3DS"],
                "allowedCardNetworks": ["VISA", "MASTERCARD"]
              },
              "tokenization_specification": [
                {
                  "type": "PAYMENT_GATEWAY",
                  "parameters": [
                    { "gateway": "example", "gatewayMerchantId": "exampleGatewayMerchantId" }
                  ]
                }
              ]
            }
          ]
        }
      }
    ]
  }
}
'@

$headers = @{
  "UCP-Agent"       = 'profile="https://agent.example/profile"'
  "request-signature" = "test"
  "idempotency-key" = [guid]::NewGuid().ToString()
  "request-id"      = [guid]::NewGuid().ToString()
}

Write-Host "`n=== Creating checkout session ===" -ForegroundColor Yellow
$checkoutUrl = "http://localhost:$Port/checkout-sessions"
$createResp = Invoke-RestMethod -Uri $checkoutUrl -Method POST -ContentType "application/json" -Headers $headers -Body $bodyJson

Write-Host "`n--- Create Response (Pretty JSON) ---" -ForegroundColor Yellow
$createResp | ConvertTo-PrettyJson

# ----- Compare response shape with README's expected JSON -----
$expectedCreateJson = @'
{
  "ucp": {
    "version": "2026-01-11",
    "capabilities": [
      { "name": "dev.ucp.shopping.checkout", "version": "2026-01-11", "spec": null, "schema": null, "extends": null, "config": null }
    ]
  },
  "id": "f49bc32e-068e-4b9a-bd17-a02757710f53",
  "line_items": [
    {
      "id": "e5df4cad-e229-4cbe-a29e-69e94f4ec12b",
      "item": { "id": "bouquet_roses", "title": "Bouquet of Red Roses", "price": 3500, "image_url": null },
      "quantity": 1,
      "totals": [
        { "type": "subtotal", "display_text": null, "amount": 3500 },
        { "type": "total", "display_text": null, "amount": 3500 }
      ],
      "parent_id": null
    }
  ],
  "buyer": { "first_name": null, "last_name": null, "full_name": "John Doe", "email": "john.doe@example.com", "phone_number": null, "consent": null },
  "status": "ready_for_complete",
  "currency": "USD",
  "totals": [
    { "type": "subtotal", "display_text": null, "amount": 3500 },
    { "type": "total", "display_text": null, "amount": 3500 }
  ],
  "messages": null,
  "links": [],
  "expires_at": null,
  "continue_url": null,
  "payment": { "handlers": [], "selected_instrument_id": null, "instruments": [] },
  "order_id": null,
  "order_permalink_url": null,
  "ap2": null,
  "discounts": { "codes": null, "applied": null },
  "fulfillment": null,
  "fulfillment_address": null,
  "fulfillment_options": null,
  "fulfillment_option_id": null,
  "platform": null
}
'@

$expectedObj = $expectedCreateJson | ConvertFrom-Json
$actualObj   = $createResp

Write-Host "`n=== Shape Diff vs README Example ===" -ForegroundColor Yellow
$diff = Compare-JsonShape -Expected $expectedObj -Actual $actualObj
if ($diff.Count -eq 0) {
  Write-Host "Shapes match (keys) ✅" -ForegroundColor Green
} else {
  $diff | Format-Table -AutoSize
}

if ($AutoKill -and $serverProc -and -not $serverProc.HasExited) {
  Write-Host "`nStopping server PID $($serverProc.Id)..." -ForegroundColor Yellow
  Stop-Process -Id $serverProc.Id -Force
}