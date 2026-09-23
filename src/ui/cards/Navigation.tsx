import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './useDialogFocus'

export const CARD_PAGES = [
  { key: 'packs', label: '抽卡', group: '卡牌', description: '领取每日奖励，开启你的下一张收藏。', icon: 'pack' },
  { key: 'collection', label: '收藏', group: '卡牌', description: '寻找选手、收集系列，管理重复卡。', icon: 'cards' },
  { key: 'squad', label: '卡组', group: '卡牌', description: '安排五人阵容，让选手之间产生默契。', icon: 'squad' },
  { key: 'market', label: '交易', group: '卡牌', description: '寻找心仪卡牌，查看交易与市场行情。', icon: 'market' },
  { key: 'challenge', label: '挑战', group: '赛事', description: '挑战职业战队，赢取阵容成长奖励。', icon: 'target' },
  { key: 'ladder', label: '天梯', group: '赛事', description: '检验你的阵容，向更高段位进发。', icon: 'rank' },
  { key: 'cup', label: '杯赛', group: '赛事', description: '报名赛事，带领你的卡组争夺冠军。', icon: 'cup' },
  { key: 'seoul', label: '首尔征途', group: '赛事', description: '重走首尔 2024 冠军赛的晋级之路。', icon: 'route' },
  { key: 'minigames', label: '小游戏', group: '发现', description: '来一场小挑战，赢取位置奖励包。', icon: 'game', beta: true },
  { key: 'predict', label: '预测', group: '发现', description: '做出你的赛事预测，关注比赛进展。', icon: 'target', beta: true },
  { key: 'friends', label: '好友', group: '发现', description: '找到好友，交流阵容与比赛。', icon: 'friends' },
  { key: 'dossier', label: '资料库', group: '发现', description: '查阅职业选手与战队资料。', icon: 'book' },
  { key: 'account', label: '账号', group: '发现', description: '管理账号、保存 ID，查看你的游戏记录。', icon: 'user' },
] as const

const paths: Record<string, string> = {
  pack: 'M5 3h14v18H5z M5 7h14 M5 17h14 M9 11l3-2 3 2-3 3z',
  cards: 'M8 5h12v16H8z M4 17V2h12 M12 10h4 M12 14h4',
  squad: 'M4 4h6v7H4z M14 4h6v7h-6z M9 15h6v6H9z M7 11v3h10v-3 M12 14v1',
  market: 'M3 8h18l-2-5H5z M5 8v13h14V8 M9 21v-7h6v7',
  target: 'M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l9-9 M16 3h5v5',
  rank: 'M4 20V13h4v7 M10 20V8h4v12 M16 20V3h4v17',
  cup: 'M8 3h8v7a4 4 0 0 1-8 0z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 14v5 M8 21h8',
  route: 'M5 4h14v5H5z M5 15h14v5H5z M12 9v6',
  game: 'M7 7h10l4 11-3 2-4-4h-4l-4 4-3-2z M6 11h5 M8.5 8.5v5 M16 11h1 M18 14h1',
  friends: 'M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M3 21v-6a6 6 0 0 1 12 0v6 M17 4a3 3 0 0 1 0 6 M18 13a4 4 0 0 1 3 4v4',
  book: 'M12 5Q7 2 3 4v16q4-2 9 1 5-3 9-1V4q-4-2-9 1v16',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2',
  more: 'M4 4h5v5H4z M15 4h5v5h-5z M4 15h5v5H4z M15 15h5v5h-5z',
}
export function NavIcon({ name }: { name: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.pack} /></svg>
}
const primary = ['packs', 'collection', 'squad', 'ladder']
export const cardPageFromHash = () => CARD_PAGES.find(p => `#${p.key}` === window.location.hash)?.key ?? 'packs'

export default function CardNavigation({ current, onNavigate, onExit }: { current: string; onNavigate: (key: string) => void; onExit: () => void }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (typeof node.showModal === 'function') {
      if (open) node.showModal()
      else if (node.open) node.close()
    } else {
      node.setAttribute('data-fallback', '')
      if (open) node.setAttribute('open', '')
      else node.removeAttribute('open')
    }
  }, [open])
  const sheetRef = useDialogFocus(() => setOpen(false), open)
  useEffect(() => { setOpen(false) }, [current])
  const link = (p: typeof CARD_PAGES[number]) => <a key={p.key} href={`#${p.key}`} className={`cm-nav-link${current === p.key ? ' active' : ''}`} aria-current={current === p.key ? 'page' : undefined}
    onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onNavigate(p.key); setOpen(false) }}>
    <NavIcon name={p.icon} /><span>{p.label}</span>{'beta' in p && <small>测试</small>}
  </a>
  const groups = () => ['卡牌', '赛事', '发现'].map(group => <section className="cm-nav-group" key={group}><h2>{group}</h2>{CARD_PAGES.filter(p => p.group === group).map(link)}</section>)
  return <>
    <nav className="cm-rail" aria-label="开瓦包导航">{groups()}<button className="cm-rail-home ghost" onClick={onExit}>返回游戏首页</button><div className="cm-rail-note">真实选手 · 自由组队<br />你的 VCT 卡牌收藏</div></nav>
    <nav className="cm-dock" aria-label="常用导航">{primary.map(key => link(CARD_PAGES.find(p => p.key === key)!))}
      <button className={`cm-nav-link${!primary.includes(current) ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><NavIcon name="more" /><span>更多</span></button>
    </nav>
    <dialog className="cm-nav-dialog" ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={e => { if (e.target === e.currentTarget) setOpen(false) }} aria-labelledby="cm-nav-title">
      <div className="cm-nav-sheet" ref={sheetRef} tabIndex={-1}><header><h2 id="cm-nav-title">全部玩法</h2><button className="ghost" onClick={() => setOpen(false)} aria-label="关闭全部玩法">关闭 ×</button></header><nav aria-label="全部玩法">{groups()}</nav><button className="cm-exit ghost" onClick={onExit}>返回游戏首页</button></div>
    </dialog>
  </>
}
