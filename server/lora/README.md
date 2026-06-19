# JARVIS — „Twój głos lokalnie" (LoRA, SERVER-ONLY)

> Szkielet pod fine-tuning adapterem LoRA. **Wyłącznie po stronie serwera (`server/`)** — nigdy w
> `src/` (bundle przeglądarki musi zostać browser-safe; żadnych zależności Node/torch w kliencie).
> Klient łączy się tylko z gotowym modelem przez Ollamę (jak dotąd). To plan + format danych pod
> przyszły upgrade sprzętu (RTX 3060 12 GB), nie wymóg dla użytkownika.

## Po co
Mały model lokalny + adapter LoRA wytrenowany na **Twoich** ofertach/mailach → JARVIS pisze „Twoim
głosem" (styl, frazy, struktura), **bez wysyłania danych klientów do chmury**. To docelowy SKU on-prem
dla kancelarii/firm wrażliwych na dane (RODO): personalizacja i prywatność jednocześnie.

## Pipeline (wysoki poziom)
1. **Zbierz dane** z eksportu JARVIS-a (Skrzynka wysłanych, oferty leadów, dziennik) → korpus par
   *instrukcja → Twoja odpowiedź*. Anonimizuj dane klientów (patrz niżej).
2. **Format**: JSONL w stylu instruction-tuning (`data/example.jsonl`).
3. **Trening LoRA** (server, GPU): bazowy model (np. `qwen2.5:7b`/`llama3.1:8b`) + adapter rangi
   8–16, kilka epok. Narzędzia: `unsloth` / `peft` + `transformers` (Linux + CUDA).
4. **Eksport do Ollamy**: scal adapter do GGUF (Modelfile z `ADAPTER`/`FROM`), `ollama create
   jarvis-glos -f Modelfile`. Od tej chwili wybierasz `jarvis-glos` w aplikacji jak każdy inny model.

## Format danych treningowych (`data/example.jsonl`)
Jedna linia = jeden przykład. Pola:
- `instruction` — czego chcesz (np. „Napisz cold-mail oferty strony WWW do restauracji").
- `input` — opcjonalny kontekst (dane leada, notatki) — **zanonimizowane**.
- `output` — Twoja wzorcowa odpowiedź (to, czego model ma się nauczyć — Twój głos).

## Anonimizacja (twardy wymóg)
Przed treningiem usuń PII klientów: nazwiska, adresy, telefony, e-maile, NIP → tokeny
(`<KLIENT>`, `<MIASTO>`, `<EMAIL>`). Model ma uczyć się STYLU, nie konkretnych danych. Korpus i
adapter zostają na Twoim serwerze.

## Wymagania sprzętowe (uczciwie)
- 1050 Ti (4 GB): trening LoRA 7–8B jest na granicy/poza zasięgiem — to plan pod upgrade.
- RTX 3060 12 GB (używana): komfortowy LoRA na 7–8B + szybka inferencja (40+ tok/s).

## Pliki
- `data/example.jsonl` — przykładowy format (3 rekordy, dane fikcyjne).
- `train.example.sh` — STUB komendy treningowej (do uzupełnienia po stronie serwera; NIE uruchamia się
  automatycznie i NIE jest zależnością klienta).
