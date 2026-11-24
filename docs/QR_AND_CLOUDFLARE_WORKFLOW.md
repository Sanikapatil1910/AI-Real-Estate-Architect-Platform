# QR share / scan and the Cloudflare Quick Tunnel workflow

**Status of testing.** The QR logic is unit-tested (`frontend-react/dev/check_qr.ts`) and the dialogs are exercised in desktop Chromium with a *fake camera*
(a video file of a QR code). Nothing here has been run through a real Cloudflare tunnel, a real phone camera or a real Meta Quest camera.

## Start-up order (backend → frontend → tunnel)
1. **Backend** (FastAPI), in the repo root: `python run_server.py` (listens on `localhost:8000`).
2. **Frontend**, in `frontend-react/`: `npm install` once, then `npm run dev` (http://localhost:5173). For the local-network HTTPS option use `npm run quest:cert` then `npm run quest`.
3. **Tunnel** (separate terminal): `cloudflared tunnel --url http://localhost:5173`. It prints an address like `https://<random-words>.trycloudflare.com`; it changes on every start.
4. **Open that https address on the computer** (not localhost), sign in, then press **Share QR**. The QR then carries the tunnel address, so a phone or the Quest can open it.

Why this works without edits: `vite.config.ts` allows the host suffix `.trycloudflare.com` (plus `localhost`, `127.0.0.1` and anything in the environment variable
`ALLOWED_HOSTS=name1,name2`), and the API paths (`/auth`, `/projects`, `/generate`, ...) are proxied by Vite to the backend (`API_TARGET`, default `http://localhost:8000`).
The backend is never put in a QR code; an address that is the backend (port 8000, or `/docs`, `/projects`, ... paths) is refused with an explanation.

## Share QR (desktop → phone / headset)
* Reads the address of the page you are on (`window.location`), so no tunnel name is hard-coded. A pasted override address can replace it (e.g. the tunnel address while you are still on localhost).
* Shows the QR, the full address as text, **Copy URL**, **Regenerate** (re-reads the current address) and **Close**.
* Honest warnings: `localhost` only works on this computer; private network addresses only work on the same Wi-Fi; `http` pages cannot enter VR on the Quest Browser (WebXR needs https).

## Scan QR (in the app)
* The camera starts only after you press **Start camera**, with a live preview. Uses `BarcodeDetector` when the browser has it, otherwise `jsQR` (bundled, loaded on demand).
* A scanned address is **never opened automatically**. It is validated (only `http:`/`https:`; `javascript:`, `data:`, `file:` etc., addresses with embedded credentials, spaces / control characters, over-long text and backend addresses are rejected), then a confirmation screen shows the host prominently with **Cancel** and **Open**.
* Handled: camera permission denied, no camera / unsupported browser, invalid code. Camera tracks are stopped when the dialog closes or a code is accepted.

## If the Quest cannot scan
The Quest Browser may not give pages camera access (not verified on a device). Fallbacks: scan the QR shown on the computer with a **phone** and send / type the address in the headset, use **Copy URL** and paste it into the Quest Browser, or type the tunnel address by hand.

## Known limits
* Quick Tunnel addresses are temporary and public to anyone who knows the address; do not leave a tunnel running with real data.
* Real-tunnel behaviour (latency, WebSocket HMR through the tunnel), and Quest camera access, are untested.
