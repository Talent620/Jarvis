# Wbudowany klucz API w buildzie (bez wycieku)

Klucze **nie są** w kodzie źródłowym (repo jest publiczne — klucz w źródle zostaje
unieważniony przez dostawcę w kilka minut). Zamiast tego wkompilowuje się je przy
buildzie z **GitHub Secrets**. Dzięki temu APK/EXE mają klucz „od razu", a źródła są czyste.

## Jak wgrać własny darmowy klucz (np. czat bez cenzury)

1. Załóż darmowe konto na **https://openrouter.ai** i skopiuj klucz (zaczyna się od `sk-or-...`).
2. W repo na GitHubie: **Settings → Secrets and variables → Actions → New repository secret**.
3. Dodaj sekret:
   - **Name:** `JARVIS_OPENROUTER_KEY`
   - **Secret:** Twój klucz `sk-or-...`
4. Odpal build (push lub „Run workflow") — nowy **APK/EXE** w wydaniu `latest` ma już ten klucz.
5. W aplikacji wystarczy wybrać model **Dolphin (bez cenzury)** w ⚙ → AI, albo kliknąć
   „🔓 Włącz darmowy czat bez cenzury".

## Obsługiwane sekrety (dowolny zestaw)

| Sekret | Dostawca |
|---|---|
| `JARVIS_OPENROUTER_KEY` | OpenRouter (darmowe modele, w tym Dolphin bez cenzury) |
| `JARVIS_GEMINI_KEY` | Google Gemini (darmowy; live, obrazy, pamięć semantyczna) |
| `JARVIS_ANTHROPIC_KEY` | Claude (Anthropic) |
| `JARVIS_GROQ_KEY` | Groq |
| `JARVIS_NVIDIA_KEY` | NVIDIA NIM |
| `JARVIS_GITHUB_KEY` | GitHub Models |

Wstrzykiwane są we wszystkich buildach (Android, Windows, iOS, Release) — patrz
`vite.config.ts` (`__DEFAULT_KEYS__`) i workflowy w `.github/workflows/`.

> Sekrety są maskowane w logach i nie trafiają do repozytorium. To jedyny bezpieczny
> sposób, by build miał klucz „wbudowany".
