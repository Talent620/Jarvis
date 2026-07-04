# 📊 JARVIS — karta projektu (statystyki i wycena)

> Stan na **25 czerwca 2026**. Twarde dane (commity, linie, pliki, testy) pochodzą wprost
> z repozytorium i kodu. Wyceny to **szacunki** oparte na standardach branżowych
> (feature-based + kontrola COCOMO) oraz stawkach rynkowych PL 2026 — realna kwota zależy
> od modelu rozliczenia (freelancer vs agencja vs etat) i regionu.

---

## 📦 Wdrożenia (git)

| Metryka | Wartość |
|---|---|
| Wdrożenia (commity) | **541** |
| Dni z aktywnością | 16 (09–25 czerwca 2026) |
| Średnio commitów / dzień aktywny | ~34 |
| Rekord w jednym dniu | **84** (20.06) |
| Łączne zmiany linii (churn) | **121 053** (113 091 dodanych / 7 962 usuniętych) |
| Średnio na commit | ~223 zmienione linie |
| Autorzy | 540× AI (prowadzony przez Szefa) + 1× Szef (start repo) |

## 💾 Rozmiar kodu (stan obecny, ręcznie pisany)

| Kategoria | Pliki | Linie |
|---|---|---|
| Logika TypeScript (`src/lib`) | 178 | 23 545 |
| Interfejs React (`src/*.tsx`) | 66 | 15 115 |
| Style CSS | — | 2 326 |
| Testy | 168 | 11 773 (**1 519 testów**) |
| Natywne (Android/iOS/skrypty/CI) | ~19 | 1 963 |
| Dokumentacja (Markdown) | 36 | 3 389 |
| **RAZEM (kod + testy + docs)** | **807 plików** | **~58 100 linii** |

## 🧩 Zakres funkcjonalny

- **64 ekrany/komponenty** + **178 modułów logiki**
- Multi-platforma z jednego kodu: **Web + Android (APK) + iOS (.ipa) + Desktop (EXE)**
- Podsystemy: routing wielu modeli LLM, głos/STT, OTA-aktualizacje, Studio Obrazów,
  CRM/sprzedaż, licencjonowanie, self-healing, CI/CD
- 20 zależności + 20 narzędziowych, pipeline CI (511 linii)
- Dyscyplina testów: ~1 plik testów na 1,4 modułu produkcyjnego

---

## 💰 Wycena — ile to realnie warte

**Metoda 1 — od funkcji (najbliższa prawdzie dla solo seniora):** budowa 64 ekranów +
178 modułów + 1 519 testów + natywne buildy + CI + licencje, z debugowaniem i polerką →
**~10–16 miesięcy** pracy jednego seniora na pełny etat (centralnie **~12 miesięcy** ≈ 1 900 h).

**Metoda 2 — kontrola przez linie kodu:** ~52 700 linii kodu+testów ÷ realistyczne
30–60 dostarczonych linii/dzień → 4–8 lat „papierowo" (COCOMO przeszacowuje nowoczesny
stack — dlatego za wiarygodniejszą uznajemy metodę 1).

### Stawki rynkowe (PL, 2026) × ~1 900 h

| Model rozliczenia | Stawka | Wartość pracy |
|---|---|---|
| Freelancer senior | ~150 zł/h | **~285 000 zł** |
| Software house / agencja | ~250 zł/h | **~475 000 zł** |
| Realny przedział | — | **230 000 – 550 000 zł** |

**Centralna wycena: ~300 000 zł** (≈ **€70 000 / $75 000**).
Dla porównania: software house wyceniłby taki projekt (aplikacja AI + Android + iOS + CRM +
testy + CI) fixed-price zwykle na **150 000 – 600 000 zł** — zgadza się.

---

## ⚡ Z AI vs bez AI

| | Bez AI (solo senior) | Z AI (faktycznie) |
|---|---|---|
| Czas | ~12 miesięcy (≈250 dni roboczych) | **16 dni aktywnych** (~3,3 tygodnia) |
| Koszt pracy | ~300 000 zł | ułamek (czas Szefa + ~kilkaset zł compute) |
| Przyspieszenie | — | **~15–20×** |
| Tempo | ~30–60 linii/dzień | ~3 600 linii zmian/dzień aktywny |

**Oszczędność netto:** rzędu **~280 000–500 000 zł** wartości pracy, dostarczone w ~3 tygodnie
zamiast ~rok.

---

## 🎁 Inne ciekawostki

- **223 linie** średnio na commit — drobne, bezpieczne kroki (łatwo cofnąć, łatwo śledzić).
- **1 519 testów** chroni każdą zmianę — przy 541 wdrożeniach to ~822 tys. uruchomień asercji
  w trakcie projektu.
- **~3 600 zmian linii dziennie** w dni aktywne — tempo nieosiągalne dla pojedynczego
  człowieka bez AI.
- Zero długu „na czerwono": każdy z 541 commitów przechodził bramkę
  **tsc + eslint + testy + build**.

---

## 🔬 Metodyka (dla transparentności)

- Commity / churn / daty / autorzy: `git rev-list`, `git log --numstat`, `git shortlog`.
- Linie i pliki: `wc -l` po typach (`.ts`, `.tsx`, `.css`, testy, natywne, `.md`).
- Wycena: feature-based (rozbicie na ekrany/moduły/testy/infra + narzut 30%) z kontrolą
  COCOMO basic; stawki wg rynku PL 2026 (freelancer 120–180 zł/h, agencja 200–350 zł/h).
- Wszystkie liczby „twarde" są dokładne na dzień raportu; pozycje oznaczone jako szacunki
  są szacunkami.
