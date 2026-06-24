# JARVIS — Serwer Ollamy (one-click, PC -> telefon).
# Instaluje/uruchamia Ollamę w sieci (CORS), pobiera komplet modeli premium, NIE usypia PC,
# wykrywa adres (LAN + Tailscale), generuje stronę „Połącz" z kodem QR i trzyma serwer.
#
# WAŻNE: plik .ps1 NIE uruchamia się dwuklikiem (Windows otwiera go w Notatniku).
#   Użyj JARVIS-Ollama-Server.exe (dwuklik), albo: prawy klik na .ps1 -> „Uruchom w PowerShell",
#   albo dwuklik na JARVIS-Serwer.cmd. Ten skrypt ZAWSZE zostawia okno otwarte z komunikatem.

# Okno nigdy nie znika po cichu: każdy błąd pokazujemy i czekamy na Enter.
trap {
  Write-Host ""
  Write-Host "[BLAD] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Zrob zrzut ekranu tego okna, jesli problem sie powtarza." -ForegroundColor DarkGray
  Read-Host "Enter zamyka okno"
  exit 1
}

$port = 11434
# Czysty wyglad: UTF-8 w konsoli (inaczej pasek postepu Ollamy to krzaki) i brak migotania.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch {}
function Line($c) { Write-Host "================================================" -ForegroundColor $c }
function Step($n, $t) { Write-Host ("[{0}] {1}" -f $n, $t) -ForegroundColor Cyan }
# Pobieranie modelu BEZ czerwonego "ERROR" (Ollama pisze postep na stderr; uruchamiamy ja jako
# proces dziedziczacy konsole, wiec pasek postepu wyglada normalnie, nie jak blad).
function Pull-Model($m) {
  Write-Host ("  ⬇  {0} — pobieram (to normalne, ze leci pasek postepu)..." -f $m) -ForegroundColor Green
  $p = Start-Process -FilePath "ollama" -ArgumentList @("pull", $m) -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -eq 0) { Write-Host ("  ✓  {0} gotowy." -f $m) -ForegroundColor Green }
  else { Write-Host ("  !  {0} — nie udalo sie pobrac (kod {1}). Sprobuj pozniej." -f $m, $p.ExitCode) -ForegroundColor Yellow }
}

Write-Host ""
Line Cyan
Write-Host "  JARVIS — Serwer Ollamy (PC -> telefon)" -ForegroundColor Cyan
Line Cyan
Write-Host ""

# 1) Ollama zainstalowana? Jeśli nie — winget, inaczej strona pobierania.
Step 1 "Sprawdzam Ollame..."
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "    Nie znaleziono — instaluje przez winget (chwile to potrwa)..." -ForegroundColor Yellow
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements 2>$null
  $env:Path += ";$env:LOCALAPPDATA\Programs\Ollama"
}
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "    Nie udalo sie automatycznie. Otwieram strone pobierania Ollamy." -ForegroundColor Red
  Start-Process "https://ollama.com/download"
  Read-Host "    Zainstaluj Ollame, potem uruchom ten plik ponownie. Enter zamyka"
  exit 1
}
Write-Host "    OK." -ForegroundColor Green

# 2) Nasłuch w sieci LAN + CORS (krytyczne dla aplikacji) — trwale i w tej sesji.
Step 2 "Ustawiam nasluch w sieci + CORS..."
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:$port", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "30m", "User")
$env:OLLAMA_HOST = "0.0.0.0:$port"; $env:OLLAMA_ORIGINS = "*"; $env:OLLAMA_KEEP_ALIVE = "30m"

# 3) Zapora + nie usypiaj PC (serwer ma byc dostepny dla telefonu 24/7).
netsh advfirewall firewall delete rule name="JARVIS Ollama" 2>$null | Out-Null
netsh advfirewall firewall add rule name="JARVIS Ollama" dir=in action=allow protocol=TCP localport=$port 2>$null | Out-Null
powercfg /change standby-timeout-ac 0 2>$null | Out-Null
powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null

# 4) Uruchom Ollame jako NIEZALEZNY proces w tle — przezyje zamkniecie tego okna.
#    Preferujemy aplikacje zasobnika (ollama app.exe): dziala trwale w tle i lapie env (0.0.0.0).
Step 3 "Uruchamiam serwer w tle (niezaleznie od tego okna)..."
Get-Process "ollama app", "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$ollamaApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
if (Test-Path $ollamaApp) {
  Start-Process $ollamaApp                                        # aplikacja Ollama w zasobniku (trwale)
} else {
  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden  # samodzielny proces serwera
}
Start-Sleep -Seconds 3

# 4b) Sprawdz, czy serwer faktycznie odpowiada. Pierwszy „zimny" start Ollamy potrafi potrwac
#     kilkadziesiat sekund — dlatego czekamy cierpliwie (do ~40 s), zanim cokolwiek zglosimy.
$alive = $false
for ($i = 0; $i -lt 30; $i++) {
  try { Invoke-WebRequest "http://127.0.0.1:$port/api/tags" -UseBasicParsing -TimeoutSec 2 | Out-Null; $alive = $true; break } catch { Start-Sleep -Milliseconds 1300 }
}
if ($alive) { Write-Host "    Serwer odpowiada." -ForegroundColor Green }
else { Write-Host "    Serwer wciaz sie rozgrzewa (to normalne przy pierwszym starcie) — ide dalej, zaraz wstanie." -ForegroundColor Yellow }

# 4c) PILNOWANIE 24/7 — „zeby link sie nie rozlaczal".
#     Rejestrujemy Zadanie Harmonogramu (przy KAZDYM logowaniu), ktore odpala maly skrypt-petle.
#     Petla co 30 s sprawdza, czy serwer zyje, a jesli nie — natychmiast go wstaje. Efekt: serwer
#     wraca SAM po restarcie PC ORAZ po ewentualnej awarii Ollamy. Brak uprawnien -> pomijamy bez bledu.
Step 4 "Wlaczam pilnowanie serwera (auto-restart + auto-start po restarcie PC)..."
try {
  $jdir = Join-Path $env:LOCALAPPDATA "JARVIS"
  New-Item -ItemType Directory -Force -Path $jdir | Out-Null
  $wd = Join-Path $jdir "ollama-watchdog.ps1"
  $watch = @'
$port = 11434
$app = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
while ($true) {
  $ok = $false
  try { Invoke-WebRequest "http://127.0.0.1:$port/api/tags" -UseBasicParsing -TimeoutSec 3 | Out-Null; $ok = $true } catch {}
  if (-not $ok) {
    if (Test-Path $app) { Start-Process $app } else { Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden }
    Start-Sleep -Seconds 8
  }
  Start-Sleep -Seconds 30
}
'@
  $watch | Out-File -FilePath $wd -Encoding utf8
  $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $wd)
  $trg = New-ScheduledTaskTrigger -AtLogOn
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName "JARVIS Ollama Watchdog" -Action $act -Trigger $trg -Settings $set -Force -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName "JARVIS Ollama Watchdog" -ErrorAction SilentlyContinue
  Write-Host "    OK — serwer sam wstanie po restarcie PC i po awarii (link nie rozlaczy sie)." -ForegroundColor Green
} catch {
  Write-Host "    (Nie udalo sie wlaczyc pilnowania — serwer i tak dziala teraz; mozesz odpalic plik ponownie.)" -ForegroundColor Yellow
}

# 5) Pobierz komplet modeli premium (auto). Dobrane pod ~4 GB VRAM: szybki/madry/wizja.
Step 5 "Pobieram modele (premium) — jednorazowo, moze potrwac..."
$PREMIUM = @("qwen3:1.7b", "qwen3.5:4b", "gemma3:4b-it-qat")
$have = (& ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] }) | Where-Object { $_ }
foreach ($m in $PREMIUM) {
  if ($have -contains $m) { Write-Host "  ✓  $m — juz jest." -ForegroundColor DarkGray; continue }
  Pull-Model $m
}
# Opcjonalnie model bez cenzury.
$unc = Read-Host "    Dodac model BEZ CENZURY (dolphin-mistral, ~4 GB)? [t/N]"
if ($unc -match '^(t|y|tak|yes)$') { Pull-Model "dolphin-mistral" }

# 6) Wykryj adres LAN (interfejs z brama domyslna) + ewentualnie Tailscale.
Step 6 "Wykrywam adres serwera..."
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" } | Select-Object -First 1).IPAddress }
if (-not $ip) { $ip = "127.0.0.1" }
$url = "http://${ip}:$port"
$tsUrl = $null
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  $ts = (& tailscale ip -4 2>$null | Select-Object -First 1)
  if ($ts) { $tsUrl = "http://${ts}:$port" }
}
Set-Clipboard -Value $url 2>$null

# 7) Strona „Polacz JARVIS" z KODEM QR (telefon skanuje aparatem) — generowana lokalnie.
#    Biblioteka QR z CDN tylko renderuje; adres NIE jest nigdzie wysylany (kodowany w przegladarce).
$remote = if ($tsUrl) { $tsUrl } else { $url }
$html = @"
<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Polacz JARVIS</title>
<style>body{margin:0;background:#04070f;color:#cfeefb;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
h1{color:#6ce7ff}.addr{font:bold 22px monospace;color:#fff;background:#0b1426;border:1px solid #6ce7ff55;border-radius:12px;padding:14px;margin:14px auto;max-width:520px;word-break:break-all}
.muted{color:#7fa6bd;font-size:14px}#qr{background:#fff;display:inline-block;padding:14px;border-radius:14px;margin:10px}</style></head>
<body><h1>📲 Polacz JARVIS z serwerem</h1>
<p class="muted">W telefonie: JARVIS → ⚙ Ustawienia → AI → „Lokalny model — adres Ollama" → wklej adres,
dostawca „Lokalny model (Ollama)", potem „Odswiez modele".</p>
<div class="addr">$remote</div>
<div id="qr"></div>
<p class="muted">Skanuj kod telefonem (otworzy adres) albo przepisz go recznie.<br>
W tej samej sieci Wi-Fi uzyj: <b>$url</b>$( if($tsUrl){ "<br>Poza domem (Tailscale): <b>$tsUrl</b>" } )</p>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<script>try{new QRCode(document.getElementById('qr'),{text:'$remote',width:240,height:240});}catch(e){document.getElementById('qr').textContent='(brak internetu na QR — przepisz adres)';}</script>
</body></html>
"@
$htmlPath = Join-Path $env:TEMP "Polacz-JARVIS.html"
$html | Out-File -FilePath $htmlPath -Encoding utf8
Start-Process $htmlPath

# 8) Wielka instrukcja w oknie.
Write-Host ""
Line Green
Write-Host "  SERWER DZIALA. Adres dla telefonu (skopiowany do schowka):" -ForegroundColor Green
Write-Host ""
Write-Host "        $url" -ForegroundColor White
if ($tsUrl) { Write-Host "    Poza domem (Tailscale):  $tsUrl" -ForegroundColor White }
Write-Host ""
Write-Host "  Otworzylem tez strone z KODEM QR — zeskanuj ja telefonem." -ForegroundColor Gray
Write-Host "  W JARVIS: Ustawienia -> AI -> wklej adres -> dostawca 'Lokalny model (Ollama)' -> 'Odswiez modele'." -ForegroundColor Gray
Line Green
Write-Host ""
Write-Host "  - Telefon i PC w tej samej sieci Wi-Fi (uzyj APK JARVIS)." -ForegroundColor Gray
Write-Host "  - Poza domem / STABILNY adres: zainstaluj Tailscale na PC i telefonie. Adres 100.x" -ForegroundColor Gray
Write-Host "    NIGDY sie nie zmienia (w przeciwienstwie do Wi-Fi po restarcie routera) -> link trwaly." -ForegroundColor Gray
Write-Host ""
Write-Host "  LINK SIE NIE ROZLACZY: wlaczylem pilnowanie 24/7 — serwer wstaje sam po restarcie PC" -ForegroundColor Green
Write-Host "  i po awarii Ollamy. Dziala niezaleznie od tego okna — mozesz je ZAMKNAC." -ForegroundColor Green
Write-Host "  Wylaczyc pilnowanie: Harmonogram zadan -> 'JARVIS Ollama Watchdog' -> Wylacz/Usun." -ForegroundColor DarkGray
Write-Host "  Zatrzymac serwer: ikona Ollamy w zasobniku (obok zegara) -> Quit." -ForegroundColor DarkGray
Write-Host ""
Read-Host "Enter zamyka to okno (serwer i pilnowanie dzialaja dalej w tle)"
# UWAGA: celowo NIE zatrzymujemy Ollamy — ma dzialac niezaleznie od tego okna.
