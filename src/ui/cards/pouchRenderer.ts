import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { pouchGeometry } from './pouchGeometry'
import { POSITION_PACKS } from './positionPackDesign'
import type { PackPosition } from './positionPackDesign'
import { COACH_CREST } from './coachCrest'
import type { Card } from '../../engine/cards'

export interface PouchMotion { progress: number; torn: boolean; pose: { x: number; y: number } }
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const easeOut = (value: number) => 1 - Math.pow(1 - clamp01(value), 3)

function printTexture(count: number, kind: Card['kind'], back = false, position?: PackPosition) {
  const coach = kind === 'coach'
  const design = !coach && position ? POSITION_PACKS[position] : undefined
  const canvas = document.createElement('canvas')
  canvas.width = 1024; canvas.height = 1536
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d5cbb8'; ctx.fillRect(0, 0, 1024, 1536)
  ctx.fillStyle = coach ? '#214e42' : design?.band ?? '#b2253a'; ctx.fillRect(0, 1160, 1024, 376)
  ctx.fillStyle = coach || design ? '#a18b55' : '#1c2c39'; ctx.fillRect(0, 1148, 1024, 12)
  // The heat weld is printed into the film and follows the surface normals.
  for (const y of [22, 1480]) {
    ctx.fillStyle = 'rgba(66,52,31,.18)'; ctx.fillRect(20, y, 984, 36)
    for (let x = 24; x < 1000; x += 6) {
      ctx.fillStyle = 'rgba(255,250,229,.45)'; ctx.fillRect(x, y, 2, 36)
      ctx.fillStyle = 'rgba(63,44,25,.15)'; ctx.fillRect(x + 2, y, 1, 36)
    }
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#213340'
  ctx.font = '600 30px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(coach ? 'VAL MANAGER  ·  电竞教练收藏卡' : design ? `VAL MANAGER  ·  ${design.label}位置收藏卡` : 'VAL MANAGER  ·  电竞选手收藏卡', 512, 140)
  ctx.font = '500 22px "PingFang SC", sans-serif'
  ctx.fillStyle = '#6d685c'; ctx.fillText('沿封口向右撕开  →', 512, 204)
  ctx.strokeStyle = 'rgba(73,62,44,.26)'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(20, 230); ctx.lineTo(1004, 230); ctx.stroke()
  if (back) {
    ctx.font = '800 58px sans-serif'; ctx.fillStyle = '#213340'; ctx.fillText('VAL MANAGER', 512, 610)
    ctx.font = '500 27px "PingFang SC", sans-serif'; ctx.fillText(coach ? '胜负之间，自有章法' : design?.footer ?? '为你的首发而来', 512, 678)
  } else {
    // The collection crest is ink on the film, so its lighting bends with the pouch.
    ctx.save(); ctx.translate(332, 355); ctx.scale(3, 3); ctx.fillStyle = '#243647'; ctx.strokeStyle = '#243647'
    if (design) {
      ctx.fillStyle = design.ink
      for (const path of design.paths) ctx.fill(new Path2D(path))
      ctx.restore()
    } else if (coach) {
      ctx.strokeStyle = '#284d42'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      for (const { d, width } of COACH_CREST) { ctx.lineWidth = width; ctx.stroke(new Path2D(d)) }
      ctx.restore()
    } else {
      ctx.fill(new Path2D('M43 33h34v18c0 15-8 23-17 23S43 66 43 51V33Z'))
      ctx.lineWidth = 4
      ctx.stroke(new Path2D('M43 39H32v8c0 10 6 16 16 16m29-24h11v8c0 10-6 16-16 16M60 74v12m-14 5h28'))
      ctx.fillStyle = '#d5cbb8'; ctx.fill(new Path2D('m60 41 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z'))
      ctx.fillStyle = '#243647'; ctx.fill(new Path2D('m60 8 2 5 6 1-4 4 1 5-5-2-5 2 1-5-4-4 6-1Z'))
      const leaf = new Path2D('M20 62C9 60 8 49 11 43c8 3 12 10 9 19Zm0 14C8 75 5 66 7 59c9 1 15 8 13 17Zm6 13C14 93 8 83 8 77c10-2 17 3 18 12Zm10 10c-9 7-19 1-22-5 8-5 17-3 22 5Zm13 5c-5 10-16 9-22 4 5-7 15-9 22-4Z')
      ctx.fill(leaf); ctx.translate(120, 0); ctx.scale(-1, 1); ctx.fill(leaf); ctx.restore()
    }
    ctx.fillStyle = '#1c2c39'; ctx.font = '900 134px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(coach ? '教练包' : design ? `${design.label}包` : '开瓦包', 512, 885)
    ctx.font = '500 33px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = '#625f56'; ctx.fillText(coach ? '每一局，始于你的布局' : design?.tagline ?? '每一张，都是赛场上的故事', 512, 969)
  }
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff0e3'; ctx.font = '600 34px "PingFang SC", sans-serif'
  ctx.fillText(coach ? '组建你的教练组' : design ? `${design.label}专属选手` : '集结你的首发', 110, 1290)
  ctx.font = '600 18px sans-serif'; ctx.fillText(coach ? 'COACH COLLECTION' : design ? `${design.english} COLLECTION` : 'PLAYER COLLECTION', 110, 1400)
  ctx.textAlign = 'right'; ctx.font = '700 76px sans-serif'; ctx.fillText(String(count), 892, 1320)
  ctx.font = '500 22px "PingFang SC", sans-serif'; ctx.fillText('张收藏卡', 892, 1360)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export function createPouchRenderer(canvas: HTMLCanvasElement, count: number, kind: Card['kind'], state: () => PouchMotion, onLost: () => void, position?: PackPosition) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = .93
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 30)
  camera.position.set(0, 0, 6.2)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, .06)
  scene.environment = environment.texture
  room.dispose(); pmrem.dispose()
  scene.add(new THREE.HemisphereLight(0xfff8ed, 0x172536, .65))
  const key = new THREE.DirectionalLight(0xfff4df, 1.7); key.position.set(-3, 4, 5); scene.add(key)
  const rim = new THREE.DirectionalLight(0xd8e7ff, 1.2); rim.position.set(3, 1, -1); scene.add(rim)
  const front = printTexture(count, kind, false, position), back = printTexture(count, kind, true, position)
  const base = { roughness: .4, metalness: .12, clearcoat: .4, clearcoatRoughness: .32, envMapIntensity: .55 }
  const materials = [
    new THREE.MeshPhysicalMaterial({ ...base, map: front }),
    new THREE.MeshPhysicalMaterial({ ...base, map: back }),
    new THREE.MeshPhysicalMaterial({ ...base, color: 0x978e7c, roughness: .5 }),
  ]
  const topMaterials = materials.map(material => material.clone())
  const pouch = new THREE.Group(); scene.add(pouch)
  const body = new THREE.Mesh(pouchGeometry(count, false), materials)
  const cap = new THREE.Mesh(pouchGeometry(count, true), topMaterials)
  pouch.add(body, cap)
  let frame = 0, disposed = false, lost = false, tearStart: number | null = null, last = 0
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const current = { x: state().pose.x * Math.PI / 180, y: state().pose.y * Math.PI / 180 }
  function draw(now: number) {
    frame = 0
    if (disposed || lost) return
    const motion = state()
    const dt = Math.min(50, now - (last || now - 16)); last = now
    const gain = reduced.matches ? 1 : 1 - Math.exp(-dt / 95)
    const tx = motion.pose.x * Math.PI / 180, ty = motion.pose.y * Math.PI / 180
    current.x += (tx - current.x) * gain; current.y += (ty - current.y) * gain
    pouch.rotation.set(current.x, current.y, -.022)
    cap.rotation.z = -motion.progress * .035
    cap.position.x = motion.progress * .02
    if (motion.torn) {
      tearStart ??= now
      const seconds = reduced.matches ? 2 : (now - tearStart) / 1000
      const rip = easeOut(seconds / .65)
      cap.position.set(rip * 1.7, rip * 1.8, rip * .7)
      cap.rotation.set(-rip * .55, rip * .35, -rip * .75)
      const drop = easeOut((seconds - .18) / 1)
      body.position.y = -drop * 1.7
      body.rotation.x = drop * .25
      for (const material of topMaterials) { material.transparent = true; material.opacity = 1 - clamp01((seconds - .3) / .35) }
      for (const material of materials) { material.transparent = true; material.opacity = 1 - clamp01((seconds - .35) / .65) }
    }
    renderer.render(scene, camera)
    const moving = Math.abs(tx - current.x) + Math.abs(ty - current.y) > .0005
    if (moving || (tearStart !== null && now - tearStart < 1400 && !reduced.matches)) invalidate()
    else last = 0
  }
  function invalidate() { if (!frame && !disposed && !lost) frame = requestAnimationFrame(draw) }
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height; camera.updateProjectionMatrix(); invalidate()
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas)
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; onLost() }
  canvas.addEventListener('webglcontextlost', contextLost)
  reduced.addEventListener('change', invalidate)
  resize()
  return {
    invalidate,
    dispose: () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect()
      reduced.removeEventListener('change', invalidate); canvas.removeEventListener('webglcontextlost', contextLost)
      body.geometry.dispose(); cap.geometry.dispose()
      materials.forEach(material => material.dispose()); topMaterials.forEach(material => material.dispose())
      front.dispose(); back.dispose(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss()
    },
  }
}
