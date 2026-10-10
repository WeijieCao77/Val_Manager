const ART = `${import.meta.env.BASE_URL}events/afterglow/ember-art.webp`

/** The 退役选手包 print on the shared foil pouch, 1024 × 1536 UV space (Codex's afterglowPackTexture, cut to this release: no coaches). */
export function paintRetiredPack(ctx: CanvasRenderingContext2D, count: number, back: boolean, changed: () => void) {
  const paint = (art?: HTMLImageElement) => {
    ctx.fillStyle = '#210d18'; ctx.fillRect(0, 0, 1024, 1536)
    if (art) {
      const layer = document.createElement('canvas'); layer.width = 1024; layer.height = 1024
      const surface = layer.getContext('2d')!
      surface.drawImage(art, 0, 0, 1024, 1024)
      surface.globalCompositeOperation = 'destination-in'
      const fade = surface.createRadialGradient(512, 512, 300, 512, 512, 515)
      fade.addColorStop(0, '#000'); fade.addColorStop(1, '#0000')
      surface.fillStyle = fade; surface.fillRect(0, 0, 1024, 1024)
      ctx.save(); ctx.globalCompositeOperation = 'screen'
      ctx.drawImage(layer, 72, back ? 280 : 405, 880, 880); ctx.restore()
    }
    const shade = ctx.createLinearGradient(0, 0, 1024, 0)
    shade.addColorStop(0, '#0007'); shade.addColorStop(.08, '#eccf9322'); shade.addColorStop(.2, '#0000'); shade.addColorStop(.86, '#0000'); shade.addColorStop(1, '#e8c68c33')
    ctx.fillStyle = shade; ctx.fillRect(0, 0, 1024, 1536)
    ctx.strokeStyle = '#d7b67b55'; ctx.lineWidth = 2; ctx.strokeRect(50, 96, 924, 1337)
    for (const y of [12, 1462]) {
      ctx.fillStyle = '#826447'; ctx.fillRect(0, y, 1024, 62)
      for (let x = 0; x < 1024; x += 5) { ctx.fillStyle = '#edcf8c66'; ctx.fillRect(x, y, 1, 62) }
    }
    ctx.fillStyle = '#cfb07e'; ctx.textAlign = 'left'; ctx.font = '26px "PingFang SC", sans-serif'; ctx.fillText('开瓦包', 100, 160)
    ctx.textAlign = 'right'; ctx.fillText('生涯典藏', 924, 160)
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff2da'; ctx.font = '100px Georgia, serif'; ctx.fillText('AFTERGLOW', 512, 307)
    ctx.fillStyle = '#d8b77e'; ctx.font = '52px "Songti SC", serif'; ctx.fillText('余  晖', 512, 393)
    if (back) {
      ctx.fillStyle = '#210d18ed'; ctx.fillRect(100, 1000, 824, 375)
      ctx.fillStyle = '#fff2da'; ctx.font = '38px "Songti SC", serif'; ctx.fillText('离场之后，光仍在。', 512, 1080)
      ctx.fillStyle = '#c8ad85'; ctx.font = '25px "PingFang SC", sans-serif'; ctx.fillText('余晖 · 退役选手生涯珍藏', 512, 1160)
      ctx.font = '23px Arial'; ctx.fillText('THE LIGHT STAYS WITH US', 512, 1220)
      ctx.fillStyle = '#d8b77e18'; ctx.fillRect(940, 82, 28, 1370)
    } else {
      ctx.fillStyle = '#fff2da'; ctx.font = '38px "Songti SC", serif'; ctx.fillText('离场之后，光仍在。', 512, 1240)
      ctx.strokeStyle = '#d8b77e66'; ctx.beginPath(); ctx.moveTo(100, 1290); ctx.lineTo(924, 1290); ctx.stroke()
      ctx.textAlign = 'left'; ctx.fillStyle = '#d8b77e'; ctx.font = '28px "PingFang SC", sans-serif'; ctx.fillText('退役选手收藏卡', 100, 1360)
      ctx.textAlign = 'right'; ctx.font = '50px Georgia'; ctx.fillText(`${count}`, 830, 1360); ctx.font = '25px "PingFang SC", sans-serif'; ctx.fillText('张 / 包', 924, 1360)
    }
  }
  paint()
  const image = new Image()
  image.onload = () => { paint(image); changed() }
  image.src = ART
}
