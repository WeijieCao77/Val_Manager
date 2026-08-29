/**
 * The front page: two games, one account.
 *
 * Everything here is read-only and cheap. Neither game's bundle is loaded
 * until a card is clicked — this page exists partly so that a visitor who is
 * only looking downloads a page rather than a simulation.
 *
 * The career used to live at `/`, so most of the people who open this already
 * have a save. That is why the manager card leads with 「继续上次存档」 and the
 * club it belongs to: a returning player should recognise their own game from
 * the front page, not wonder where it went.
 */
import { useEffect, useState } from 'react'
import { hasAutosave, loadAutosave } from '../engine/save'
import { ENDING_COUNT } from '../engine/endings'
import { ACHIEVEMENT_COUNT } from '../engine/achievements'
import { readProfile, siteId, syncProfile, type Profile } from '../engine/profile'
import { REGION_CN } from '../engine/types'
import type { Region } from '../engine/types'
import { Crest } from './common'
import Account, { maskId } from './Account'
import Support from './Support'
import { track } from '../engine/telemetry'
import Changelog from './Changelog'

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
    if (!hasAutosave()) return
    const t = setTimeout(() => {
      try {
        const g = loadAutosave()
        if (g) {
          setResume({
            club: g.teams[g.myTeam]?.name ?? null,
            clubId: g.myTeam,
            year: g.year,
            over: !!g.gameOver,
          })
        }
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
    <div className="home">
      <header className="home-bar">
        <div className="home-mark">
          猪之家<span>游戏</span>
        </div>
        <div className="spacer" />
        <button
          className="home-id"
          onClick={() => setAcct(true)}
          title={id ? '账号设置——查看、复制或换一个 ID' : '创建一个 ID，成就和结局才能跨设备保存'}
        >
          <span className="k">ID</span>
          <b className="mono">{id ? maskId(id) : '创建账号'}</b>
        </button>
      </header>

      <section className="home-hero">
        <h1>两个无畏契约小游戏</h1>
        <p>
          全部免费，打开就能玩，不用注册。
          {id
            ? ' 两边共用同一个 ID，成就、结局和收藏都记在它上面。'
            : ' 两边共用同一个 ID，第一次进入时会自动给你一串。'}
        </p>
      </section>

      <div className="home-cards">
        {/* ---------------------------------------------------------- 经理 */}
        <article className="home-card">
          <div className="home-art crests">
            {REGION_FACES.map((r) => (
              <div key={r.region} className="home-region">
                <img
                  src={`${import.meta.env.BASE_URL}leagues/${r.region}.webp`}
                  alt=""
                  loading="lazy"
                />
                <span>{REGION_CN[r.region]}</span>
              </div>
            ))}
          </div>
          <div className="home-body">
            <h2>VCT电竞经理</h2>
            <p className="lede">无畏契约电竞经理模拟</p>
            <p className="blurb">
              接手一支真实存在的战队，从 2026 打到 2036。
              签人、训练、排兵、BP、谈赞助，十年任期结束时按你留下的东西给一个结局。
              518 名选手和 64 名教练全部是真实存在的人，没有一个是程序生成的。
            </p>
            <ul className="home-facts">
              <li><b>78</b> 支战队 · 四大赛区与次级联赛</li>
              <li><b>{ENDING_COUNT}</b> 种结局 · <b>{ACHIEVEMENT_COUNT}</b> 项成就</li>
            </ul>
            <div className="home-go">
              <button className="primary" onClick={() => { track('home_go', { go: 'career' }); onOpen('career') }}>
                {resume ? (resume.over ? '查看结果' : '继续上次存档') : '开始执教'}
              </button>
              {resume && (
                <span className="home-resume">
                  {resume.clubId && <Crest id={resume.clubId} size={16} />}
                  {resume.club} · {resume.year} 年
                </span>
              )}
            </div>
          </div>
        </article>

        {/* ---------------------------------------------------------- 抽卡 */}
        <article className="home-card">
          {/* one player from each region, for the same reason the crests are:
              the collection is not a single league's */}
          <div className="home-art faces">
            {REGION_FACES.map((r) => (
              <img
                key={r.face}
                src={`${import.meta.env.BASE_URL}faces/${r.face}.webp`}
                alt=""
                loading="lazy"
              />
            ))}
          </div>
          <div className="home-body">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>开瓦包</h2>
              <span className="tag beta">Beta</span>
            </div>
            <p className="lede">选手卡收集与对战</p>
            <p className="blurb">
              开包抽选手卡，凑一套五人首发去打天梯。
              每天有体力和任务，签到连着算。卡面用的是选手本人的照片。
            </p>
            <ul className="home-facts">
              <li>每日签到 · 体力恢复</li>
              <li>天梯段位 · 杯赛</li>
            </ul>
            <div className="home-go">
              <button
                className="primary"
                onClick={() => { track('home_go', { go: 'cards' }); onOpen('cards') }}
              >进入卡池</button>
            </div>
          </div>
        </article>
      </div>

      {/* --------------------------------------------------------- 账号一览 */}
      <section className="home-strip">
        <div className="home-stat">
          <span className="k">结局</span>
          <span className="v">{endings}<em>/{ENDING_COUNT}</em></span>
        </div>
        <div className="home-stat">
          <span className="k">成就</span>
          <span className="v">{badges}<em>/{ACHIEVEMENT_COUNT}</em></span>
        </div>
        <div className="home-stat">
          <span className="k">执教生涯</span>
          <span className="v">{profile.record.careers}<em> 段</em></span>
        </div>
        <div className="home-stat">
          <span className="k">累计冠军</span>
          <span className="v">{profile.record.titles}<em> 座</em></span>
        </div>
        <p className="tiny faint home-note">
          这些记在你的 ID 上，跨存档累计——被解雇不会清零。
          换设备时把 ID 填进任意一个游戏就能找回；
          <b>这串 ID 相当于账号密码，不要发给别人</b>。
        </p>
      </section>

      <footer className="home-foot">
        <span>猪之家出品 · 小红书/抖音 @点点点点点点点点</span>
        <span className="faint">游戏全部免费</span>
      </footer>

      {acct && (
        <Account
          onClose={() => setAcct(false)}
          onChange={(next) => { setId(next); setProfile(readProfile(next)) }}
        />
      )}
      <Changelog />
      <Support />
    </div>
  )
}
