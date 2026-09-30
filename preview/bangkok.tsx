import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BangkokCard, BangkokCardBack, type BangkokRarity, type BangkokPlayer } from '../src/ui/cards/BangkokDesign'
import BangkokPackDisplay from '../src/ui/cards/BangkokPackDisplay'
import './bangkok.css'

const chichoo: BangkokPlayer = { ign: 'CHICHOO', team: 'EDG', nation: 'CN', number: 'BKK / SAMPLE 01', photo: '/faces/l-chichoo-bangkok-2025.webp', photoPosition: '50% 27%' }
const meteor: BangkokPlayer = { ign: 'Meteor', team: 'T1', nation: 'KR', number: 'BKK / SAMPLE 02', photo: '/faces/l-meteor-bangkok-2025.webp', photoPosition: '70% 25%', photoOffsetX: -15 }
function Preview() {
  const [rarity, setRarity] = useState<BangkokRarity>('gold')
  const [blank, setBlank] = useState(false)
  const [back, setBack] = useState(false)
  const [photo, setPhoto] = useState('')
  const [position, setPosition] = useState(30)
  const [error, setError] = useState('')
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo) }, [photo])
  return <main className="bk-preview">
    <nav><a href="#collection">无畏契约 · 赛事收藏</a><span>曼谷 2025 / 设计样张</span></nav>
    <header className="bk-intro"><div><p>2025 曼谷大师赛</p><h1>破晓，莲花绽放。</h1></div><div className="bk-intro-note">Dawn of the Duelist<br /><span>虹彩晶体与深紫覆膜，献给曼谷的决斗时刻。</span></div></header>
    <section className="bk-showcase" id="collection" aria-label="系列卡包、选手卡面和卡背总览">
      <figure className="bk-pack-figure"><BangkokPackDisplay /><figcaption>赛事卡包 <span>立体铝箔 / 可转动查看</span></figcaption></figure>
      <figure><div data-export="chichoo">{back ? <BangkokCardBack /> : <BangkokCard player={{ ...chichoo, ...(photo ? { photo, photoPosition: `50% ${position}%` } : {}) }} rarity={rarity} blank={blank} />}</div><figcaption>CHICHOO <span>EDG / 照片排版样张</span></figcaption></figure>
      <figure><div data-export="meteor">{back ? <BangkokCardBack /> : <BangkokCard player={meteor} rarity={rarity} blank={blank} />}</div><figcaption>Meteor <span>T1 / 照片排版样张</span></figcaption></figure>
      <figure><div data-export="back"><BangkokCardBack /></div><figcaption>统一卡背 <span>晶体莲花 / 赛事铭文</span></figcaption></figure>
    </section>
    <section className="bk-workbench" aria-label="卡面编辑预览"><div><h2>同一届赛事，同一种光泽。</h2><p>切换稀有度、翻面，或放入自己的选手照片。</p></div><div className="bk-controls"><div className="bk-tier" aria-label="卡面稀有度">{(['gold','silver','bronze'] as const).map((r,i) => <button key={r} aria-pressed={rarity === r} onClick={() => setRarity(r)}>{['金卡','银卡','铜卡'][i]}</button>)}</div><button aria-pressed={blank} onClick={() => setBlank(!blank)}>照片留空</button><button aria-pressed={back} onClick={() => setBack(!back)}>翻看卡背</button><label className="bk-upload">替换 CHICHOO 照片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; if (!f) return; if (!['image/png','image/jpeg','image/webp'].includes(f.type) || f.size > 15 * 1024 * 1024) { setError('请选择小于 15 MB 的 JPG、PNG 或 WebP 图片。'); return }; setError(''); setPhoto(URL.createObjectURL(f)); setBlank(false); setBack(false) }} /></label>{photo && <><label className="bk-position">照片位置<input aria-label="照片垂直位置" type="range" min="0" max="100" value={position} onChange={e => setPosition(Number(e.target.value))} /></label><button onClick={() => setPhoto('')}>恢复样片</button></>}</div>{error && <p role="alert">{error}</p>}</section>
    <section className="bk-templates"><div className="bk-template-text"><h2>为完整系列<br />预留下一位选手。</h2><p>照片、姓名、战队、卡号和数值均为独立图层。金、银、铜保留一致的赛事主视觉，用边框与铭牌区分。</p><p>当前数值留空，卡号为样张编号。照片仅作排版展示，替换时无需重做卡面。</p></div>{(['gold','silver','bronze'] as const).map((r,i) => <figure key={r}><div data-export={`template-${r}`}><BangkokCard player={{ ign: 'PLAYER', team: 'TEAM', nation: '—', number: 'BKK / —' }} rarity={r} blank /></div><figcaption>{['金卡模板','银卡模板','铜卡模板'][i]}</figcaption></figure>)}</section>
    <footer className="bk-sources"><p>本项目自制赛事收藏卡设计 · 本地预览</p><p>视觉参考：<a href="https://valorantesports.com/en-US/news/masters-bangkok-eyntk-2025">Riot 官方赛事视觉</a>、<a href="https://valorantesports.com/en-US/news/masters-bangkok-merch-collection">Dawn of the Duelist / Lotus 系列</a>。莲花底图为生成式原创素材。</p><p>样片沿用项目现有照片：CHICHOO 原始出处待补；Meteor 为 2025 冠军赛照片，并非曼谷当届照片。样张稀有度不代表最终能力分级。卡包暂沿用首尔系列的 3 张展示规格。</p></footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
