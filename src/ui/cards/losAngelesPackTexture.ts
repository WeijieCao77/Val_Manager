/**
 * The 洛杉矶包's print on the shared foil pouch — Codex's LosAngelesPack (LosAngelesDesign.tsx) painted onto the
 * 1024×1536 film: the sunset art, the city in poster type, the ONE MORE band and the pack line along the foot.
 */
export function paintLosAngelesPack(ctx: CanvasRenderingContext2D, count: number, back: boolean, changed: () => void) {
  const paint = (art?: HTMLImageElement, mark?: HTMLImageElement) => {
    ctx.fillStyle = '#17131e'; ctx.fillRect(0, 0, 1024, 1536)
    if (art) {
      // the sun sits right of centre in the art; the front frames it, the back leans further right
      const sx = back ? 220 : 120
      ctx.drawImage(art, sx, 0, art.width - sx - (back ? 0 : 60), art.height, 0, 70, 1024, 1400)
    }
    const foot = ctx.createLinearGradient(0, 0, 0, 1536)
    foot.addColorStop(0, '#17131e33'); foot.addColorStop(.55, '#17131e00'); foot.addColorStop(.86, '#17131ef0'); foot.addColorStop(1, '#17131e')
    ctx.fillStyle = foot; ctx.fillRect(0, 0, 1024, 1536)
    const side = ctx.createLinearGradient(0, 0, 1024, 0)
    side.addColorStop(0, '#8a5a4a55'); side.addColorStop(.15, '#17131e00'); side.addColorStop(.85, '#17131e00'); side.addColorStop(1, '#8a5a4a55')
    ctx.fillStyle = side; ctx.fillRect(0, 0, 1024, 1536)
    // the heat-sealed crimp, top and bottom
    for (const y of [12, 1462]) {
      ctx.fillStyle = '#7a5a5a'; ctx.fillRect(0, y, 1024, 62)
      for (let x = 0; x < 1024; x += 4) { ctx.fillStyle = x % 8 ? '#65505a' : '#e2b99788'; ctx.fillRect(x, y, 1, 62) }
    }
    ctx.fillStyle = '#fff0d5'
    if (mark) ctx.drawImage(mark, 82, 118, 133, 83)
    ctx.textAlign = 'left'; ctx.font = '500 21px Arial'
    ctx.fillText('WORLD', 240, 152); ctx.fillText('CHAMPIONSHIP', 240, 182)
    ctx.textAlign = 'right'; ctx.font = '35px Arial'; ctx.fillText('2023', 942, 168)
    if (!back) {
      ctx.textAlign = 'left'; ctx.font = '500 31px Arial'
      ctx.save(); ctx.translate(82, 300); ctx.fillText('C H A M P I O N S', 0, 0); ctx.restore()
      ctx.save(); ctx.translate(82, 340); ctx.rotate(-7 * Math.PI / 180)
      ctx.font = '246px Impact, "Arial Narrow", Arial'; ctx.fillStyle = '#fff0d5'; ctx.fillText('LOS', 0, 210)
      ctx.font = '195px Impact, "Arial Narrow", Arial'; ctx.strokeStyle = '#ffe3b8'; ctx.lineWidth = 3; ctx.strokeText('ANGELES', 0, 400)
      ctx.restore()
      // the ONE MORE band
      ctx.save(); ctx.translate(82, 1080); ctx.rotate(-7 * Math.PI / 180)
      ctx.fillStyle = '#f3cf9f'; ctx.fillRect(0, -66, 360, 92)
      ctx.fillStyle = '#241824'; ctx.font = '61px Impact, Arial'; ctx.fillText('ONE MORE ↗', 24, 2)
      ctx.restore()
      ctx.strokeStyle = '#f4ce9555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(82, 1250); ctx.lineTo(942, 1250); ctx.stroke()
      ctx.fillStyle = '#d6b7b6'; ctx.font = '500 21px Arial'; ctx.fillText('SUNSET EDITION / 逐日', 82, 1302)
      ctx.fillStyle = '#fff0d5'; ctx.font = '36px "PingFang SC", sans-serif'; ctx.fillText('洛杉矶全球冠军赛', 82, 1362)
      ctx.textAlign = 'right'; ctx.font = '112px Impact, Arial'; ctx.fillText(String(count), 942, 1352)
      ctx.font = '21px Arial'; ctx.fillText('CARDS', 942, 1392)
    } else {
      ctx.fillStyle = '#17131ed9'; ctx.fillRect(120, 560, 784, 440)
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff0d5'
      ctx.font = '64px Impact, Arial'; ctx.fillText('LOS ANGELES 2023', 512, 680)
      ctx.font = '29px "PingFang SC", sans-serif'; ctx.fillText('洛杉矶冠军赛 · 赛事收藏系列', 512, 756)
      ctx.font = '24px Arial'; ctx.fillText('06—26 AUGUST 2023 · ONE MORE', 512, 820)
      ctx.font = '22px "PingFang SC", sans-serif'; ctx.fillText('本项目自制收藏卡设计', 512, 933)
      // the rear longitudinal weld, printed beneath the physical lighting
      ctx.fillStyle = '#e2b99722'; ctx.fillRect(936, 80, 27, 1370)
      ctx.fillStyle = '#09061155'; ctx.fillRect(962, 80, 5, 1370)
    }
  }
  paint()
  let art: HTMLImageElement | undefined
  let mark: HTMLImageElement | undefined
  const load = (src: string, done: (img: HTMLImageElement) => void) => {
    const img = new Image()
    img.onload = () => { done(img); paint(art, mark); changed() }
    img.src = src
  }
  load('/events/los-angeles-2023/sunset-art.webp', (img) => { art = img })
  load('/events/los-angeles-2023/horizon-mark-v3.svg', (img) => { mark = img })
}
