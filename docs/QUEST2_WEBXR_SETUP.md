# Smart House VR on Meta Quest 2 — directly from the website (WebXR, no Unity)

Nothing to install on the headset and nothing to transfer: the Quest 2 opens the **website** in its built-in browser, and the website builds the house you
generated, exports its `.glb` in memory, loads it, and starts an immersive WebXR session.
No Unity, no APK, no Android Studio, no manual `.glb` import. (The earlier Unity package is still in `unity-smart-house/` as an optional alternative; it is not needed.)

> **Honest status:** this has been exercised in desktop Chromium (real backend, real pages) and with a *mocked* WebXR session.
> It has **not** been run on a Meta Quest 2 yet. Section 5 lists what you must confirm on the device. No frame-rate figure is claimed.

## 1. What you need
* A computer (Windows / macOS / Linux) running the project: Python backend + Node 18+ for the frontend (as before).
* The Quest 2 and the computer on the **same Wi-Fi network**.
* `openssl` on the computer (Git for Windows ships it; macOS/Linux have it) — only for the one-time HTTPS certificate.
* No paid service and no API key is required for anything in this guide.

## 2. Why HTTPS
The Quest Browser only exposes WebXR (`navigator.xr`) on **https://** pages (or `localhost`, which the headset cannot reach).
So the dev server has to speak HTTPS on the LAN. This project provides that with a self-signed certificate:

```
# terminal 1 – backend (as usual)
python run_server.py

# terminal 2 – frontend
cd frontend-react
npm install                 # first time
npm run quest:cert          # once: writes frontend-react/.certs/dev.key + dev.crt for this computer's LAN address(es)
npm run quest               # dev server on https://<computer-ip>:5173 (all interfaces)
#   or, for the production build (smaller, faster to load on the headset):
npm run quest:preview       # builds, then serves on https://<computer-ip>:4173
```
`npm run quest:cert` prints the addresses it is valid for, e.g. `https://192.168.1.23:5173`.
If your network address changes (new Wi-Fi, DHCP), run `npm run quest:cert` again.
Allow the port (5173 / 4173) through the computer's firewall for private networks if the headset cannot connect.

**Alternative without a certificate:** an HTTPS tunnel to the dev server (`cloudflared tunnel --url http://localhost:5173`, or ngrok). Tunnel tools may need an
account for some features; none is required by this project, and I have not tested either with a Quest.

## 3. Using it on the Quest 2
1. Put the headset on, open **Browser**, go to the address from step 2 (`https://<computer-ip>:5173`).
2. The browser warns that the certificate is not trusted (it is your own self-signed one). Choose *Advanced → Proceed*. *(Needs confirming on the device: that WebXR is still offered after proceeding.)*
3. **Sign in** (or create an account). Generate a house with the existing generator and **Save to my projects** (as you did before), on the Quest or on the computer.
4. Open **VR walk-through** in the top menu. Your saved houses are listed. Pick one and press **Enter VR**.
5. The page shows a loading bar (house built → `.glb` exported → loaded → optimised). Then press **Enter VR** on the viewer page; the browser asks for permission and the immersive session starts, with you standing in the house.
6. If the page says *"no VR headset"* or *"not served over HTTPS"*, the reason is shown, and the desktop 3D walk-through still works (mouse + keyboard).

### Entering and exiting VR
* **Enter:** the **Enter VR** button on the viewer page (the browser's own *Enter VR* prompt may also appear).
* **Exit:** the **EXIT VR** button on the in-VR control panel, or the Meta button → *Exit*, or the **Exit VR** button on the page after you take the headset off.

Controls, lights, fans and the panel: see `docs/QUEST2_WEBXR_CONTROLS.md`.
What is and is not verified: see `docs/QUEST2_WEBXR_COMPATIBILITY.md`.

## 4. If something goes wrong
| Symptom | Likely cause / what to do |
|---|---|
| Quest cannot open the address | Different Wi-Fi, or firewall: allow the port; check the IP printed by `npm run quest:cert`. |
| Page loads but *Enter VR* is greyed out and says "not served over HTTPS" | You opened `http://`. Use the `https://` address. |
| "This browser does not offer WebXR" | Not the Quest Browser (or an old browser version): update the headset software. |
| Loading is slow / the browser reloads | Very large houses: use `npm run quest:preview` (production build). The viewer already caps texture size (1024 px) and merges meshes by material to reduce draw calls. |
| The player cannot reach a room on foot | A few generated layouts seal a bathroom with furniture or a stair rail (see compatibility report). Teleport (right stick forward, release), *Go G / Go 1F* or the room's **GO** button on the panel always work. |

## 5. Please confirm on the device (and send me the result)
See the "Needs a real Quest 2" list in `docs/QUEST2_WEBXR_COMPATIBILITY.md`.

## 6. Added later: customisation panel, daylight, QR
* **Customize** (button on the smart panel, or right controller **A**) opens a second floating panel: see `docs/VR_CUSTOMIZATION.md`.
* The scene now defaults to **daylight** lighting (History tab → DAYLIGHT / EVENING to switch).
* Share / scan a link with **Share QR** / **Scan QR** on the app header, and the Cloudflare tunnel start-up order: `docs/QR_AND_CLOUDFLARE_WORKFLOW.md`.
* None of these has been run on a physical Quest 2; they are covered by desktop-browser and simulated-controller tests only.
* **Hands-free voice** starts when you press Enter VR (explicit microphone permission; the page needs https). Whether the Meta Quest Browser exposes speech recognition inside an immersive session is **not verified**; if it does not, the status pill says "Voice recognition unsupported" and everything else keeps working. Please test on the headset and note what the pill shows: `docs/HANDS_FREE_VOICE.md`.
