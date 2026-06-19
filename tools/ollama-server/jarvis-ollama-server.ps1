# JARVIS — Serwer Ollamy (one-click).
# Ustawia Ollamę na nasłuch w sieci LAN (OLLAMA_HOST=0.0.0.0) + CORS (OLLAMA_ORIGINS=*),
# otwiera port w zaporze, startuje serwer, pobiera model i POKAZUJE + KOPIUJE gotowy adres
# do wklejenia w JARVIS (⚙ → AI → „Lokalny model — adres Ollama").
#
# Uruchamiasz na PC. Telefon (APK JARVIS) musi być w tej samej sieci Wi-Fi
# (albo połączony przez Tailscale — wtedy użyj adresu Tailscale).

$ErrorActionPreference = "SilentlyContinue"
$port  = 11434
$model = if ($args.Count -ge 1 -and $args[0]) { $args[0] } else { "llama3.2" }

function Line($c) { Write-Host "================================================" -ForegroundColor $c }

Write-Host ""
Line Cyan
Write-Host "  JARVIS — Serwer Ollamy (PC -> telefon)" -ForegroundColor Cyan
Line Cyan
Write-Host ""

# 1) Czy Ollama jest zainstalowana? Jeśli nie — spróbuj winget, inaczej otwórz stronę.
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "Nie znaleziono Ollamy — próbuję zainstalować (winget)..." -ForegroundColor Yellow
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:LOCALAPPDATA\Programs\Ollama"
}
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "Nie udało się automatycznie. Zainstaluj Ollamę z https://ollama.com/download" -ForegroundColor Red
  Start-Process "https://ollama.com/download"
  Read-Host "Po instalacji uruchom ten plik ponownie. Enter zamyka"; exit 1
}

# 2) Ustaw nasłuch w LAN + CORS — trwale dla użytkownika oraz dla bieżącej sesji.
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:$port", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
$env:OLLAMA_HOST = "0.0.0.0:$port"
$env:OLLAMA_ORIGINS = "*"

# 3) Otwórz port w zaporze (wymaga uprawnień administratora; jeśli brak — zignoruj).
netsh advfirewall firewall delete rule name="JARVIS Ollama" 2>$null | Out-Null
netsh advfirewall firewall add rule name="JARVIS Ollama" dir=in action=allow protocol=TCP localport=$port 2>$null | Out-Null

# 4) Zrestartuj serwer, by ZŁAPAŁ ustawienie 0.0.0.0 (tray-app Ollamy słucha tylko 127.0.0.1).
Write-Host "Restartuję serwer Ollamy z nasłuchem w sieci LAN..." -ForegroundColor Green
Get-Process "ollama app", "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process -WindowStyle Hidden ollama "serve"
Start-Sleep -Seconds 3

# 5) Pobierz model, jeśli go nie ma.
$have = (& ollama list 2>$null) -join "`n"
if ($have -notmatch [regex]::Escape($model.Split(":")[0])) {
  Write-Host "Pobieram model '$model' (jednorazowo, może chwilę potrwać)..." -ForegroundColor Green
  & ollama pull $model
} else {
  Write-Host "Model '$model' jest już pobrany." -ForegroundColor Gray
}

# 6) Wykryj adres IP w sieci LAN (interfejs z bramą domyślną).
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
        Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" } |
          Select-Object -First 1).IPAddress
}
if (-not $ip) { $ip = "127.0.0.1" }
$url = "http://${ip}:$port"

# 7) Skopiuj do schowka i pokaż wielką instrukcję.
Set-Clipboard -Value $url 2>$null

Write-Host ""
Line Green
Write-Host "  SERWER DZIAŁA. Wklej ten adres w JARVIS na telefonie:" -ForegroundColor Green
Write-Host ""
Write-Host "        $url" -ForegroundColor White
Write-Host ""
Write-Host "  (skopiowano do schowka)" -ForegroundColor DarkGray
Write-Host "  W aplikacji: Ustawienia (zebatka) -> AI ->" -ForegroundColor Gray
Write-Host "  'Lokalny model - adres Ollama' -> wklej -> gotowe." -ForegroundColor Gray
Line Green
Write-Host ""
Write-Host "  Wskazowki:" -ForegroundColor Cyan
Write-Host "  - Telefon i PC w tej samej sieci Wi-Fi (uzyj APK JARVIS, nie przegladarki)." -ForegroundColor Gray
Write-Host "  - Poza domem: zainstaluj Tailscale na PC i telefonie i uzyj adresu 100.x.y.z." -ForegroundColor Gray
Write-Host "  - Model mozesz zmienic: uruchom z argumentem, np. jarvis-ollama-server.exe qwen2.5" -ForegroundColor Gray
Write-Host ""
Write-Host "  ZOSTAW TO OKNO OTWARTE — zamkniecie zatrzymuje serwer." -ForegroundColor Yellow
Write-Host ""
Read-Host "Enter zatrzymuje serwer i zamyka okno"

# Sprzątanie: zatrzymaj serwer przy zamknięciu.
Get-Process "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
