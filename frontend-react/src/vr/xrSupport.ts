/** Is immersive VR available in this browser?  Takes the navigator as an argument so the answer is testable with a fake `navigator.xr`. */
export type XrStatus =
  | { state: 'supported' }
  | { state: 'insecure'; message: string }
  | { state: 'no-webxr'; message: string }
  | { state: 'no-vr'; message: string }
  | { state: 'error'; message: string }

interface XrLike { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string, init?: unknown): Promise<unknown> }
export interface NavLike { xr?: XrLike }

export async function detectXr(nav: NavLike | undefined = typeof navigator !== 'undefined' ? (navigator as unknown as NavLike) : undefined, secure: boolean = typeof isSecureContext !== 'undefined' ? isSecureContext : true): Promise<XrStatus> {
  if (!secure) return { state: 'insecure', message: 'This page is not served over HTTPS, so the browser hides WebXR. Open the https:// address of the site (see the Quest setup guide); VR cannot start from a plain http:// address.' }
  if (!nav || !nav.xr) return { state: 'no-webxr', message: 'This browser does not offer WebXR, so VR is unavailable. You can still walk through the house with the keyboard and mouse.' }
  try {
    const ok = await nav.xr.isSessionSupported('immersive-vr')
    return ok ? { state: 'supported' } : { state: 'no-vr', message: 'This browser has WebXR but no VR headset is available. You can still walk through the house with the keyboard and mouse.' }
  } catch (e) {
    return { state: 'error', message: `Could not check for a VR headset: ${(e as Error).message}` }
  }
}
