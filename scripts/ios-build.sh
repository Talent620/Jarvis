#!/usr/bin/env bash
# JARVIS — zbuduj NIEPODPISANY .ipa na macOS jedną komendą:  npm run ios:build
# Wymaga: macOS + Xcode (App Store) + CocoaPods (`sudo gem install cocoapods` lub `brew install cocoapods`).
# Wynik: ./JARVIS.ipa — zainstaluj na iPhone przez AltStore lub Sideloadly swoim Apple ID (patrz docs/IOS.md).
#
# UWAGA: iOS NIE buduje się na Windows/Linux — to wymóg Apple. Z Windowsa użyj CI (workflow „Build iOS (.ipa)”),
# który robi to samo na macOS-runnerze i wrzuca .ipa do GitHub Releases.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ To trzeba odpalić na macOS (Apple wymaga Xcode). Na Windows: użyj CI — patrz docs/IOS.md."
  exit 1
fi
command -v xcodebuild >/dev/null || { echo "❌ Brak Xcode. Zainstaluj z App Store, potem: xcode-select --install"; exit 1; }
command -v pod >/dev/null || { echo "❌ Brak CocoaPods. Zainstaluj: brew install cocoapods (lub: sudo gem install cocoapods)"; exit 1; }

echo "==> 1/4  Web build + sync Capacitor (iOS)"
npm run build
npx cap sync ios

echo "==> 2/4  CocoaPods"
( cd ios/App && pod install )

echo "==> 3/4  Xcode build (niepodpisany, urządzenie)"
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build

echo "==> 4/4  Pakuję .ipa"
APP="ios/build/Build/Products/Release-iphoneos/App.app"
[ -d "$APP" ] || { echo "❌ App.app nie powstała — sprawdź log Xcode wyżej."; exit 1; }
rm -rf Payload JARVIS.ipa
mkdir -p Payload
cp -R "$APP" Payload/
zip -qr JARVIS.ipa Payload
rm -rf Payload

echo ""
echo "✅ Gotowe: $(pwd)/JARVIS.ipa  (niepodpisany)"
echo "   Zainstaluj na iPhone: AltStore lub Sideloadly + Twój Apple ID (za darmo, odśwież co 7 dni)."
echo "   Albo: otwórz w Xcode i wgraj na telefon —  npm run ios:open"
