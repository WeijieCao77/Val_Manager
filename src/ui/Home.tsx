/** Game directory. Game bundles remain lazy until a visitor opens a game. */
import { lazy, Suspense, useEffect, useState } from 'react'
import { readCareerPreview } from '../engine/savePreview'
import { homeCrestUrl, HOME_COUNTS } from '../engine/homeClubs'
import { ENDING_COUNT } from '../engine/endings'
import { ACHIEVEMENT_COUNT } from '../engine/achievements'
import { readProfile, siteId, syncProfile, type Profile } from '../engine/profile'
import type { Region } from '../engine/types'
import { maskId } from '../engine/cardid'
import Support from './Support'
import { track } from '../engine/telemetry'
import Changelog from './Changelog'
import WeChat from './WeChat'
import ThemeToggle from './ThemeToggle'
import './Home.css'
import HomeFeaturedCards from './HomeFeaturedCards'

/**
 * The account panel is loaded when it is opened, not when the page is.
 *
 * It is the front page's one link into the card game's account module, which
 * reaches gacha, the arena and the daily challenge, and through the challenge
 * the world's 524 players — 370 KB of rosters downloaded before anybody has
 * chosen a game, in order to draw a chip that says 「创建账号」. Lazy, it costs
 * nothing until somebody taps it.
 */
const Account = lazy(() => import('./Account'))

type Mode = 'home' | 'career' | 'cards'

/**
 * The four leagues, and one player from each.
 *
 * The strip is the VCT league marks themselves — not a club standing in for a
 * league. Putting a club there said "here are four teams" and, worse, put
 * EDward Gaming's badge in the place that belongs to VCT CN.
 *
 * scripts/fetch_league_logos.py writes public/leagues/<Region>.webp. VCT EMEA
 * ships as solid black, which is invisible on this page, so that one is
 * repainted light at build time — which is how the mark is used on dark
 * grounds anyway.
 */
const REGION_FACES: { region: Region; face: string }[] = [
  // aspas — the most recognisable player in the game
  { region: 'Americas', face: 'P16' },
  { region: 'EMEA', face: 'P67' },        // Derke
  { region: 'Pacific', face: 'P134' },    // Jinggg
  { region: 'China', face: 'P200' },      // ZmjjKK
]

interface Resume {
  club: string | null
  clubId: string | null
  year: number
  over: boolean
}

export default function Home({ onOpen }: { onOpen: (m: Mode) => void }) {
  const [resume, setResume] = useState<Resume | null>(null)
  const [profile, setProfile] = useState<Profile>(() => readProfile())
  // The id itself lives in Account.tsx now — this only needs to know whether
  // there is one, and to hear about it when that changes.
  const [id, setId] = useState<string | null>(() => siteId())
  const [acct, setAcct] = useState(false)


  // Reading the autosave means parsing a whole world, so it happens after the
  // page has painted rather than before it.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setResume(readCareerPreview())
      } catch { /* a save this page cannot read is the career screen's problem */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // Pull anything unlocked on another device. Union only — see engine/profile.ts.
  useEffect(() => {
    let alive = true
    void syncProfile().then((p) => { if (alive) setProfile(p) })
    return () => { alive = false }
  }, [])


  const endings = profile.endings.length
  const badges = profile.achievements.length

  return (
    <div className="game-portal">
      <header className="portal-bar">
        <a className="portal-brand" href="/" aria-label="猪之家游戏首页"><svg className="portal-brand-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path d="M9 15C5 12 5 6 7 4c4 0 8 3 10 7m14 4c4-3 4-9 2-11-4 0-8 3-10 7" fill="#f49cac" stroke="#e9899d" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="m8 7 2 7 4-3Zm24 0-2 7-4-3Z" fill="#d86a86" />
          <path d="M35 23c0 9-6 13-15 13S5 32 5 23C5 14 11 9 20 9s15 5 15 14Z" fill="#ffc2ca" />
          <ellipse cx="10.5" cy="25" rx="3" ry="2" fill="#ef94a7" />
          <ellipse cx="29.5" cy="25" rx="3" ry="2" fill="#ef94a7" />
          <ellipse cx="13.5" cy="20" rx="1.6" ry="2.1" fill="#462c37" />
          <ellipse cx="26.5" cy="20" rx="1.6" ry="2.1" fill="#462c37" />
          <ellipse cx="20" cy="27" rx="8" ry="5.5" fill="#f296aa" />
          <ellipse cx="17" cy="27" rx="1.4" ry="2" fill="#9f4f68" />
          <ellipse cx="23" cy="27" rx="1.4" ry="2" fill="#9f4f68" />
        </svg><b>猪之家<span>游戏</span></b></a>
        <span className="portal-domain">vctgames.com</span>
        <div className="portal-account">
          <ThemeToggle compact />
          <button className="portal-id" onClick={() => setAcct(true)} title={id ? '查看或切换游戏 ID' : '创建游戏 ID'}>
            {id ? maskId(id) : '创建账号'}<span aria-hidden="true"> ↗</span>
          </button>
        </div>
      </header>

      <main className="portal-main">
        <section className="portal-intro">
          <div><p className="portal-kicker">猪之家 · 电竞游戏馆</p><h1>热爱不止观赛。<br className="portal-mobile-break" />上场，写你的故事。</h1></div>
          <p className="portal-intro-note">从幕后执教，到聚光灯下。<br />选一个游戏，开启你的电竞人生。</p>
        </section>
        <nav className="portal-jump" aria-label="游戏分类"><a href="#valorant-games">无畏契约 <span>03</span></a><a href="#league-games">英雄联盟 <span>02</span></a><span>全部免费 · 浏览器即玩</span></nav>

        <div className="portal-columns">
          <section className="portal-world portal-valorant" id="valorant-games" aria-labelledby="valorant-title">
            <header className="portal-world-head">
              <div><span className="portal-world-en">Valorant</span><h2 id="valorant-title">无畏契约</h2><p>从第一回合，到世界之巅。</p></div>
              <svg className="portal-world-symbol" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M12 25v28l32 34h25L12 25Zm76 0L57 59h24l7-8V25Z" fill="currentColor" /></svg>
            </header>
            <div className="portal-world-content">
              <article className="portal-game portal-feature portal-cards-feature">
                <HomeFeaturedCards />
                <div className="portal-game-body">
                  <div className="portal-game-meta"><span>收集 / 阵容对战</span><span className="portal-popular">热门游戏</span></div>
                  <h3>开瓦包</h3>
                  <p>把喜欢的选手收入收藏，组出你的梦幻五人首发。从第一包惊喜，到天梯与杯赛的冠军。</p>
                  <div className="portal-details">真实选手卡<span />赛事纪念卡<span />天梯与杯赛</div>
                  <div className="portal-game-action">
                    <button className="portal-play" onClick={() => { track('home_go', { go: 'cards' }); onOpen('cards') }}>进入卡池<span aria-hidden="true">↗</span></button>
                    <span className="portal-feature-note">免费游玩 · 测试版</span>
                  </div>
                </div>
              </article>
              <article className="portal-game portal-compact portal-manager-compact">
                <div className="portal-manager-mini" aria-hidden="true"><strong>VCT</strong><span>电竞经理</span><div>{REGION_FACES.map(r => <img key={r.region} src={`${import.meta.env.BASE_URL}leagues/${r.region}.webp`} alt="" width={24} height={24} />)}</div></div>
                <div className="portal-game-body"><div className="portal-game-meta"><span>战队经营 / 策略模拟</span><span className="portal-status">可游玩</span></div><h3>VCT 电竞经理</h3><p>接手一支真实战队，签约、训练、排兵布阵。从 2026 出发，把你的名字写进冠军史。</p><div className="portal-details">{HOME_COUNTS.teams} 支战队<span />{HOME_COUNTS.players} 名真实选手<span />{ENDING_COUNT} 种结局</div>
                  <div className="portal-game-action"><button className="portal-play" onClick={() => { track('home_go', { go: 'career' }); onOpen('career') }}>{resume ? (resume.over ? '查看结果' : '继续上次存档') : '开始执教'}<span aria-hidden="true">↗</span></button>{resume && <span className="portal-resume">{homeCrestUrl(resume.clubId) && <img src={homeCrestUrl(resume.clubId)!} alt="" width={16} height={16} />}{resume.club} · {resume.year}</span>}</div>
                </div>
              </article>
              <article className="portal-game portal-banner">
                <div className="portal-compact-art"><img src={`${import.meta.env.BASE_URL}promo/player.webp`} alt="" loading="lazy" /></div>
                <div className="portal-game-body"><div className="portal-game-meta"><span>选手生涯模拟</span><span>测试版</span></div><h3>无畏契约选手生涯</h3><p>从天梯路人，打到冠军赛的舞台。这一次，你就是主角。</p><a className="portal-text-link" href="/player/" onClick={() => track('home_go', { go: 'player' })}>开始生涯 <span aria-hidden="true">↗</span></a></div>
              </article>
              <a className="portal-event" href="/champions"><span className="portal-event-icon" aria-hidden="true">✦</span><div><b>上海全球冠军赛</b><span>查看赛程，为你支持的选手留言</span></div><span aria-hidden="true">↗</span></a>
            </div>
          </section>

          <section className="portal-world portal-league" id="league-games" aria-labelledby="league-title">
            <header className="portal-world-head"><div><span className="portal-world-en">League of Legends</span><h2 id="league-title">英雄联盟</h2><p>下一段传奇，由你书写。</p></div><svg className="portal-world-symbol" viewBox="0 0 100 100" fill="none" aria-hidden="true"><circle cx="50" cy="50" r="36" stroke="currentColor" strokeWidth="2"/><path d="M36 20h15v53h25l-5 10H36V20Z" fill="currentColor"/><path d="m50 5 45 45-45 45L5 50 45 10" stroke="currentColor" opacity=".35"/></svg></header>
            <div className="portal-world-content">
              <article className="portal-game portal-feature"><div className="portal-cover"><img src={`${import.meta.env.BASE_URL}promo/poxiao.webp`} alt="破晓，电竞选手生涯模拟" /></div><div className="portal-game-body"><div className="portal-game-meta"><span>选手生涯 / 角色扮演</span><span className="portal-status">可游玩</span></div><h3>破晓</h3><p>从 S12 到 S16，五年职业生涯。走上赛场，去挑战那个王朝，成为被记住的选手。</p><div className="portal-details">五年职业生涯<span />你的冠军之路</div><div className="portal-game-action"><a className="portal-play" href="https://www.poxiao.lol" target="_blank" rel="noopener noreferrer" onClick={() => track('home_go', { go: 'poxiao' })}>开启职业生涯<span aria-hidden="true">↗</span><span className="sr-only">（在新标签页打开）</span></a></div></div></article>
              <article className="portal-game portal-lulu"><div className="portal-lulu-art"><img src={`${import.meta.env.BASE_URL}promo/lulu.webp`} alt="" loading="lazy" /></div><div className="portal-game-body"><div className="portal-game-meta"><span>选手卡牌 / 收集对战</span></div><h3>噜噜卡</h3><p>收集 LPL、LCK 等赛区选手与名人堂彩卡。组建五人阵容，打天梯、战杯赛、自由交易。</p><a className="portal-text-link" href="https://lulucard-production.up.railway.app/" onClick={() => track('home_go', { go: 'lulu' })}>去噜噜卡 <span aria-hidden="true">↗</span></a></div></article>
              <p className="portal-world-note">两款游戏使用各自的账号与存档。</p>
            </div>
          </section>
        </div>

        <section className="portal-record" aria-labelledby="portal-record-title"><div className="portal-record-heading"><h2 id="portal-record-title">我的执教足迹</h2><p>VCT 电竞经理 · 随 ID 跨存档累计</p></div><dl><div><dt>已解锁结局</dt><dd>{endings}<span> / {ENDING_COUNT}</span></dd></div><div><dt>已达成成就</dt><dd>{badges}<span> / {ACHIEVEMENT_COUNT}</span></dd></div><div><dt>执教生涯</dt><dd>{profile.record.careers}<span> 段</span></dd></div><div><dt>累计冠军</dt><dd>{profile.record.titles}<span> 座</span></dd></div></dl><p className="portal-record-note">电竞经理与开瓦包共用 ID。换设备可用 ID 找回；ID 相当于密码，请勿分享。</p></section>
      </main>
      <footer className="portal-footer"><span>猪之家出品 <span className="portal-footer-divider">/</span> 为热爱，做点好玩的。</span><span>小红书 / 抖音 @点点点点点点点点 · @Greenle4f</span></footer>

      {acct && (
        <Suspense fallback={null}>
          <Account
            onClose={() => setAcct(false)}
            onChange={(next) => { setId(next); setProfile(readProfile(next)) }}
          />
        </Suspense>
      )}
      <WeChat />
      <Changelog />
      <Support />
    </div>
  )
}
