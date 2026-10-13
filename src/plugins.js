// Bundles the Capacitor plugins so native-bridge-pro.js can find them (window.NBPlugins).
// To add a plugin: npm i it, import it here, add it to the object below.
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Clipboard } from "@capacitor/clipboard";
import { Device } from "@capacitor/device";
import { Filesystem } from "@capacitor/filesystem";
import { Haptics } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar } from "@capacitor/status-bar";

window.NBPlugins = {
  App, Browser, Clipboard, Device, Filesystem, Haptics, Keyboard,
  LocalNotifications, Network, Preferences, ScreenOrientation, Share,
  SplashScreen, StatusBar
};
