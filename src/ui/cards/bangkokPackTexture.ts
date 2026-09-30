/** Editable print on the same physical foil pouch as the existing packs. */
export function paintBangkokPack(ctx: CanvasRenderingContext2D, count: number, back: boolean, changed: () => void) {
  const paint = (art?: HTMLImageElement) => {
    ctx.fillStyle = '#20152f'; ctx.fillRect(0, 0, 1024, 1536)
    if (art) ctx.drawImage(art, 0, 80, 1024, 1380)
    const shade = ctx.createLinearGradient(0, 0, 1024, 0)
    shade.addColorStop(0, '#65508066'); shade.addColorStop(.15, '#20152f00'); shade.addColorStop(.85, '#20152f00'); shade.addColorStop(1, '#65508066')
    ctx.fillStyle = shade; ctx.fillRect(0, 0, 1024, 1536)
    ctx.strokeStyle = '#b6a0d866'; ctx.lineWidth = 2; ctx.strokeRect(48, 95, 928, 1338)
    for (const y of [12, 1462]) {
      ctx.fillStyle = '#6c5687'; ctx.fillRect(0, y, 1024, 62)
      for (let x = 0; x < 1024; x += 5) { ctx.fillStyle = '#d2baf177'; ctx.fillRect(x, y, 1, 62) }
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#eee6fa'
    ctx.font = '500 25px Arial'; ctx.fillText('VALORANT CHAMPIONS TOUR / 2025', 512, 156)
    ctx.font = '500 54px Arial'; ctx.fillText('MASTERS', 512, 274)
    ctx.font = '100px Impact, Arial'; ctx.fillText('BANGKOK', 512, 390)
    ctx.font = '500 27px "PingFang SC", sans-serif'; ctx.fillText('曼谷大师赛', 512, 445)
    ctx.textAlign = 'left'; ctx.font = 'bold 59px Arial'
    ctx.fillText('DAWN OF', 100, 1190); ctx.fillText('THE DUELIST', 100, 1247)
    ctx.strokeStyle = '#b6a0d866'; ctx.beginPath(); ctx.moveTo(100, 1290); ctx.lineTo(924, 1290); ctx.stroke()
    ctx.font = '500 26px "PingFang SC", sans-serif'; ctx.fillText(back ? '20 FEB — 02 MAR · THAILAND' : '赛事选手收藏卡', 100, 1360)
    if (!back) { ctx.textAlign = 'right'; ctx.font = 'bold 60px Arial'; ctx.fillText(String(count), 920, 1360); ctx.font = '20px Arial'; ctx.fillText('CARDS', 920, 1395) }
    if (back) {
      ctx.fillStyle = '#20152fd9'; ctx.fillRect(120, 570, 784, 430)
      ctx.textAlign = 'center'; ctx.fillStyle = '#eee6fa'; ctx.font = 'bold 40px Arial'; ctx.fillText('BANGKOK 2025', 512, 680)
      ctx.font = '28px "PingFang SC", sans-serif'; ctx.fillText('曼谷大师赛 · 赛事收藏系列', 512, 754)
      ctx.font = '23px Arial'; ctx.fillText('DAWN OF THE DUELIST', 512, 820)
      ctx.font = '22px "PingFang SC", sans-serif'; ctx.fillText('本项目自制收藏卡设计', 512, 933)
      // Raised-looking rear longitudinal weld is printed beneath the physical lighting.
      ctx.fillStyle = '#baa0dd22'; ctx.fillRect(936, 80, 27, 1370)
      ctx.fillStyle = '#09061155'; ctx.fillRect(962, 80, 5, 1370)
    }
  }
  paint()
  const art = new Image()
  art.onload = () => { paint(art); changed() }
  art.src = '/events/bangkok-2025/lotus-art.webp'
}
