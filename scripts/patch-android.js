// Runs in CI after `npx cap add android`. Patches manifest + gradle (version, signing).
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync("native.config.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

/* ---------- AndroidManifest.xml ---------- */
const mPath = "android/app/src/main/AndroidManifest.xml";
let m = fs.readFileSync(mPath, "utf8");

const perms = (cfg.permissions || []).map((p) => `    <uses-permission android:name="android.permission.${p}" />`);
if (cfg.storagePermissions) {
  perms.push('    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />');
  perms.push('    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />');
}
const toAdd = perms.filter((line) => {
  const name = /android:name="([^"]+)"/.exec(line)[1];
  return !m.includes(`android:name="${name}"`);
});
if (toAdd.length) m = m.replace("</manifest>", toAdd.join("\n") + "\n</manifest>");

if (cfg.storagePermissions && !m.includes("requestLegacyExternalStorage")) {
  m = m.replace("<application", '<application android:requestLegacyExternalStorage="true"');
}
if (cfg.orientation && !m.includes("android:screenOrientation")) {
  m = m.replace("<activity", `<activity android:screenOrientation="${cfg.orientation}"`);
}
if (cfg.deepLinkHost && !m.includes(cfg.deepLinkHost)) {
  const filter =
    '            <intent-filter>\n' +
    '                <action android:name="android.intent.action.VIEW" />\n' +
    '                <category android:name="android.intent.category.DEFAULT" />\n' +
    '                <category android:name="android.intent.category.BROWSABLE" />\n' +
    `                <data android:scheme="https" android:host="${cfg.deepLinkHost}" />\n` +
    '            </intent-filter>\n';
  m = m.replace("</activity>", filter + "        </activity>");
}
if (cfg.cleartext && !m.includes("usesCleartextTraffic")) {
  m = m.replace("<application", '<application android:usesCleartextTraffic="true"');
}
fs.writeFileSync(mPath, m);

/* ---------- MainActivity: "full browser mode" (downloads, cookies, MediaStore saving) ---------- */
if (cfg.browserMode) {
  const findFile = (dir, name) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; }
      else if (e.name === name) return p;
    }
    return null;
  };
  const target = findFile("android/app/src/main/java", "MainActivity.java");
  if (target) {
    const orig = fs.readFileSync(target, "utf8");
    const pkgName = (/^\s*package\s+([\w.]+)\s*;/m.exec(orig) || [])[1];
    if (pkgName) {
      fs.writeFileSync("android/MainActivity.orig", orig);   // safety copy: workflow restores it if the build fails
      fs.writeFileSync("android/MainActivity.path", target);
      fs.writeFileSync(target, fs.readFileSync("scripts/MainActivity.java.tpl", "utf8").replace("__PACKAGE__", pkgName));
      console.log("Browser mode: MainActivity replaced (" + pkgName + ")");
    }
  } else console.warn("MainActivity.java not found, skipping browser mode");
}

/* ---------- app/build.gradle ---------- */
const gPath = "android/app/build.gradle";
let g = fs.readFileSync(gPath, "utf8");

const versionName = pkg.version || "1.0.0";
const versionCode = parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10);
g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
g = g.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);

if (process.env.KEYSTORE_PATH) {
  const signing =
    "    signingConfigs {\n" +
    "        release {\n" +
    "            storeFile file(System.getenv('KEYSTORE_PATH'))\n" +
    "            storePassword System.getenv('KEYSTORE_PASSWORD')\n" +
    "            keyAlias System.getenv('KEY_ALIAS')\n" +
    "            keyPassword System.getenv('KEY_PASSWORD')\n" +
    "        }\n" +
    "    }\n";
  if (!g.includes("signingConfigs")) {
    g = g.replace("    buildTypes {", signing + "    buildTypes {");
    g = g.replace("minifyEnabled false", "signingConfig signingConfigs.release\n            minifyEnabled false");
  }
}
fs.writeFileSync(gPath, g);
console.log(`Patched Android project: v${versionName} (${versionCode})`);
