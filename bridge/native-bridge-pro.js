/*!
 * native-bridge-pro.js  v2.0.0
 * One-file toolkit for HTML apps wrapped as APK (Capacitor first, plain WebView supported).
 * Backward compatible with v1 (init, download, saveBlob, onBack, _onBack, exit, popup, toast, confirm, storage).
 *
 * Optional Capacitor plugins (each feature quietly falls back if a plugin is missing):
 *   npm i @capacitor/app @capacitor/filesystem @capacitor/browser @capacitor/network \
 *         @capacitor/share @capacitor/clipboard @capacitor/haptics @capacitor/status-bar \
 *         @capacitor/splash-screen @capacitor/keyboard @capacitor/local-notifications \
 *         @capacitor/device @capacitor/preferences @capacitor/screen-orientation
 *   npm i @capacitor-community/keep-awake @capacitor-community/file-opener   (optional extras)
 *   npx cap sync
 *
 * Quick start:
 *   <script src="native-bridge-pro.js"></script>
 *   NativeApp.init({ appName: "MyApp", debug: true });
 */
(function (global) {
  "use strict";

  var VERSION = "2.1.0";
  // originals captured BEFORE any polyfill is installed
  var origNavShare = typeof navigator.share === "function" ? navigator.share.bind(navigator) : null;
  var origClipboard = navigator.clipboard || null;
  var NativeNotification = global.Notification || null;

  /* ================================================================ CONFIG */
  var cfg = {
    appName: "MyApp",
    version: null,
    debug: false,                  // shows a floating bug button + console logging

    // --- UX fixes
    disableZoom: true,
    disableSelection: true,        // add class "selectable" to allow selecting text
    disableContextMenu: true,      // blocks long-press menu (inputs excluded)
    disablePullToRefresh: true,
    disableTapHighlight: true,
    keyboardFix: true,             // --kb-height CSS var + scroll focused input into view
    safeAreaVars: true,            // --sat --sar --sab --sal CSS vars
    styleAlert: true,              // window.alert -> styled popup (non blocking)

    // --- Back button
    polyfills: true,               // Notification, navigator.share, clipboard, vibrate for WebView
    exitOnDoubleBack: true,
    exitToastText: "Press back again to exit",
    exitWindowMs: 2000,
    minimizeInsteadOfExit: false,
    isRoot: null,                  // optional () => boolean : true if current screen is the home screen

    // --- Downloads
    interceptDownloads: true,
    askBeforeDownload: true,
    rememberChoice: true,          // "don't ask again" checkbox
    defaultLocation: "documents",  // documents | downloads | private
    afterDownload: "toast",        // "toast" | "prompt" (Open / Share)

    // --- Links
    openExternalLinks: true,
    overrideWindowOpen: true,

    // --- Network
    offlineBanner: true,
    offlineText: "No internet connection",

    // --- App behaviour
    restoreLastRoute: false,       // reopen last page after app was killed
    hideSplash: true,
    statusBar: null,               // { color: "#111111", dark: true }  dark:true = dark bg, light icons
    orientation: null,             // "portrait" | "landscape" | null
    keepAwake: false,
    updateUrl: null,               // JSON url: { "version": "1.2.0", "url": "https://...", "notes": "..." }
    storagePrefix: "app_",

    // --- Callbacks
    onDownloadSaved: null,
    onDownloadError: null,
    onDeepLink: null
  };

  /* ============================================================== HELPERS */
  function P() {
    var c = (global.Capacitor && global.Capacitor.Plugins) || {};
    // window.NBPlugins is created by the template's bundled plugins.js (guaranteed to work)
    return global.NBPlugins ? Object.assign({}, c, global.NBPlugins) : c;
  }
  function platform() {
    if (global.Capacitor && global.Capacitor.getPlatform) return global.Capacitor.getPlatform();
    return global.Android ? "android" : "web";
  }
  function isNative() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtBytes(n) {
    if (!n) return "0 B";
    var u = ["B", "KB", "MB", "GB"], i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
  }
  function cmpVer(a, b) {
    var x = String(a || "0").split("."), y = String(b || "0").split(".");
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /* ============================================================== EVENTS */
  var listeners = {};
  function on(ev, fn) {
    (listeners[ev] = listeners[ev] || []).push(fn);
    return function () { off(ev, fn); };
  }
  function off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); }
  function emit(ev, data) {
    (listeners[ev] || []).slice().forEach(function (f) { try { f(data); } catch (e) { console.error(e); } });
  }

  /* ================================================================ LOGGER */
  var logs = [];
  function log(level) {
    var args = Array.prototype.slice.call(arguments, 1);
    var msg = args.map(function (a) {
      try { return typeof a === "string" ? a : (a && a.stack) || JSON.stringify(a); } catch (_) { return String(a); }
    }).join(" ");
    var line = { t: Date.now(), level: level, msg: msg };
    logs.push(line);
    if (logs.length > 300) logs.shift();
    if (cfg.debug) (console[level] || console.log).call(console, "[NB]", msg);
    emit("log", line);
  }
  function setupErrorCapture() {
    global.addEventListener("error", function (e) { log("error", "Uncaught:", e.message, (e.filename || "") + ":" + (e.lineno || "")); });
    global.addEventListener("unhandledrejection", function (e) { log("error", "Unhandled promise:", e.reason); });
  }

  /* ================================================================ STYLES */
  function injectStyles() {
    if (document.getElementById("nb-styles")) return;
    var s = el("style");
    s.id = "nb-styles";
    s.textContent =
      ".nb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483646;padding:16px;font-family:system-ui,sans-serif}" +
      ".nb-box{background:#fff;color:#111;border-radius:14px;padding:18px;width:100%;max-width:360px;box-shadow:0 10px 40px rgba(0,0,0,.3);max-height:90vh;overflow:auto}" +
      ".nb-box h3{margin:0 0 6px;font-size:18px}" +
      ".nb-box p{margin:0 0 12px;font-size:14px;color:#444;word-break:break-word;white-space:pre-wrap}" +
      ".nb-box select,.nb-box input[type=text],.nb-box input:not([type]){width:100%;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px;margin-bottom:12px;box-sizing:border-box}" +
      ".nb-chk{display:flex;gap:8px;align-items:center;font-size:14px;margin-bottom:12px}" +
      ".nb-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.nb-row.col{flex-direction:column}" +
      ".nb-btn{padding:10px 16px;border:0;border-radius:8px;font-size:15px;cursor:pointer;background:#eee;color:#111}" +
      ".nb-btn.primary{background:#2563eb;color:#fff}" +
      ".nb-toast{position:fixed;left:50%;bottom:calc(48px + var(--sab,0px));transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:20px;font-size:14px;z-index:2147483647;font-family:system-ui,sans-serif;max-width:85%;text-align:center}" +
      ".nb-bar{height:8px;background:#ddd;border-radius:4px;overflow:hidden;margin-bottom:12px}" +
      ".nb-fill{height:100%;width:0;background:#2563eb;transition:width .2s}" +
      ".nb-fill.ind{width:35%;animation:nb-ind 1s infinite linear}" +
      "@keyframes nb-ind{0%{margin-left:-35%}100%{margin-left:100%}}" +
      ".nb-spin{width:34px;height:34px;border:4px solid #ddd;border-top-color:#2563eb;border-radius:50%;animation:nb-rot .8s linear infinite;margin:0 auto 10px}" +
      "@keyframes nb-rot{to{transform:rotate(360deg)}}" +
      ".nb-offline{position:fixed;top:0;left:0;right:0;background:#b91c1c;color:#fff;text-align:center;font:13px system-ui,sans-serif;padding:6px 8px;padding-top:calc(6px + var(--sat,0px));z-index:2147483645}" +
      ".nb-debug{position:fixed;inset:auto 0 0 0;height:50%;background:rgba(0,0,0,.92);color:#9f9;font:11px monospace;z-index:2147483647;display:flex;flex-direction:column}" +
      ".nb-debug .nb-dbar{display:flex;gap:6px;padding:6px;background:#111}" +
      ".nb-debug pre{flex:1;margin:0;padding:6px;overflow:auto;white-space:pre-wrap;word-break:break-all}" +
      ".nb-bug{position:fixed;right:10px;bottom:90px;width:40px;height:40px;border-radius:50%;border:0;background:#222;color:#fff;z-index:2147483645;opacity:.7;font-size:18px}" +
      "@media (prefers-color-scheme:dark){.nb-box{background:#1f1f1f;color:#eee}.nb-box p{color:#bbb}.nb-box select,.nb-box input{background:#2a2a2a;color:#eee;border-color:#444}.nb-btn{background:#333;color:#eee}.nb-bar{background:#444}}";
    document.head.appendChild(s);
  }

  /* ========================================================== UX FIXES */
  function applyUX() {
    var css = "";
    if (cfg.safeAreaVars || cfg.keyboardFix) {
      css += ":root{--sat:env(safe-area-inset-top,0px);--sar:env(safe-area-inset-right,0px);--sab:env(safe-area-inset-bottom,0px);--sal:env(safe-area-inset-left,0px);--kb-height:0px}";
    }
    if (cfg.disablePullToRefresh) css += "html,body{overscroll-behavior-y:none}";
    if (cfg.disableTapHighlight) css += "*{-webkit-tap-highlight-color:transparent}";
    if (cfg.disableSelection) {
      css += "*{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}" +
        "input,textarea,[contenteditable],[contenteditable] *,.selectable,.selectable *{-webkit-user-select:text;user-select:text}";
    }
    css += "a,button,[role=button],input,select{touch-action:manipulation}";
    var st = el("style");
    st.id = "nb-ux";
    st.textContent = css;
    document.head.appendChild(st);

    if (cfg.disableZoom || cfg.safeAreaVars) {
      var m = document.querySelector('meta[name="viewport"]');
      if (!m) { m = el("meta"); m.name = "viewport"; document.head.appendChild(m); }
      m.content = "width=device-width, initial-scale=1" +
        (cfg.disableZoom ? ", maximum-scale=1, user-scalable=no" : "") + ", viewport-fit=cover";
    }
    if (cfg.disableContextMenu) {
      document.addEventListener("contextmenu", function (e) {
        var t = e.target;
        if (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable) return;
        e.preventDefault();
      });
    }
    if (cfg.styleAlert) {
      global.alert = function (msg) { popup({ title: cfg.appName, message: String(msg) }); };
    }
  }

  function setupKeyboard() {
    if (!cfg.keyboardFix) return;
    var set = function (h) { document.documentElement.style.setProperty("--kb-height", (h || 0) + "px"); };
    var k = P().Keyboard;
    if (k && k.addListener) {
      k.addListener("keyboardWillShow", function (i) { set(i && i.keyboardHeight); });
      k.addListener("keyboardWillHide", function () { set(0); });
    } else if (global.visualViewport) {
      var vv = global.visualViewport;
      vv.addEventListener("resize", function () {
        set(Math.max(0, global.innerHeight - vv.height - vv.offsetTop));
      });
    }
    document.addEventListener("focusin", function (e) {
      var t = e.target;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) {
        setTimeout(function () { try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }, 350);
      }
    });
  }

  /* ============================================================== DIALOGS */
  var popups = []; // stack, top = last

  function popup(o) {
    o = o || {};
    injectStyles();
    return new Promise(function (resolve) {
      var overlay = el("div", "nb-overlay"), box = el("div", "nb-box");
      if (o.title) box.appendChild(el("h3", null, o.title));
      if (o.message) box.appendChild(el("p", null, o.message));
      if (o.body) box.appendChild(o.body);
      var row = el("div", "nb-row" + (o.vertical ? " col" : ""));
      var entry = { close: function () { if (o.dismissible !== false) finish(null); } };
      function finish(val) {
        overlay.remove();
        var i = popups.indexOf(entry);
        if (i > -1) popups.splice(i, 1);
        resolve(val);
      }
      (o.buttons || [{ label: "OK", value: true, primary: true }]).forEach(function (b) {
        var btn = el("button", "nb-btn" + (b.primary ? " primary" : ""), b.label);
        btn.onclick = function () { finish(b.value); };
        row.appendChild(btn);
      });
      box.appendChild(row);
      overlay.appendChild(box);
      overlay.onclick = function (e) { if (e.target === overlay) entry.close(); };
      document.body.appendChild(overlay);
      popups.push(entry);
      if (o.onShow) o.onShow(box);
    });
  }

  function confirmBox(title, message) {
    return popup({
      title: title, message: message,
      buttons: [{ label: "Cancel", value: false }, { label: "OK", value: true, primary: true }]
    }).then(function (v) { return !!v; });
  }
  function promptBox(title, message, def) {
    var inp = el("input"); inp.type = "text"; inp.value = def || "";
    return popup({
      title: title, message: message, body: inp,
      buttons: [{ label: "Cancel", value: false }, { label: "OK", value: true, primary: true }],
      onShow: function () { setTimeout(function () { inp.focus(); }, 50); }
    }).then(function (v) { return v ? inp.value : null; });
  }
  function choose(title, items) {
    var buttons = items.map(function (it) {
      return typeof it === "string" ? { label: it, value: it } : it;
    });
    buttons.push({ label: "Cancel", value: null });
    return popup({ title: title, buttons: buttons, vertical: true });
  }

  var toastEl = null;
  function toast(text, ms) {
    injectStyles();
    if (toastEl) toastEl.remove();
    var t = toastEl = el("div", "nb-toast", text);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); if (toastEl === t) toastEl = null; }, ms || 2000);
  }

  var loading = (function () {
    var count = 0, entry = null, overlay = null, label = null;
    return {
      show: function (text) {
        injectStyles();
        count++;
        if (!overlay) {
          overlay = el("div", "nb-overlay");
          var box = el("div", "nb-box");
          box.style.textAlign = "center";
          box.appendChild(el("div", "nb-spin"));
          label = el("p", null, "");
          label.style.margin = "0";
          box.appendChild(label);
          overlay.appendChild(box);
          document.body.appendChild(overlay);
          entry = { close: function () {} }; // back button ignored while loading
          popups.push(entry);
        }
        label.textContent = text || "Loading...";
      },
      hide: function (force) {
        count = force ? 0 : Math.max(0, count - 1);
        if (count === 0 && overlay) {
          overlay.remove(); overlay = null;
          var i = popups.indexOf(entry); if (i > -1) popups.splice(i, 1);
        }
      },
      wrap: function (promise, text) {
        loading.show(text);
        return Promise.resolve(promise).then(function (v) { loading.hide(); return v; }, function (e) { loading.hide(); throw e; });
      }
    };
  })();

  function progressBox(title, onCancel) {
    injectStyles();
    var overlay = el("div", "nb-overlay"), box = el("div", "nb-box");
    box.appendChild(el("h3", null, title));
    var status = el("p", null, "Starting...");
    var bar = el("div", "nb-bar"), fill = el("div", "nb-fill ind");
    bar.appendChild(fill);
    var row = el("div", "nb-row"), cancel = el("button", "nb-btn", "Cancel");
    row.appendChild(cancel);
    box.appendChild(status); box.appendChild(bar); box.appendChild(row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    var closed = false;
    var entry = { close: function () { if (closed) return; if (onCancel) onCancel(); done(); } };
    function done() {
      if (closed) return;
      closed = true; overlay.remove();
      var i = popups.indexOf(entry); if (i > -1) popups.splice(i, 1);
    }
    cancel.onclick = entry.close;
    popups.push(entry);
    return {
      update: function (got, total) {
        if (total) {
          fill.className = "nb-fill";
          fill.style.width = Math.min(100, Math.round(got / total * 100)) + "%";
          status.textContent = Math.round(got / total * 100) + "%  (" + fmtBytes(got) + " / " + fmtBytes(total) + ")";
        } else {
          status.textContent = got ? fmtBytes(got) + " downloaded" : "Starting...";
        }
      },
      text: function (t) { status.textContent = t; },
      close: done
    };
  }

  /* ============================================================ BACK BUTTON */
  var backHandlers = [], backSeq = 0, lastBack = 0;

  function onBack(fn, priority) {
    var h = { fn: fn, p: priority || 0, s: ++backSeq };
    backHandlers.push(h);
    return function () { var i = backHandlers.indexOf(h); if (i > -1) backHandlers.splice(i, 1); };
  }

  function handleBack(canGoBack, delegate) {
    if (popups.length) { popups[popups.length - 1].close(); return "handled"; }
    var hs = backHandlers.slice().sort(function (a, b) { return (b.p - a.p) || (b.s - a.s); });
    for (var i = 0; i < hs.length; i++) {
      try { if (hs[i].fn() === true) return "handled"; } catch (e) { log("error", e); }
    }
    var atRoot = cfg.isRoot ? !!cfg.isRoot()
      : !(typeof canGoBack === "boolean" ? canGoBack : history.length > 1);
    if (!atRoot) { history.back(); return "handled"; }
    if (cfg.minimizeInsteadOfExit) { minimize(); return "handled"; }
    if (cfg.exitOnDoubleBack) {
      var now = Date.now();
      if (now - lastBack > cfg.exitWindowMs) {
        lastBack = now; toast(cfg.exitToastText, cfg.exitWindowMs); return "handled";
      }
    }
    if (delegate) return "exit";
    exitApp();
    return "exit";
  }

  function exitApp() {
    var p = P();
    if (p.App && p.App.exitApp) return p.App.exitApp();
    if (global.Android && global.Android.exitApp) return global.Android.exitApp();
    global.close();
  }
  function minimize() {
    var p = P();
    if (p.App && p.App.minimizeApp) return p.App.minimizeApp();
    if (global.Android && global.Android.minimize) return global.Android.minimize();
    exitApp();
  }

  function setupBackButton() {
    var a = P().App;
    if (a && a.addListener) a.addListener("backButton", function (e) { handleBack(e && e.canGoBack); });
  }

  /* ============================================================== LIFECYCLE */
  function setupLifecycle() {
    var a = P().App;
    if (a && a.addListener) {
      a.addListener("appStateChange", function (s) { emit(s.isActive ? "resume" : "pause"); if (!s.isActive) saveRoute(); });
      a.addListener("appUrlOpen", function (d) {
        log("info", "Deep link:", d.url);
        emit("deeplink", d.url);
        if (cfg.onDeepLink) cfg.onDeepLink(d.url);
      });
    } else {
      document.addEventListener("visibilitychange", function () {
        emit(document.hidden ? "pause" : "resume");
        if (document.hidden) saveRoute();
      });
    }
    global.addEventListener("pagehide", saveRoute);
  }
  function saveRoute() {
    if (!cfg.restoreLastRoute) return;
    try { storage.set("last_route", location.pathname + location.search + location.hash); } catch (_) {}
  }
  function restoreRoute() {
    if (!cfg.restoreLastRoute) return;
    try {
      if (sessionStorage.getItem("nb_restored")) return;
      sessionStorage.setItem("nb_restored", "1");
      var r = storage.get("last_route", null);
      if (r && r !== location.pathname + location.search + location.hash) location.replace(r);
    } catch (_) {}
  }

  /* ================================================================ NETWORK */
  var net = { online: navigator.onLine, type: "unknown" };
  var bannerEl = null;

  function showBanner(show) {
    if (!cfg.offlineBanner) return;
    injectStyles();
    if (show && !bannerEl) { bannerEl = el("div", "nb-offline", cfg.offlineText); document.body.appendChild(bannerEl); }
    if (!show && bannerEl) { bannerEl.remove(); bannerEl = null; }
  }
  function netUpdate(connected, type) {
    var changed = net.online !== connected;
    net.online = connected; net.type = type || net.type;
    showBanner(!connected);
    if (changed) emit("network", { online: net.online, type: net.type });
  }
  function setupNetwork() {
    var n = P().Network;
    if (n && n.getStatus) {
      n.getStatus().then(function (s) { netUpdate(s.connected, s.connectionType); }).catch(function () {});
      n.addListener("networkStatusChange", function (s) { netUpdate(s.connected, s.connectionType); });
    }
    global.addEventListener("online", function () { netUpdate(true); });
    global.addEventListener("offline", function () { netUpdate(false); });
    showBanner(!net.online);
  }
  function waitForOnline(timeoutMs) {
    if (net.online) return Promise.resolve(true);
    return new Promise(function (res) {
      var t = timeoutMs ? setTimeout(function () { off2(); res(false); }, timeoutMs) : null;
      var off2 = on("network", function (s) { if (s.online) { clearTimeout(t); off2(); res(true); } });
    });
  }

  // fetch with timeout + retry + abort support
  function nfetch(url, opts) {
    opts = Object.assign({}, opts || {});
    var retries = opts.retries != null ? opts.retries : 2;
    var timeout = opts.timeout || 15000;
    var outer = opts.signal;
    delete opts.retries; delete opts.timeout;
    var attempt = 0;
    function run() {
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, timeout);
      if (outer) {
        if (outer.aborted) ctrl.abort();
        else outer.addEventListener("abort", function () { ctrl.abort(); });
      }
      return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).then(function (r) {
        clearTimeout(t);
        if (r.status >= 500 && attempt < retries) throw new Error("HTTP " + r.status);
        return r;
      }).catch(function (e) {
        clearTimeout(t);
        if (outer && outer.aborted) throw e;
        if (attempt < retries) {
          attempt++;
          return sleep(500 * Math.pow(2, attempt - 1)).then(run);
        }
        throw e;
      });
    }
    return run();
  }

  /* ================================================================ STORAGE */
  function parseRec(raw, fb, key) {
    if (raw === null || raw === undefined) return fb;
    var rec;
    try { rec = JSON.parse(raw); } catch (_) { return fb; }
    if (rec && typeof rec === "object" && "v" in rec && "e" in rec) {
      if (rec.e && Date.now() > rec.e) { storage.remove(key); return fb; }
      return rec.v;
    }
    return rec; // v1 raw value
  }

  var storage = {
    // sync, mirrored to native Preferences (survives WebView data/cache wipes)
    set: function (key, value, ttlMs) {
      var s = JSON.stringify({ v: value, e: ttlMs ? Date.now() + ttlMs : null });
      try { localStorage.setItem(cfg.storagePrefix + key, s); } catch (_) {}
      var pr = P().Preferences;
      if (pr) pr.set({ key: cfg.storagePrefix + key, value: s }).catch(function () {});
      return true;
    },
    get: function (key, fb) {
      try { return parseRec(localStorage.getItem(cfg.storagePrefix + key), fb, key); } catch (_) { return fb; }
    },
    getAsync: function (key, fb) {
      var pr = P().Preferences, k = cfg.storagePrefix + key;
      var local = null;
      try { local = localStorage.getItem(k); } catch (_) {}
      if (local !== null || !pr) return Promise.resolve(parseRec(local, fb, key));
      return pr.get({ key: k }).then(function (r) { return parseRec(r && r.value, fb, key); }).catch(function () { return fb; });
    },
    remove: function (key) {
      try { localStorage.removeItem(cfg.storagePrefix + key); } catch (_) {}
      var pr = P().Preferences;
      if (pr) pr.remove({ key: cfg.storagePrefix + key }).catch(function () {});
    },
    clear: function () {
      try {
        Object.keys(localStorage).filter(function (k) { return k.indexOf(cfg.storagePrefix) === 0; })
          .forEach(function (k) { localStorage.removeItem(k); });
      } catch (_) {}
      var pr = P().Preferences;
      if (pr && pr.keys) {
        pr.keys().then(function (r) {
          (r.keys || []).filter(function (k) { return k.indexOf(cfg.storagePrefix) === 0; })
            .forEach(function (k) { pr.remove({ key: k }); });
        }).catch(function () {});
      }
    },
    // copy anything missing from native Preferences back into localStorage
    restore: function () {
      var pr = P().Preferences;
      if (!pr || !pr.keys) return Promise.resolve(0);
      return pr.keys().then(function (r) {
        var keys = (r.keys || []).filter(function (k) { return k.indexOf(cfg.storagePrefix) === 0; });
        var n = 0;
        return Promise.all(keys.map(function (k) {
          var has = null;
          try { has = localStorage.getItem(k); } catch (_) {}
          if (has !== null) return null;
          return pr.get({ key: k }).then(function (v) {
            if (v && v.value != null) { try { localStorage.setItem(k, v.value); n++; } catch (_) {} }
          });
        })).then(function () { return n; });
      }).catch(function () { return 0; });
    }
  };

  // Large data: IndexedDB key-value (async)
  var db = (function () {
    var p;
    function open() {
      return p || (p = new Promise(function (res, rej) {
        var r = indexedDB.open(cfg.storagePrefix + "kv", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      }));
    }
    function tx(mode, fn) {
      return open().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction("kv", mode), rq = fn(t.objectStore("kv"));
          t.oncomplete = function () { res(rq && rq.result); };
          t.onerror = t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      set: function (k, v) { return tx("readwrite", function (s) { return s.put(v, k); }); },
      get: function (k) { return tx("readonly", function (s) { return s.get(k); }); },
      remove: function (k) { return tx("readwrite", function (s) { return s.delete(k); }); },
      keys: function () { return tx("readonly", function (s) { return s.getAllKeys(); }); }
    };
  })();

  function resetApp(opts) {
    opts = opts || {};
    storage.clear();
    try { sessionStorage.clear(); } catch (_) {}
    var jobs = [];
    try { if (indexedDB.databases) jobs.push(indexedDB.databases().then(function (l) { l.forEach(function (d) { indexedDB.deleteDatabase(d.name); }); })); } catch (_) {}
    try { if (global.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (_) {}
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (_) {}
    return Promise.all(jobs).catch(function () {}).then(function () { if (opts.reload !== false) location.reload(); });
  }

  /* =============================================================== DOWNLOADS */
  var LOCATIONS = {
    documents: { label: "Documents", directory: "DOCUMENTS", sub: "" },
    downloads: { label: "Downloads", directory: "EXTERNAL_STORAGE", sub: "Download/" },
    private: { label: "App private storage", directory: "DATA", sub: "" }
  };

  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onloadend = function () { res(String(r.result).split(",")[1] || ""); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  function safeName(n) { return String(n || "file").replace(/[\\/:*?"<>|]+/g, "_"); }
  function guessName(url) {
    try {
      var u = new URL(url, location.href);
      var last = decodeURIComponent(u.pathname.split("/").pop() || "");
      if (last && /\.[a-z0-9]{1,6}$/i.test(last)) return last;
    } catch (_) {}
    return "download_" + Date.now();
  }
  function nameFromHeader(h) {
    if (!h) return null;
    var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(h);
    try { return m ? decodeURIComponent(m[1]) : null; } catch (_) { return m ? m[1] : null; }
  }

  function chooseLocation(filename) {
    var wrap = el("div");
    var nameInput = el("input"); nameInput.type = "text"; nameInput.value = filename;
    var sel = el("select");
    Object.keys(LOCATIONS).forEach(function (k) {
      var o = el("option", null, "Save to: " + LOCATIONS[k].label);
      o.value = k;
      if (k === cfg.defaultLocation) o.selected = true;
      sel.appendChild(o);
    });
    var chkWrap = el("label", "nb-chk"), chk = el("input"); chk.type = "checkbox";
    chkWrap.appendChild(chk); chkWrap.appendChild(el("span", null, "Don't ask again"));
    wrap.appendChild(nameInput); wrap.appendChild(sel);
    if (cfg.rememberChoice) wrap.appendChild(chkWrap);
    return popup({
      title: "Download file", message: "Choose name and location", body: wrap,
      buttons: [{ label: "Cancel", value: false }, { label: "Download", value: true, primary: true }]
    }).then(function (ok) {
      if (!ok) return null;
      return { filename: safeName(nameInput.value.trim() || filename), location: sel.value, remember: chk.checked };
    });
  }

  // Android 10+ cannot write public folders with plain file paths, so the native
  // MainActivity (browser mode) saves through MediaStore. Falls back to JS paths.
  function nativeSave(blob, filename, locKey, loc) {
    var A = global.Android, mime = blob.type || "application/octet-stream", id;
    try { id = A.beginFile(filename, mime, locKey); } catch (e) { return Promise.resolve(null); }
    if (!id) return Promise.resolve(null);
    var CH = 3 * 512 * 1024, off = 0;
    var step = function () {
      if (off >= blob.size) return Promise.resolve(true);
      return blobToBase64(blob.slice(off, off + CH)).then(function (b64) {
        if (!A.appendFile(id, b64)) throw new Error("native write failed");
        off += CH;
        return step();
      });
    };
    return step().then(function () {
      var uri = A.endFile(id);
      return { uri: uri || null, path: filename, location: loc.label, size: blob.size, mime: blob.type, native: true };
    }).catch(function (e) {
      log("warn", "native save failed, using fallback:", e);
      try { A.endFile(id); } catch (_) {}
      return null;
    });
  }

  function saveBlob(blob, filename, locKey) {
    var loc = LOCATIONS[locKey] || LOCATIONS[cfg.defaultLocation];
    filename = safeName(filename);
    if (global.Android && global.Android.beginFile) {
      return nativeSave(blob, filename, locKey, loc).then(function (r) { return r || saveBlobJs(blob, filename, locKey); });
    }
    return saveBlobJs(blob, filename, locKey);
  }

  function saveBlobJs(blob, filename, locKey) {
    var p = P(), fs = p.Filesystem;
    var loc = LOCATIONS[locKey] || LOCATIONS[cfg.defaultLocation];
    filename = safeName(filename);

    if (fs) { // chunked write: safe for big files
      var path = loc.sub + cfg.appName + "/" + filename;
      var CH = 3 * 512 * 1024, off = 0, uri = null, first = true;
      var step = function () {
        return blobToBase64(blob.slice(off, off + CH)).then(function (data) {
          var job = first
            ? fs.writeFile({ path: path, data: data, directory: loc.directory, recursive: true }).then(function (r) { uri = r && r.uri; })
            : fs.appendFile({ path: path, data: data, directory: loc.directory });
          first = false; off += CH;
          return job;
        }).then(function () { return off < blob.size ? step() : null; });
      };
      return step().then(function () {
        return { uri: uri, path: path, location: loc.label, size: blob.size, mime: blob.type };
      });
    }
    if (global.Android && global.Android.saveFile) { // your own Kotlin bridge
      return blobToBase64(blob).then(function (b64) {
        var res = global.Android.saveFile(b64, filename, blob.type || "application/octet-stream", locKey);
        return { uri: res, path: filename, location: loc.label, size: blob.size, mime: blob.type };
      });
    }
    var a = document.createElement("a"); // browser fallback
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.setAttribute("data-nb-skip", "1");
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return Promise.resolve({ uri: null, path: filename, location: "Browser default", size: blob.size, mime: blob.type });
  }

  function fetchBlob(url, onProgress, signal) {
    if (/^(blob|data):/i.test(url)) {
      return fetch(url, { signal: signal }).then(function (r) { return r.blob(); }).then(function (b) { return { blob: b, name: null }; });
    }
    return nfetch(url, { signal: signal, retries: 1, timeout: 20000 }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var name = nameFromHeader(r.headers.get("content-disposition"));
      var total = +r.headers.get("content-length") || 0;
      var type = r.headers.get("content-type") || "";
      if (!r.body || !r.body.getReader) return r.blob().then(function (b) { return { blob: b, name: name }; });
      var reader = r.body.getReader(), chunks = [], got = 0;
      var pump = function () {
        return reader.read().then(function (x) {
          if (x.done) return { blob: new Blob(chunks, { type: type }), name: name };
          chunks.push(x.value); got += x.value.length; onProgress(got, total);
          return pump();
        });
      };
      return pump();
    });
  }

  // native download (bypasses CORS) - used as fallback
  function nativeDownload(url, filename, locKey) {
    var fs = P().Filesystem;
    var loc = LOCATIONS[locKey] || LOCATIONS[cfg.defaultLocation];
    var path = loc.sub + cfg.appName + "/" + safeName(filename);
    return fs.downloadFile({ url: url, path: path, directory: loc.directory, recursive: true }).then(function (r) {
      return { uri: (r && r.path) || null, path: path, location: loc.label, size: 0, mime: "" };
    });
  }

  var dlQueue = Promise.resolve();
  function download(url, filename, opts) {
    var job = dlQueue.then(function () { return runDownload(url, filename, opts); });
    dlQueue = job.catch(function () {});
    return job;
  }

  function runDownload(url, filename, opts) {
    opts = opts || {};
    var guessed = !filename;
    filename = safeName(filename || guessName(url));
    var locKey = opts.location || cfg.defaultLocation;

    var pre = Promise.resolve(true);
    if (!opts.silent) {
      var pref = storage.get("dl_pref", null);
      if (pref && cfg.rememberChoice && !opts.location) {
        locKey = pref.location;
      } else if (cfg.askBeforeDownload) {
        pre = chooseLocation(filename).then(function (c) {
          if (!c) return false;
          filename = c.filename; locKey = c.location; guessed = false;
          if (c.remember && cfg.rememberChoice) storage.set("dl_pref", { location: c.location });
          return true;
        });
      }
    }

    return pre.then(function (go) {
      if (!go) return null;
      var ctrl = new AbortController();
      var box = progressBox("Downloading", function () { ctrl.abort(); });
      box.update(0, 0);

      return fetchBlob(url, function (g, t) { box.update(g, t); }, ctrl.signal)
        .then(function (r) {
          if (guessed && r.name) filename = safeName(r.name);
          box.text("Saving...");
          return saveBlob(r.blob, filename, locKey);
        })
        .catch(function (err) {
          if (ctrl.signal.aborted) throw err;
          if (global.Android && global.Android.downloadUrl && /^https?:/i.test(url)) {
            log("warn", "fetch failed, using Android download manager:", err);
            if (global.Android.downloadUrl(url, filename)) {
              return { uri: null, path: filename, location: "Downloads (see notification)", size: 0, mime: "", native: true };
            }
          }
          if (P().Filesystem && P().Filesystem.downloadFile && /^https?:/i.test(url)) {
            log("warn", "fetch failed, trying native download:", err);
            box.text("Downloading...");
            return nativeDownload(url, filename, locKey);
          }
          throw err;
        })
        .then(function (info) {
          box.close();
          info.name = filename; info.time = Date.now();
          addHistory(info);
          emit("download", info);
          if (cfg.onDownloadSaved) cfg.onDownloadSaved(info);
          if (cfg.afterDownload === "prompt") return afterPrompt(info).then(function () { return info; });
          toast(info.native ? "Saved to " + info.location : "Saved to " + info.location + "/" + cfg.appName);
          return info;
        })
        .catch(function (err) {
          var cancelled = ctrl.signal.aborted;
          box.close();
          if (cancelled) { toast("Download cancelled"); return null; }
          log("error", "Download failed:", err);
          toast("Download failed");
          emit("downloadError", err);
          if (cfg.onDownloadError) cfg.onDownloadError(err);
          return null;
        });
    });
  }

  function afterPrompt(info) {
    return choose("Saved: " + info.name, [
      { label: "Open", value: "open", primary: true },
      { label: "Share", value: "share" },
      { label: "Close", value: null }
    ]).then(function (v) {
      if (v === "open") return openFile(info.uri, info.mime);
      if (v === "share") return share({ title: info.name, url: info.uri });
    });
  }

  function openFile(uri, mime) {
    if (global.Android && global.Android.openFile && uri) {
      try { if (global.Android.openFile(String(uri), mime || "*/*")) return Promise.resolve(); } catch (_) {}
    }
    var fo = P().FileOpener;
    if (fo && uri) {
      return fo.open({ filePath: uri, contentType: mime || undefined }).catch(function () { return share({ url: uri }); });
    }
    return share({ url: uri });
  }

  var downloads = {
    list: function () { return storage.get("downloads", []); },
    clear: function () { storage.remove("downloads"); },
    resetPreference: function () { storage.remove("dl_pref"); }
  };
  function addHistory(info) {
    var l = downloads.list();
    l.unshift({ name: info.name, uri: info.uri, location: info.location, size: info.size, mime: info.mime, time: info.time });
    storage.set("downloads", l.slice(0, 50));
  }

  function saveText(name, text, mime) {
    return saveBlob(new Blob([text], { type: mime || "text/plain" }), name, cfg.defaultLocation);
  }
  function saveDataUrl(name, dataUrl, locKey) {
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (b) { return saveBlob(b, name, locKey || cfg.defaultLocation); });
  }

  function shouldIntercept(a) {
    if (!cfg.interceptDownloads || a.getAttribute("data-nb-skip")) return false;
    var href = a.href || "";
    return a.hasAttribute("download") || /^(blob|data):/i.test(href);
  }
  function setupDownloadInterceptor() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a || !shouldIntercept(a)) return;
      e.preventDefault(); e.stopPropagation();
      download(a.href, a.getAttribute("download") || undefined);
    }, true);
    // programmatic a.click() (FileSaver.js, jsPDF, etc.) never reaches document listeners
    var orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (shouldIntercept(this)) { download(this.href, this.getAttribute("download") || undefined); return; }
      return orig.apply(this, arguments);
    };
  }

  /* ================================================================== LINKS */
  function openUrl(url) {
    var b = P().Browser;
    if (b && b.open) return b.open({ url: url });
    global.open(url, "_blank");
  }
  function setupLinks() {
    if (cfg.openExternalLinks) {
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a[href]");
        if (!a || a.hasAttribute("download") || e.defaultPrevented) return;
        var u; try { u = new URL(a.href); } catch (_) { return; }
        if (!/^https?:$/.test(u.protocol)) return; // tel:, mailto:, etc. handled by system
        if (u.origin !== location.origin) { e.preventDefault(); openUrl(a.href); }
        else if (a.target === "_blank") { e.preventDefault(); location.href = a.href; }
      });
    }
    if (cfg.overrideWindowOpen) {
      var orig = global.open;
      global.open = function (url, target) {
        if (!url) return orig.apply(global, arguments);
        var u; try { u = new URL(url, location.href); } catch (_) { return orig.apply(global, arguments); }
        if (/^https?:$/.test(u.protocol)) {
          if (u.origin !== location.origin || target === "_system") { openUrl(u.href); return null; }
          if (target === "_blank") { location.href = u.href; return null; }
        }
        return orig.apply(global, arguments);
      };
    }
  }

  /* ============================================================ DEVICE FEATURES */
  function share(o) {
    var s = P().Share;
    if (s) return s.share(o).then(function () { return true; }, function () { return false; });
    if (origNavShare) return origNavShare(o).then(function () { return true; }, function () { return false; });
    return copy(o.url || o.text || "").then(function () { toast("Copied to clipboard"); return false; });
  }
  function copy(text) {
    var c = P().Clipboard;
    if (c) return c.write({ string: String(text) }).then(function () { return true; }, function () { return false; });
    if (origClipboard && origClipboard.writeText) {
      return origClipboard.writeText(String(text)).then(function () { return true; }, function () { return false; });
    }
    var ta = el("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove();
    return Promise.resolve(ok);
  }
  function paste() {
    var c = P().Clipboard;
    if (c) return c.read().then(function (r) { return r.value || ""; }, function () { return ""; });
    if (origClipboard && origClipboard.readText) return origClipboard.readText().catch(function () { return ""; });
    return Promise.resolve("");
  }

  function haptic(type) {
    var h = P().Haptics;
    try {
      if (h) {
        if (/^(success|warning|error)$/.test(type)) h.notification({ type: type.toUpperCase() });
        else if (type === "vibrate") h.vibrate();
        else h.impact({ style: String(type || "light").toUpperCase() });
      } else if (navigator.vibrate) navigator.vibrate(type === "heavy" ? 30 : 10);
    } catch (_) {}
  }
  function setupHaptics() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-haptic]");
      if (t) haptic(t.getAttribute("data-haptic") || "light");
    }, true);
  }

  function setStatusBar(o) {
    o = o || {};
    var s = P().StatusBar;
    if (o.color) {
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = el("meta"); m.name = "theme-color"; document.head.appendChild(m); }
      m.content = o.color;
    }
    if (!s) return;
    try {
      if (o.color) s.setBackgroundColor({ color: o.color });
      if (o.dark != null) s.setStyle({ style: o.dark ? "DARK" : "LIGHT" });
      if (o.overlay != null) s.setOverlaysWebView({ overlay: !!o.overlay });
      if (o.hide === true) s.hide();
      if (o.hide === false) s.show();
    } catch (e) { log("warn", e); }
  }
  function hideSplash() {
    var s = P().SplashScreen;
    if (s && s.hide) s.hide().catch(function () {});
  }

  var orientation = {
    lock: function (o) {
      var so = P().ScreenOrientation;
      if (so) return so.lock({ orientation: o });
      if (screen.orientation && screen.orientation.lock) return screen.orientation.lock(o).catch(function () {});
      return Promise.resolve();
    },
    unlock: function () {
      var so = P().ScreenOrientation;
      if (so) return so.unlock();
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
      return Promise.resolve();
    }
  };

  var wake = null;
  function keepAwake(on_) {
    var k = P().KeepAwake;
    if (k) return on_ ? k.keepAwake() : k.allowSleep();
    if (navigator.wakeLock) {
      if (on_) {
        var req = function () { navigator.wakeLock.request("screen").then(function (l) { wake = l; }).catch(function () {}); };
        req();
        document.addEventListener("visibilitychange", function () { if (!document.hidden && wake !== false) req(); });
      } else if (wake) { wake.release(); wake = false; }
    }
    return Promise.resolve();
  }

  var notify = {
    permission: function () {
      var n = P().LocalNotifications;
      if (!n) return Promise.resolve(!!NativeNotification && NativeNotification.permission === "granted");
      return n.checkPermissions().then(function (p) {
        return p.display === "granted" ? p : n.requestPermissions();
      }).then(function (p) { return p.display === "granted"; }).catch(function () { return false; });
    },
    show: function (o) {
      var n = P().LocalNotifications;
      if (!n) {
        if (NativeNotification && NativeNotification.permission === "granted") { new NativeNotification(o.title, { body: o.body }); return Promise.resolve(true); }
        return Promise.resolve(false);
      }
      return notify.permission().then(function (ok) {
        if (!ok) return false;
        return n.schedule({
          notifications: [{
            id: o.id || Math.floor(Date.now() % 2147483647),
            title: o.title, body: o.body || "",
            schedule: o.at ? { at: new Date(o.at) } : undefined
          }]
        }).then(function () { return true; });
      });
    },
    cancel: function (id) {
      var n = P().LocalNotifications;
      return n ? n.cancel({ notifications: [{ id: id }] }) : Promise.resolve();
    }
  };

  var permissions = {
    media: function (constraints) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
      return navigator.mediaDevices.getUserMedia(constraints || { video: true }).catch(function (e) {
        log("warn", "Media permission:", e);
        return popup({ title: "Permission needed", message: "Please allow camera/microphone access in your phone's app settings." }).then(function () { return null; });
      });
    },
    location: function () {
      return new Promise(function (res) {
        if (!navigator.geolocation) return res(null);
        navigator.geolocation.getCurrentPosition(function (p) { res(p.coords); }, function () { res(null); }, { enableHighAccuracy: true, timeout: 15000 });
      });
    }
  };

  function info() {
    var p = P(), out = { platform: platform(), version: cfg.version, bridge: VERSION };
    var jobs = [];
    if (p.App && p.App.getInfo) jobs.push(p.App.getInfo().then(function (a) { out.name = a.name; out.id = a.id; out.version = a.version; out.build = a.build; }));
    if (p.Device && p.Device.getInfo) jobs.push(p.Device.getInfo().then(function (d) { out.device = d; }));
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); })).then(function () { return out; });
  }

  function checkUpdate(url) {
    url = url || cfg.updateUrl;
    if (!url) return Promise.resolve(null);
    return Promise.all([info(), nfetch(url + (url.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now(), { retries: 1 }).then(function (r) { return r.json(); })])
      .then(function (r) {
        var cur = r[0].version, j = r[1];
        if (cmpVer(j.version, cur) > 0) {
          return confirmBox("Update available", "Version " + j.version + (j.notes ? "\n" + j.notes : "")).then(function (go) {
            if (go && j.url) openUrl(j.url);
            return j;
          });
        }
        return null;
      }).catch(function (e) { log("warn", "Update check failed", e); return null; });
  }

  /* ======================================================== BROWSER POLYFILLS */
  // Android WebView lacks some browser APIs. Sites/apps written for Chrome expect them.
  function setupPolyfills() {
    try {
      if (!NativeNotification) {
        var NP = function (title, o) { notify.show({ title: String(title), body: o && o.body }); };
        NP.permission = "default";
        NP.requestPermission = function (cb) {
          return notify.permission().then(function (ok) {
            NP.permission = ok ? "granted" : "denied";
            if (cb) cb(NP.permission);
            return NP.permission;
          });
        };
        global.Notification = NP;
      }
      if (!origNavShare) {
        navigator.share = function (d) {
          return share(d || {}).then(function (ok) {
            if (!ok) { var e = new Error("Share cancelled"); e.name = "AbortError"; throw e; }
          });
        };
        navigator.canShare = navigator.canShare || function () { return true; };
      }
      if (!origClipboard) {
        navigator.clipboard = {
          writeText: function (t) { return copy(t).then(function (ok) { if (!ok) throw new Error("Copy failed"); }); },
          readText: function () { return paste(); }
        };
      }
      if (typeof navigator.vibrate !== "function" && P().Haptics) {
        navigator.vibrate = function () { haptic("vibrate"); return true; };
      }
    } catch (e) { log("warn", "polyfills:", e); }
  }

  /* =============================================================== DEBUG UI */
  function debugConsole(forceShow) {
    injectStyles();
    var pane = document.getElementById("nb-debug");
    if (pane) { if (forceShow !== true) pane.remove(); return; }
    pane = el("div", "nb-debug"); pane.id = "nb-debug";
    var bar = el("div", "nb-dbar"), out = el("pre");
    function render() { out.textContent = logs.map(function (l) { return new Date(l.t).toLocaleTimeString() + " [" + l.level + "] " + l.msg; }).join("\n"); out.scrollTop = out.scrollHeight; }
    [["Copy", function () { copy(out.textContent).then(function () { toast("Logs copied"); }); }],
     ["Save", function () { saveText("app-log.txt", out.textContent); }],
     ["Clear", function () { logs.length = 0; render(); }],
     ["Close", function () { pane.remove(); }]].forEach(function (b) {
      var btn = el("button", "nb-btn", b[0]); btn.onclick = b[1]; bar.appendChild(btn);
    });
    pane.appendChild(bar); pane.appendChild(out);
    document.body.appendChild(pane);
    render();
    var stop = on("log", function () { if (document.getElementById("nb-debug")) render(); else stop(); });
  }

  /* ================================================================== INIT */
  var inited = false;

  function init(options) {
    Object.assign(cfg, options || {});
    if (inited) return api;
    inited = true;
    setupErrorCapture();

    var start = function () {
      try {
        applyUX();
        if (cfg.polyfills) setupPolyfills();
        setupBackButton();
        setupLifecycle();
        setupDownloadInterceptor();
        setupLinks();
        setupKeyboard();
        setupNetwork();
        setupHaptics();
        if (cfg.statusBar) setStatusBar(cfg.statusBar);
        if (cfg.orientation) orientation.lock(cfg.orientation);
        if (cfg.keepAwake) keepAwake(true);
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
        if (cfg.debug) {
          injectStyles();
          var bug = el("button", "nb-bug", "\uD83D\uDC1E");
          bug.onclick = function () { debugConsole(); };
          document.body.appendChild(bug);
        }
      } catch (e) { log("error", "init failed", e); }

      storage.restore().then(function (n) {
        if (n) log("info", "Restored " + n + " keys from native storage");
        restoreRoute();
        if (cfg.hideSplash) hideSplash();
        if (cfg.updateUrl) checkUpdate();
        emit("ready", { platform: platform(), native: isNative() });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    return api;
  }

  /* ================================================================== API */
  var api = {
    version: VERSION,
    init: init, config: cfg,
    isNative: isNative, platform: platform, info: info,
    on: on, off: off,                       // events: ready, pause, resume, network, download, downloadError, deeplink, log

    // downloads / files
    download: download, saveBlob: saveBlob, saveText: saveText, saveDataUrl: saveDataUrl,
    openFile: openFile, downloads: downloads,

    // back button
    onBack: onBack, _onBack: function () { return handleBack(undefined, true); },
    exit: exitApp, minimize: minimize,

    // UI
    popup: popup, toast: toast, confirm: confirmBox, prompt: promptBox, alert: function (m, t) { return popup({ title: t || cfg.appName, message: String(m) }); },
    choose: choose, loading: loading,

    // storage
    storage: storage, db: db, reset: resetApp,

    // network
    network: net, fetch: nfetch, waitForOnline: waitForOnline,

    // device
    share: share, copy: copy, paste: paste, haptic: haptic,
    statusBar: setStatusBar, hideSplash: hideSplash,
    orientation: orientation, keepAwake: keepAwake,
    notify: notify, permissions: permissions,
    openUrl: openUrl, checkUpdate: checkUpdate,

    // debug
    debugConsole: debugConsole, logs: function () { return logs.slice(); }, log: function () { log.apply(null, ["info"].concat([].slice.call(arguments))); }
  };

  global.NativeApp = api;
})(window);
