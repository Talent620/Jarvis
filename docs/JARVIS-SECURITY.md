# JARVIS security notes (mission M0)

Status as of mission milestone M0. Only facts verified in this repository are listed.

## 1. Android signing key: assume compromise

`android/keystore/jarvis.jks` is tracked in a public repository and, until M0, its store and
key passwords were hardcoded in `android/app/build.gradle` as a fallback. Anyone can therefore
sign an APK that Android accepts as an update of `net.serwer256.jarvis` for every user who
installed a build signed with this key. Removing the file now does not undo that: it stays in
git history and in forks.

### What M0 changed

- `android/app/build.gradle` no longer contains passwords. Production signing is enabled only
  when `JARVIS_RELEASE_STORE_FILE` is provided (env or `gradle.properties`); then
  `JARVIS_RELEASE_STORE_PASSWORD`, `JARVIS_RELEASE_KEY_ALIAS` and `JARVIS_RELEASE_KEY_PASSWORD`
  are mandatory and a missing one fails the build with a clear error.
- Without secrets the release build still succeeds, but it is signed with the local Android
  debug key, gets `versionNameSuffix "-nonprod"` and `R.bool.jarvis_production_signing=false`.
  It cannot install as an update over a production APK, so it is never mistaken for one.
- `.github/workflows/android.yml` and `android-v2.yml` pass the `JARVIS_RELEASE_*` secrets to
  Gradle. Without secrets they upload a `-nonprod` artifact instead of failing.
- `.github/workflows/release.yml` refuses to run (first step, before checkout) when
  `JARVIS_RELEASE_STORE_PASSWORD` or `JARVIS_RELEASE_KEY_PASSWORD` is missing. Publishing a
  debug-signed APK as `latest` would silently change the signing identity and break updates.
- The signing identity was NOT changed. With the secrets set to the old values the workflows
  keep signing with `android/keystore/jarvis.jks` (the default when
  `JARVIS_RELEASE_KEYSTORE_B64` is empty), so existing installs keep updating.
- `scripts/secret-scan.mjs` now flags literal `storePassword` / `keyPassword` values.
- Regression tests: `tests/androidSigning.test.ts`.

### Owner action required to publish again

Set repository secrets `JARVIS_RELEASE_STORE_PASSWORD`, `JARVIS_RELEASE_KEY_PASSWORD` and
optionally `JARVIS_RELEASE_KEY_ALIAS` (default `jarvis`). Until then `release.yml` fails on
purpose. To move the keystore out of the repository, also set `JARVIS_RELEASE_KEYSTORE_B64`
(`base64 -w0 release.jks`); the workflows then ignore the tracked file.

### Options for the compromised key and their effect on updates

| Option | What it does | Effect on existing installs |
|---|---|---|
| A. Keep the old key (status quo, secrets only) | No identity change. Stops the password leak going forward, but the key itself stays public. | Updates keep working. Attackers can still sign look-alike updates for sideloaded users. |
| B. Rotate with APK Signature Scheme v3 lineage | `apksigner rotate --out lineage --old-signer --ks old.jks --new-signer --ks new.jks`, then sign with `apksigner sign --lineage lineage --ks old.jks --next-signer --ks new.jks`. The new key is trusted as the successor of the old one. | Android 9+ (API 28+) accepts the update and trusts the new key afterwards; you can later revoke the old key's capabilities in the lineage. Android 8.1 and older only see the v1/v2 signature of the old key, so they keep depending on it. minSdk must be checked before revoking. |
| C. New key without lineage | Sign with a brand-new key only. | Every existing install must uninstall and reinstall (data loss unless backed up). Only acceptable together with a new applicationId or for a fresh start. |
| D. Play App Signing | Upload key separate from app signing key, key upgrade handled by Google Play. | Only for Play distribution; sideloaded `jarvis.apk` users still follow A, B or C. |

Recommendation recorded for the owner: B (lineage rotation) with the new key kept only in
CI secrets, then remove `android/keystore/jarvis.jks` from the tree. History rewriting is not
done by the mission (forbidden: no force push, no history rewrite) and would not help anyway
because the key is already public.

## 2. License key pair (ECDSA P-256)

- Commit `8a25942` rotated only the embedded public key in `src/lib/license.ts`.
- A content scan of the full history (916 commits, unshallowed clone) found no PEM private key
  block and no JWK with a private `d` component; no `license-private.json` was ever committed.
  Commands: `git log --all -p -G'BEGIN (EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY'` and
  `git log --all -p -G'"d"\s*:\s*"[A-Za-z0-9_-]{40,}"'` (plus the unquoted `d:` variant).
- Tests no longer rely on a token signed by the owner's private key. `tests/license.test.ts`
  generates a key pair at runtime, signs with `signLicense()` and verifies through
  `verifyLicenseWithKey()`. The production `verifyLicense()` is still bound to the embedded key
  and the suite asserts that it rejects tokens signed by the test key and by the pre-rotation key.

## 3. Open items (tracked in docs/mission/BACKLOG.md)

- BFF `APP_TOKEN`, rate limiting and admin secret entropy from `SECURITY.md` are infrastructure
  steps outside this repository.
- Trust boundary for untrusted web, email and clipboard content, provenance and permission
  classes: milestone M4.
