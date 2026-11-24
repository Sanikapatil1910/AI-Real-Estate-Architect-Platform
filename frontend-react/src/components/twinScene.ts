import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Time } from './twinThemes'

/**
 * Rendering set-up of the digital twin: physically based sky for the environment lighting, filmic tone mapping, soft sun shadows,
 * and a screen-space ambient-occlusion pass.  It is still a real-time rasteriser (no path tracing): the aim is the best look that
 * runs smoothly in a browser.
 */

type SkyKind = 'day' | 'dusk'
const SKY: Record<SkyKind, { elev: number; azim: number; turb: number; ray: number; mie: number; g: number }> = {
  day: { elev: 52, azim: 180, turb: 2.4, ray: 0.5, mie: 0.004, g: 0.8 },
  dusk: { elev: 2.5, azim: 262, turb: 6, ray: 2.0, mie: 0.01, g: 0.9 },
}

/** Prefiltered sky (no sun disc) used as environment light and as the backdrop. */
export function makeSkyEnv(renderer: THREE.WebGLRenderer, kind: SkyKind): THREE.Texture {
  const p = SKY[kind]
  const sky = new Sky()
  sky.scale.setScalar(90)
  const u = sky.material.uniforms
  u.turbidity.value = p.turb
  u.rayleigh.value = p.ray
  u.mieCoefficient.value = p.mie
  u.mieDirectionalG.value = p.g
  if (u.showSunDisc) u.showSunDisc.value = false
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.elev), THREE.MathUtils.degToRad(p.azim))
  u.sunPosition.value.copy(sun)
  const sc = new THREE.Scene()
  sc.add(sky)
  const pm = new THREE.PMREMGenerator(renderer)
  const rt = pm.fromScene(sc, 0, 0.1, 100)
  pm.dispose()
  sky.geometry.dispose()
  ;(sky.material as THREE.Material).dispose()
  return rt.texture
}

/** Neutral, warm-white studio light for the daytime reflections and ambient fill (a sky env would tint every shadow blue). */
export function makeStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const rt = pm.fromScene(room, 0.04)
  room.dispose()
  pm.dispose()
  return rt.texture
}

export interface Rig {
  render: () => void
  setSize: (w: number, h: number) => void
  setAO: (on: boolean) => void
  dispose: () => void
}

export function createRig(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number): Rig {
  const pr = Math.min(renderer.getPixelRatio(), 1.5)
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, rt)
  composer.setPixelRatio(pr)
  composer.setSize(w, h)
  composer.addPass(new RenderPass(scene, camera))
  const gtao = new GTAOPass(scene, camera, w, h)
  gtao.updateGtaoMaterial({ radius: 1.5, distanceExponent: 1.4, thickness: 2.0, scale: 1.15, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 })
  gtao.blendIntensity = 0.9
  composer.addPass(gtao)
  composer.addPass(new OutputPass())
  let ao = true
  /** Room labels live on layer 1 and are drawn on top of the finished picture, without depth test. */
  const overlay = () => {
    const bg = scene.background
    const fog = scene.fog
    scene.background = null
    scene.fog = null
    camera.layers.set(1)
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(scene, camera)
    renderer.autoClear = true
    camera.layers.set(0)
    scene.background = bg
    scene.fog = fog
  }
  return {
    render: () => { if (ao) composer.render(); else renderer.render(scene, camera); overlay() },
    setSize: (nw, nh) => { composer.setSize(nw, nh); gtao.setSize(nw * pr, nh * pr) },
    setAO: (on) => { ao = on },
    dispose: () => { composer.dispose(); rt.dispose(); gtao.dispose() },
  }
}

export interface LightRig {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  day: THREE.Texture
  dusk: THREE.Texture
  studio: THREE.Texture
}

/**
 * Sun, sky and exposure for a time of day.  `tod` (0 early morning .. 1 evening) only moves the daytime sun; in the evening
 * design the sun is low and warm, the sky is dusk and the lights of the rooms are switched on (by the caller).
 */
export function applyLighting(r: LightRig, time: Time, tod: number, center: THREE.Vector3, size: number): void {
  const evening = time === 'evening'
  const t = evening ? 0.97 : tod
  const az = Math.PI * (0.1 + 0.8 * t)            // east in the morning, south at noon, west in the evening
  const el = evening ? 0.1 : 0.28 + 0.9 * Math.sin(Math.PI * t)
  const R = size * 2
  r.sun.position.set(center.x + Math.cos(az) * R * Math.cos(el * 0.6), R * Math.sin(Math.min(el, 1.25)), center.z + Math.sin(az) * R * Math.cos(el * 0.6))
  r.sun.target.position.copy(center)
  r.sun.target.updateMatrixWorld()
  const warm = evening ? 1 : 1 - Math.sin(Math.PI * t) // 0 at noon, 1 at the ends
  if (evening) {
    r.sun.color.setRGB(1, 0.74, 0.58)
    r.sun.intensity = 0.14
    r.hemi.intensity = 0.04
    r.scene.environmentIntensity = 0.09
    r.scene.backgroundIntensity = 1.5
    r.renderer.toneMappingExposure = 1.0
  } else {
    r.sun.color.setRGB(1, 0.96 - 0.3 * warm, 0.88 - 0.52 * warm)
    r.sun.intensity = 3.0 - 1.1 * warm
    r.hemi.intensity = 0.2
    r.scene.environmentIntensity = 0.5
    r.scene.backgroundIntensity = 0.85
    r.renderer.toneMappingExposure = 0.9
  }
  r.scene.environment = evening ? r.dusk : r.studio
  r.scene.background = evening ? r.dusk : r.day
  const fog = r.scene.fog as THREE.Fog | null
  if (fog) {
    fog.color.set(evening ? 0x2c2a3e : 0xe8eef3)
    fog.near = size * 3
    fog.far = size * 9
  }
}
