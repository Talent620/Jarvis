# JARVIS — Serwer obrazów (Stable Diffusion) one-click, PC -> telefon.
# Dopisuje do Twojego Automatic1111/Forge wymagane flagi (--api --listen --cors-allow-origins=*),
# wyłącza usypianie PC, startuje serwer i POKAZUJE gotowy adres do wklejenia w JARVIS (Studio).
#
# JAK UŻYĆ: połóż ten plik (albo JARVIS-SD-Server.exe / JARVIS-SD.cmd) W FOLDERZE swojego
# Forge/A1111 — tam, gdzie jest "webui-user.bat" — i uruchom. (Plik .ps1 nie odpala sie dwuklikiem;
# uzyj .exe albo JARVIS-SD.cmd.)

trap {
  Write-Host ""
  Write-Host "[BLAD] $($_.Exception.Message)" -ForegroundColor Red
  Read-Host "Enter zamyka okno"; exit 1
}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch {}
$port = 7860
function Line($c) { Write-Host "================================================" -ForegroundColor $c }

Write-Host ""; Line Cyan
Write-Host "  JARVIS — Serwer obrazow (Stable Diffusion)" -ForegroundColor Cyan
Line Cyan; Write-Host ""

# 1) Znajdz webui-user.bat: argument -> folder skryptu -> biezacy katalog.
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$bat = $null
if ($args.Count -ge 1 -and (Test-Path $args[0])) { $bat = (Resolve-Path $args[0]).Path }
elseif (Test-Path (Join-Path $dir "webui-user.bat")) { $bat = Join-Path $dir "webui-user.bat" }
elseif (Test-Path (Join-Path (Get-Location) "webui-user.bat")) { $bat = Join-Path (Get-Location) "webui-user.bat" }

if (-not $bat) {
  Write-Host "Nie znalazlem 'webui-user.bat'." -ForegroundColor Red
  Write-Host "Polozyc ten plik w FOLDERZE swojego Forge/A1111 (tam gdzie jest webui-user.bat) i uruchom ponownie." -ForegroundColor Yellow
  Write-Host "Nie masz jeszcze SD? Forge: https://github.com/lllyasviel/stable-diffusion-webui-forge" -ForegroundColor Gray
  Start-Process "https://github.com/lllyasviel/stable-diffusion-webui-forge"
  Read-Host "Enter zamyka okno"; exit 1
}
Write-Host "Znalazlem: $bat" -ForegroundColor Green

# 2) Dopisz wymagane flagi do COMMANDLINE_ARGS (bez duplikowania).
$need = @("--api", "--listen", "--cors-allow-origins=*")
$lines = Get-Content $bat
$argLineIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*set\s+COMMANDLINE_ARGS=') { $argLineIdx = $i; break } }
if ($argLineIdx -ge 0) {
  $cur = $lines[$argLineIdx]
  foreach ($f in $need) { if ($cur -notmatch [regex]::Escape($f)) { $cur = $cur.TrimEnd() + " $f" } }
  $lines[$argLineIdx] = $cur
} else {
  $lines += "set COMMANDLINE_ARGS=$($need -join ' ')"
}
# Kopia zapasowa + zapis.
Copy-Item $bat "$bat.jarvis.bak" -Force -ErrorAction SilentlyContinue
$lines | Set-Content $bat -Encoding ASCII
Write-Host "Ustawilem API + dostep w sieci + CORS w webui-user.bat (kopia: webui-user.bat.jarvis.bak)." -ForegroundColor Green

# 3) Zapora + nie usypiaj PC (serwer 24/7 dla telefonu).
netsh advfirewall firewall delete rule name="JARVIS SD" 2>$null | Out-Null
netsh advfirewall firewall add rule name="JARVIS SD" dir=in action=allow protocol=TCP localport=$port 2>$null | Out-Null
powercfg /change standby-timeout-ac 0 2>$null | Out-Null
powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null

# 4) Wykryj adres LAN + Tailscale.
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" } | Select-Object -First 1).IPAddress }
if (-not $ip) { $ip = "127.0.0.1" }
$url = "http://${ip}:$port"
Set-Clipboard -Value $url 2>$null
$tsUrl = $null
if (Get-Command tailscale -ErrorAction SilentlyContinue) { $ts = (& tailscale ip -4 2>$null | Select-Object -First 1); if ($ts) { $tsUrl = "http://${ts}:$port" } }

# 5) Start serwera (pierwsze uruchomienie pobiera zaleznosci — moze potrwac).
Write-Host ""; Write-Host "Uruchamiam Stable Diffusion (pierwszy raz dluzej)..." -ForegroundColor Cyan
Start-Process -FilePath $bat -WorkingDirectory (Split-Path $bat)

Write-Host ""; Line Green
Write-Host "  SERWER OBRAZOW RUSZA. Adres dla telefonu (skopiowany do schowka):" -ForegroundColor Green
Write-Host ""
Write-Host "        $url" -ForegroundColor White
if ($tsUrl) { Write-Host "    Poza domem (Tailscale):  $tsUrl" -ForegroundColor White }
Write-Host ""
Write-Host "  W JARVIS: ⚙ -> AI -> '🖼 Lokalny generator obrazow' -> wklej adres." -ForegroundColor Gray
Write-Host "  Potem w Studiu wybierz 'Lokalny (Stable Diffusion)'." -ForegroundColor Gray
Line Green
Write-Host ""
Write-Host "  ZOSTAW OKNO SERWERA SD OTWARTE (to drugie, ktore sie wlasnie uruchomilo)." -ForegroundColor Yellow
Read-Host "Enter zamyka to okno pomocnicze (serwer SD dziala w swoim oknie)"
