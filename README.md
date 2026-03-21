# FrameRate 📸

**FrameRate** is a powerful, high-performance Chrome Extension for meticulously capturing exactly what you see. Featuring a gorgeous Neumorphic (Braun/Dieter Rams) inspired user interface, FrameRate is designed to handle memory-intensive full-page screenshot stitching, smooth 60FPS video recording, and rapid sequential frame extraction securely within Chrome's Manifest V3 architecture.

## ✨ Features and Capabilities

FrameRate includes 5 specialized capture modes:

1. **Shot (Single Screenshot)**
   - Instantly captures a high-resolution PNG of your currently visible viewport.

2. **Full Page (Intelligent Stitching)**
   - Automatically scrolls from the top to the bottom of the webpage, capturing each segment.
   - Steams frames to a hidden background canvas, seamlessly stitching them together into one massive, pixel-perfect PNG without crashing your browser.

3. **Seq (Sequential Frame Extraction)**
   - Automatically scrolls down the page and isolates each segment as a separate, sequentially numbered PNG file (`frame_001.png`, `frame_002.png`, etc.). 
   - Great for extracting slides, lazy-loaded galleries, or bypassing memory limits on infinitely long pages.

4. **Vid (60FPS Web Video)**
   - Leverages Chrome's `chrome.tabCapture` API to record exceptionally smooth 60fps video directly from your active tab.
   - Encodes via a hidden offscreen document for zero performance penalty, saving out crisp `.mp4` / `.webm` files.

5. **Full screen vid (Auto-Scrolling Walkthrough)**
   - Functions like the standard Video mode, but the extension will automatically perform a buttery-smooth continuous scroll down the page, acting as your autonomous cameraman.

## ⌨️ Global Keyboard Shortcut
Need to stop a video or sequence capture fast? FrameRate actively listens for:

* **Windows / Linux:** `Alt + S`
* **macOS:** `Cmd + Shift + S`

Pressing this globally halts any running capture modes and forces the extension to instantly finalize and download your file.

## 🚀 How to Install and Run Locally

Since FrameRate is currently a local project, you will need to install it directly from the source code via Chrome's Developer Mode:

1. **Download or Clone** this folder to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/` in your address bar.
3. In the top right corner, toggle **Developer mode** to **ON**.
4. In the top left corner, click the **Load unpacked** button.
5. Select the `FrameRate` folder (the folder containing the `manifest.json` file).
6. **Done!** You should now see the cute FrameRate hamster icon in your Chrome toolbar. Pin it for quick access!

## 🛠 Technical Architecture
* **Manifest V3:** Fully compliant with Chrome's modern security and performance service worker architecture. 
* **Offscreen Documents:** Relies on the `offscreen.html` API to bypass memory limitations, rendering gigantic stitched `<canvas>` images and encoding `MediaRecorder` streams efficiently.
* **Neumorphic CSS:** The Popup UI is built without heavy frameworks. The sleek shadows, dynamic acoustic grills, and stateful hover-delays are achieved entirely through raw Vanilla HTML/CSS.
