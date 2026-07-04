# JARVIS — setup serwera Ollama na Windows (jedną komendą).
# Ustawia nasłuch w LAN + CORS, pobiera wszystkie modele z katalogu (Zadanie 1),
# opcjonalnie wystawia HTTPS przez Tailscale. Uruchom w PowerShell:
#   powershell -ExecutionPolicy Bypass -File server\ollama\setup.ps1
#   ...-File ...\setup.ps1 -Tailscale     # dodatkowo: tailscale serve https / 11434
param([switch]$Tailscale)

$ErrorActionPreference = "SilentlyContinue"
Write-Host "=== JARVIS — setup Ollama ===" -ForegroundColor Cyan

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "Nie znaleziono Ollamy. Zainstaluj z https://ollama.com i uruchom ponownie." -ForegroundColor Red
  Start-Process "https://ollama.com/download"; exit 1
}

# 1) Nasłuch w sieci LAN + CORS (krytyczny dla PWA) — trwale.
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "30m", "User")
$env:OLLAMA_HOST = "0.0.0.0:11434"; $env:OLLAMA_ORIGINS = "*"; $env:OLLAMA_KEEP_ALIVE = "30m"
Write-Host "Ustawiono OLLAMA_HOST=0.0.0.0:11434, OLLAMA_ORIGINS=*, OLLAMA_KEEP_ALIVE=30m" -ForegroundColor Green

# 2) Zapora — port 11434 (wymaga admina; ignoruj błąd).
netsh advfirewall firewall delete rule name="JARVIS Ollama" 2>$null | Out-Null
netsh advfirewall firewall add rule name="JARVIS Ollama" dir=in action=allow protocol=TCP localport=11434 2>$null | Out-Null

# 2b) Nie usypiaj PC na zasilaniu sieciowym — serwer ma być dostępny zdalnie 24/7.
#     (Ekran może gasnąć; liczy się, by system nie zasypiał i nie hibernował.)
powercfg /change standby-timeout-ac 0 2>$null | Out-Null
powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null
Write-Host "PC nie będzie usypiał na zasilaniu (serwer dostępny dla telefonu)." -ForegroundColor Green

# 3) Restart serwera, by złapał ustawienia.
Get-Process "ollama app", "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process -WindowStyle Hidden ollama "serve"
Start-Sleep -Seconds 3

# 4) Pobierz katalog modeli pod ~4 GB VRAM.
$models = @("qwen3.5:4b", "qwen3:1.7b", "gemma3:4b-it-qat", "llama3.2:3b", "gemma2:2b", "deepseek-r1:1.5b", "qwen2.5-coder:3b")
foreach ($m in $models) {
  Write-Host "Pobieram $m ..." -ForegroundColor Green
  & ollama pull $m
}

# 5) Opcjonalnie: HTTPS po MagicDNS (rozwiązuje mixed-content dla PWA).
if ($Tailscale) {
  if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    Write-Host "tailscale serve https / -> :11434" -ForegroundColor Green
    & tailscale serve https / http://127.0.0.1:11434
  } else {
    Write-Host "Tailscale nie znalezione — zainstaluj z https://tailscale.com" -ForegroundColor Yellow
  }
}

# 6) Pokaż gotowe adresy do wklejenia w telefonie (LAN + Tailscale, jeśli jest).
$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "=== Adres serwera do wklejenia w telefonie (⚙ → AI) ===" -ForegroundColor Cyan
if ($lan) { Write-Host ("  Ta sama sieć WiFi (APK):  http://{0}:11434" -f $lan) -ForegroundColor Green }
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  $ts = (& tailscale ip -4 2>$null | Select-Object -First 1)
  if ($ts) { Write-Host ("  Zdalnie z dowolnej sieci:  http://{0}:11434" -f $ts) -ForegroundColor Green }
  if ($Tailscale) { Write-Host "  (PWA przez HTTPS: użyj adresu MagicDNS z 'tailscale serve status')" -ForegroundColor Green }
}
Write-Host ""
Write-Host "W JARVIS: wklej adres w ⚙ → AI, 'Odśwież modele z Ollamy'. Kolejne modele dociągniesz" -ForegroundColor Cyan
Write-Host "wprost z apki (pole + ⬇ Pobierz) — bez wracania do tego komputera." -ForegroundColor Cyan
