/** The same black/gold print as the shelf artwork, on the existing physical pouch. */
export function paintSeoulPack(ctx: CanvasRenderingContext2D, count: number, back: boolean, changed: () => void) {
  const w = 1024, h = 1536
  ctx.fillStyle = '#0c1018'; ctx.fillRect(0, 0, w, h)
  const glow = ctx.createRadialGradient(760, 280, 10, 650, 350, 900)
  glow.addColorStop(0, '#364773'); glow.addColorStop(.5, '#192033'); glow.addColorStop(1, '#0a0d14')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#c7b477'; ctx.lineWidth = 2; ctx.strokeRect(40, 86, 944, 1360)
  ctx.save(); ctx.translate(512, 570); ctx.strokeStyle = '#c7b47738'
  for (let i = 0; i < 40; i++) {
    const a = i * Math.PI / 20
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 155, Math.sin(a) * 155); ctx.lineTo(Math.cos(a) * 1000, Math.sin(a) * 1000); ctx.stroke()
  }
  ctx.restore()
  for (const y of [15, 1462]) {
    ctx.fillStyle = '#82754e'; ctx.fillRect(0, y, w, 60)
    for (let x = 0; x < w; x += 6) { ctx.fillStyle = '#d3bf8060'; ctx.fillRect(x, y, 2, 60) }
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#c7b477'
  ctx.font = '500 28px sans-serif'; ctx.fillText('CHAMPIONS TOUR / 2024', 512, 162)
  ctx.font = '500 22px sans-serif'; ctx.fillText('沿封口向右撕开 →', 512, 221)
  ctx.font = '500 61px sans-serif'; ctx.fillText('CHAMPIONS', 512, 856)
  ctx.fillStyle = '#f2e7ca'; ctx.font = '900 170px Impact, sans-serif'; ctx.fillText('SEOUL', 512, 1029)
  ctx.fillStyle = '#c7b477'; ctx.font = '500 34px "PingFang SC", sans-serif'; ctx.fillText(back ? '16 支战队 · 80 位登场选手' : '首尔全球冠军赛', 512, 1120)
  ctx.textAlign = 'left'; ctx.font = 'italic 50px Impact, sans-serif'; ctx.fillText('SUPERNOVA', 110, 1325)
  ctx.font = '500 23px sans-serif'; ctx.fillText(back ? '01—25 AUGUST · KOREA' : '赛事选手收藏卡', 110, 1380)
  ctx.textAlign = 'right'; ctx.font = '700 80px sans-serif'; ctx.fillText(String(count), 907, 1328)
  ctx.font = '500 23px sans-serif'; ctx.fillText('CARDS', 907, 1370)
  const mark = new Image()
  mark.onload = () => { ctx.drawImage(mark, 337, 345, 350, 350); changed() }
  mark.src = '/events/seoul-2024/champions.png'
}
