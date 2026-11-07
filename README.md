# Payaz Label Station (tablet version)

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

| Button | What you do | What prints |
|---|---|---|
| **Payaz Order** | Type the number (tap **PZ** for numbers like 48374PZ) | "Payaz Order Number:", the number, a small barcode and the date |
| **SumUp Card Reader** | Scan the reader | The number with the **last 3 digits large**, a barcode and the date |
| **Tablet** | Scan the tablet's serial | "Tablet Serial Number:", the serial, a barcode and the date |
| **Print All** | Fill in any or all three | Everything you filled in, on one label |

Every screen shows all three boxes. One box filled gives that label on its own;
two or three give one combined label. **⚙ Settings** has the label size, print darkness
(1–9), flip upside down and the test print.

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
