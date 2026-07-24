# JARVIS na Ubuntu

## Najprostsza instalacja deweloperska

W katalogu projektu:

```bash
bash scripts/bootstrap-ubuntu.sh --install
```

Skrypt:

1. sprawdza, czy działa na Linuxie;
2. instaluje natywny Node.js 22 LTS i biblioteki potrzebne Electronowi;
3. instaluje zależności JARVISA oraz AI Sales dokładnie z lockfile;
4. uruchamia skan sekretów, lint, build i gates AI Sales.

Opcjonalne klienty SQLite i PostgreSQL:

```bash
bash scripts/bootstrap-ubuntu.sh --install --with-tools
```

## Sama kontrola

Ta komenda niczego nie instaluje ani nie zmienia:

```bash
npm run ubuntu:check
```

W WSL skrypt odrzuca `node`, `npm` i inne programy wskazujące do `/mnt/c/...`. JARVIS powinien
używać natywnych programów Ubuntu, ponieważ mieszanie zależności Windows i Linux prowadzi do
błędów modułów binarnych oraz paczek Electrona.

## Uruchomienie

```bash
npm run dev
```

Aplikacja desktopowa:

```bash
npm run electron:dev
```

Site OS:

```bash
npm run siteos
```

AI Sales:

```bash
npm run salesos
```

AI Sales uruchamia lokalny PostgreSQL przez Docker, jeśli Docker jest dostępny. Przy własnej
bazie należy ustawić `DATABASE_URL` w `sales-os/.env`.

## Budowanie paczek

```bash
npm run desktop:ubuntu
```

Artefakty:

- `release-desktop/JARVIS.AppImage`
- `release-desktop/JARVIS.deb`

Zwykły użytkownik paczki AppImage/DEB nie potrzebuje osobnej instalacji Node.js. Site OS jest
uruchamiany przez środowisko Node wbudowane w Electron.

## Narzędzia opcjonalne

JARVIS działa bez nich, ale odpowiednie funkcje pozostają wyłączone:

- `docker` i działający demon: lokalny PostgreSQL, Mem0, Qdrant lub Ollama w kontenerze;
- `sqlite3`: systemowe zapytania tylko do odczytu SQLite;
- `psql`: systemowe zapytania tylko do odczytu PostgreSQL;
- Ollama: lokalny model AI.

Stan tych narzędzi można sprawdzić:

```bash
npm run tools:verify
```

