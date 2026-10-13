# App Builder (private)

Created by app-builder.html. Builds Android APKs from HTML in GitHub Actions.

- `.github/workflows/build-app.yml` the cloud build (started from the builder page)
- `scripts/prepare-job.js` turns an upload into a Capacitor project (icon, splash, bridge injection)
- `scripts/patch-android.js` manifest, version and signing patches
- `bridge/native-bridge-pro.js` native helpers injected into every app
- `keystore/builder.jks` signing key, created on the first build. Keep this repo PRIVATE.
  Every app is signed with it, so a newer version installs over the old one.
- Finished APKs appear under Releases.
