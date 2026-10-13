// Turns jobs/<JOB_ID>/ (uploaded by the builder page) into a Capacitor project: www/, assets/, configs.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const sharp = require("sharp");
const E = process.env;

function fail(m) { console.error("ERROR: " + m); process.exit(1); }
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));

/* ---------- validate inputs ---------- */
const jobId = E.JOB_ID || "";
if (!/^[a-z0-9-]{4,40}$/.test(jobId)) fail("invalid job id");

const appName = (E.APP_NAME || "").trim().replace(/[<>&"\u0000-\u001f]/g, "").replace(/'/g, "\u2019");
if (!appName || appName.length > 60) fail("invalid app name");

const appId = (E.APP_ID || "").trim();
const JAVA_KW = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null".split(" "));
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) fail("invalid package id (use like com.name.app, lowercase)");
if (appId.split(".").some((s) => JAVA_KW.has(s))) fail("package id contains a reserved Java word");

const version = (E.APP_VERSION || "1.0.0").trim();
if (!/^\d+(\.\d+){0,3}$/.test(version)) fail("invalid version");

let o = {};
try { o = JSON.parse(E.APP_OPTIONS || "{}"); } catch (_) { fail("options is not valid JSON"); }
const theme = /^#[0-9a-f]{6}$/i.test(o.themeColor || "") ? o.themeColor : "#111111";
const lum = (() => {
  const n = parseInt(theme.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
})();

const browserMode = o.browserMode !== false; // "full browser mode" is on unless explicitly disabled
const jobDir = path.join("jobs", jobId);
const appDir = path.join(jobDir, "app");
if (!fs.existsSync(appDir)) fail("no app files found for this job");

/* ---------- www/ ---------- */
fs.rmSync("www", { recursive: true, force: true });
fs.mkdirSync("www");
const entries = fs.readdirSync(appDir);
const zips = entries.filter((f) => /\.zip$/i.test(f));
if (zips.length === 1 && entries.length === 1) {
  cp.execFileSync("unzip", ["-o", "-q", path.join(appDir, zips[0]), "-d", "www"]);
  fs.rmSync(path.join("www", "__MACOSX"), { recursive: true, force: true });
  for (let i = 0; i < 3; i++) { // flatten single wrapper folder(s)
    const top = fs.readdirSync("www");
    if (fs.existsSync("www/index.html") || top.length !== 1) break;
    const inner = path.join("www", top[0]);
    if (!fs.statSync(inner).isDirectory()) break;
    for (const f of fs.readdirSync(inner)) fs.renameSync(path.join(inner, f), path.join("www", f));
    fs.rmdirSync(inner);
  }
} else {
  fs.cpSync(appDir, "www", { recursive: true });
}
if (!fs.existsSync("www/index.html")) {
  const htmls = fs.readdirSync("www").filter((f) => /\.html?$/i.test(f)).sort();
  if (!htmls.length) fail("no .html file found in your upload");
  const pref = htmls.find((f) => /^(index|main|app|home)\./i.test(f)) || htmls[0];
  fs.renameSync(path.join("www", pref), "www/index.html");
}

/* ---------- inject native bridge ---------- */
fs.copyFileSync("bridge/native-bridge-pro.js", "www/native-bridge-pro.js");
let html = fs.readFileSync("www/index.html", "utf8");
if (!html.includes("native-bridge-pro.js")) {
  const initCfg = {
    appName: appName.replace(/[\\/:*?|]/g, ""),
    version,
    disableZoom: !o.allowZoom,
    disableSelection: !o.allowSelection,
    disableContextMenu: !o.allowSelection,
    polyfills: browserMode,
    keepAwake: !!o.keepAwake,
    askBeforeDownload: o.askBeforeDownload !== false,
    exitOnDoubleBack: o.doubleBackExit !== false,
    offlineBanner: o.offlineBanner !== false,
    statusBar: { color: theme, dark: lum < 0.5 }
  };
  const snippet =
    '<script src="plugins.js"></script>\n<script src="native-bridge-pro.js"></script>\n' +
    "<script>NativeApp.init(" + JSON.stringify(initCfg).replace(/</g, "\\u003c") + ");</script>\n";
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + "\n" + snippet);
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + "\n<head>" + snippet + "</head>");
  else html = snippet + html;
  fs.writeFileSync("www/index.html", html);
}

/* ---------- configs ---------- */
const capCfg = readJson("capacitor.config.json");
capCfg.appId = appId;
capCfg.appName = appName;
if (browserMode) capCfg.android = Object.assign({}, capCfg.android, { allowMixedContent: true });
capCfg.plugins = capCfg.plugins || {};
capCfg.plugins.SplashScreen = Object.assign({}, capCfg.plugins.SplashScreen, { backgroundColor: theme });
writeJson("capacitor.config.json", capCfg);

const pkg = readJson("package.json");
pkg.version = version;
writeJson("package.json", pkg);

const want = new Set(Array.isArray(o.permissions) ? o.permissions : ["camera", "mic", "location", "notifications", "storage"]);
const perms = ["INTERNET", "ACCESS_NETWORK_STATE", "VIBRATE", "WAKE_LOCK"];
if (want.has("camera")) perms.push("CAMERA");
if (want.has("mic")) perms.push("RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS");
if (want.has("location")) perms.push("ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION");
if (want.has("notifications")) perms.push("POST_NOTIFICATIONS");
writeJson("native.config.json", {
  permissions: perms,
  storagePermissions: want.has("storage"),
  orientation: ["portrait", "landscape"].includes(o.orientation) ? o.orientation : null,
  deepLinkHost: null,
  browserMode,
  cleartext: browserMode
});

/* ---------- icon + splash ---------- */
async function makeAssets() {
  fs.mkdirSync("assets", { recursive: true });
  let logo = null;
  const lf = fs.readdirSync(jobDir).find((n) => /^logo\./i.test(n));
  if (lf) {
    try {
      logo = await sharp(path.join(jobDir, lf)).ensureAlpha().png().toBuffer();
      await sharp(logo).metadata();
    } catch (e) { console.warn("Logo unreadable, using letter icon:", e.message); logo = null; }
  }
  if (!logo) {
    const letter = (appName.match(/[A-Za-z0-9]/) || ["A"])[0].toUpperCase();
    const fg = lum < 0.6 ? "#ffffff" : "#111111";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><text x="256" y="370" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="320" font-weight="bold" fill="${fg}" text-anchor="middle">${letter}</text></svg>`;
    logo = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  const canvas = async (size, bg, logoSize, out) => {
    const l = await sharp(logo).resize(logoSize, logoSize, { fit: "inside" }).toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
      .composite([{ input: l, gravity: "center" }]).png().toFile(out);
  };
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  await canvas(1024, theme, 720, "assets/icon-only.png");
  await canvas(1024, clear, 620, "assets/icon-foreground.png");
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: theme } }).png().toFile("assets/icon-background.png");
  await canvas(2732, theme, 720, "assets/splash.png");
  await canvas(2732, theme, 720, "assets/splash-dark.png");
}

makeAssets().then(() => {
  const slug = appName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
  writeJson("build-meta.json", { jobId, name: appName, id: appId, version, slug });
  writeJson("release-notes.json", { name: appName, id: appId, version, job: jobId });
  console.log(`Prepared ${appName} (${appId}) v${version}`);
}).catch((e) => fail(e.stack || e.message));
