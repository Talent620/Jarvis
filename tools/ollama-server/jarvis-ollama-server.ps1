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

# 5) Modele — pokaż zainstalowane i pozwól DOWYBRAĆ/POBRAĆ z popularnej listy.
#    Dzięki temu masz na PC kilka modeli, a na telefonie w JARVIS-ie wybierasz, którego użyć.
function Show-Installed {
  $list = (& ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] }) | Where-Object { $_ }
  if ($list) { Write-Host "  Zainstalowane: $($list -join ', ')" -ForegroundColor Gray } else { Write-Host "  (brak modeli)" -ForegroundColor Gray }
  return $list
}

$CATALOG = @(
  @{ id = "llama3.2";            desc = "Llama 3.2 3B — szybki, uniwersalny (~2 GB)" },
  @{ id = "qwen2.5";             desc = "Qwen2.5 7B — mocny wielojęzyczny, dobry PL (~4.7 GB)" },
  @{ id = "qwen2.5:3b";          desc = "Qwen2.5 3B — lekki wielojęzyczny (~2 GB)" },
  @{ id = "llama3.1";            desc = "Llama 3.1 8B — solidny ogólny (~4.7 GB)" },
  @{ id = "mistral";             desc = "Mistral 7B — szybki, dobry do zadań (~4.1 GB)" },
  @{ id = "gemma2";              desc = "Gemma 2 9B — Google, jakość (~5.4 GB)" },
  @{ id = "phi3";                desc = "Phi-3 mini — mały, bystry (~2.3 GB)" },
  @{ id = "dolphin-mistral";     desc = "Dolphin Mistral — bez cenzury (~4.1 GB)" },
  @{ id = "qwen2.5-coder";       desc = "Qwen2.5 Coder 7B — do kodu (~4.7 GB)" },
  @{ id = "llava";               desc = "LLaVA — widzi obrazy (wizja) (~4.7 GB)" }
)

Write-Host ""
Write-Host "  Twoje modele:" -ForegroundColor Cyan
$installed = Show-Installed
Write-Host ""
Write-Host "  Chcesz dobrać model(e)? Wpisz numery po przecinku (np. 1,2), Enter = pomiń:" -ForegroundColor Cyan
for ($i = 0; $i -lt $CATALOG.Count; $i++) { Write-Host ("    {0}) {1}" -f ($i + 1), $CATALOG[$i].desc) -ForegroundColor Gray }
$pick = Read-Host "  Wybór"
$chosen = @()
if ($pick -and $pick.Trim()) {
  foreach ($tok in ($pick -split '[,; ]+')) {
    $n = 0; if ([int]::TryParse($tok.Trim(), [ref]$n) -and $n -ge 1 -and $n -le $CATALOG.Count) { $chosen += $CATALOG[$n - 1].id }
  }
}
# Jeśli nic nie wybrano i nie ma ŻADNEGO modelu — pobierz domyślny, by JARVIS miał czym mówić.
if ($chosen.Count -eq 0 -and -not $installed) { $chosen += $model }
foreach ($m in ($chosen | Select-Object -Unique)) {
  Write-Host "Pobieram model '$m' (jednorazowo, może chwilę potrwać)..." -ForegroundColor Green
  & ollama pull $m
}
Write-Host ""
Write-Host "  Dostępne teraz:" -ForegroundColor Cyan
Show-Installed | Out-Null

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
Write-Host "  W aplikacji: Ustawienia (zebatka) -> AI:" -ForegroundColor Gray
Write-Host "   1) 'Lokalny model - adres Ollama' -> wklej adres." -ForegroundColor Gray
Write-Host "   2) Dostawca -> 'Lokalny model (Ollama)', potem 'Odswiez modele z Ollamy'" -ForegroundColor Gray
Write-Host "      i WYBIERZ z listy ten, ktory chcesz (te pobrane wyzej)." -ForegroundColor Gray
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
