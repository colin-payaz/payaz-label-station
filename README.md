# Payaz Label Station (tablet version)

## Install the Android app

On the Lenovo tablet, open this link in Chrome and install the file it downloads:

**https://github.com/colin-payaz/payaz-label-station/releases/latest/download/payaz-labels.apk**

The first time, Android asks you to allow installing apps from Chrome: tap **Settings**,
turn on **Allow from this source**, then go back and tap **Install**. Open **Payaz Labels**,
tap **Connect printer**, allow **Nearby devices**, and choose the printer (it starts with **T0**).

The app reconnects to the same printer by itself each time it opens, runs full screen
and keeps the screen on. To update it, download and install the latest APK the same way.
Your settings are kept.

The APK is built automatically by GitHub Actions (`.github/workflows/android.yml`) on every
push to `main`, and published under **Releases**. It's signed with the key in the
`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` repository secrets. Without them,
the build makes a test app with a temporary key.

## Or use it as a web app

Prints Payaz order, SumUp reader and tablet serial labels on a **SUPVAN T50M Pro**
from a **Lenovo tablet**, over Bluetooth. No Raspberry Pi, cables or computer needed.

It's a web app: it runs in Google Chrome on the tablet and can be added to the home
screen so it opens full screen like a normal app. Once opened it also works without
internet.

## What you need

- The Lenovo tablet (Android) with **Google Chrome**
- The SUPVAN T50M Pro, charged and switched on, with 40 × 30 mm labels
- A barcode scanner, either:
  - a **Bluetooth** scanner (recommended, because it leaves the tablet's charging port free), paired in
    the tablet's Bluetooth settings like a keyboard, or
  - a USB scanner plugged in with a **USB‑C OTG adapter**
- Or just use the tablet's **camera**: tap **Use camera** on any scan screen

## The app's web address

**https://colin-payaz.github.io/payaz-label-station/**

It's hosted free on GitHub Pages from this repository's `gh-pages` branch. To update the
app, push changes to `main`, then update `gh-pages` to match:

```bash
git push origin main main:gh-pages
```

Then bump `VERSION` in `sw.js` so tablets pick up the change.

## Step 2: Set up the tablet

1. Open **Chrome** on the tablet and go to **colin-payaz.github.io/payaz-label-station**.
2. Tap Chrome's **⋮** menu, then **Add to Home screen** (or **Install app**).
3. Open **Payaz Labels** from the home screen. It opens full screen.
4. Switch the printer on and tap **Connect printer** (top right). Allow **Nearby devices**
   if Android asks, then choose the printer. Its name starts with **T0**.
5. Tap **⚙ Settings**, then **Print a test label**.

Next time, open the app and it reconnects to the same printer. If it doesn't, tap
**Connect printer** again.

**Optional: lock the tablet to this app.** In Android **Settings → Security → App pinning**
(it may be called *Screen pinning*), turn it on. Then open Recent apps, tap the Payaz Labels
icon and choose **Pin**.

## Using it

| Button | What it does |
|---|---|
| **Log** | Every Order Label printed: order number, date, card reader, tablet and **warranty expiry** (12 months after printing; expired dates show in red). Scan or type a serial to find it, tap a row to delete it, and **Export CSV** to email it or save it to Drive. |
| **Stock** | Coming soon. |
| **Stock Label** | Type the item **name** and **location**, then scan or type the **stock code**. Prints the name at the top, the location, then the code and its barcode. |
| **Order Label** | Type the order number (tap **PZ** for numbers like 48374PZ) and scan the card reader and/or tablet. One box filled prints that on its own; two or three print one combined label. Each one is added to the Log. |

The log is saved on the tablet. In the Android app it's also copied to
**Documents/PayazLabels/payaz-label-log.csv** after every print, so you can find it with the
Files app. Uninstalling the app deletes the in-app log, so export it first.

**⚙ Settings** has the label size, print darkness (1–9), flip upside down and the test print.

## If something goes wrong

- **"The printer didn't answer"**: make sure the printer is on and near the tablet. Close the
  SUPVAN or Katasymbol phone app on any other phone, because the printer only takes one
  connection at a time.
- **Printer not in the list**: switch the printer off and on, and check Bluetooth and
  Location are on in the tablet's quick settings.
- **Faint print**: raise **Darkness** in Settings.
- **Upside down**: turn on **Flip label upside down**.
- **After uploading a new version**: open the app with internet on, then tap
  Settings → **Restart app**.

## How it works (for someone technical)

- Plain HTML/JavaScript, with no build step. `js/labels.js` draws the labels at 203 dpi with Code 128
  barcodes; `js/printer.js` talks to the printer over Web Bluetooth (BLE GATT service
  `e0ff`). It's a trimmed port of the MIT-licensed T50/T80 driver from
  [Supvan & Katasymbol web print studio](https://github.com/khromov/supvan-katasymbol-printer-web-ui),
  which was tested on a T50M Pro. `js/lzma.js` is Supvan's modified LZMA-JS (MIT), which the
  printer firmware needs.
- Settings are saved on the tablet (browser storage). `sw.js` keeps it working offline.
- Fonts: Montserrat (screen) and Atkinson Hyperlegible (labels), both SIL Open Font Licence.
