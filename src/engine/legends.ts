/**
 * The彩卡 tier: twenty moments, each belonging to one real person.
 *
 * A legend is not a better version of a card — it is a specific night. ZmjjKK
 * at Champions 2024 in Seoul is not "ZmjjKK, improved"; it is the man who put
 * 111 kills into a five-map final and took China's first world title. So each
 * one carries the club he played it for rather than the club he is at now,
 * which is also what makes them worth collecting: a 2023 FNATIC Derke and a
 * 2023 FNATIC Alfajer are team-mates on the chemistry graph, twenty-six months
 * after they actually were.
 *
 * Rarity and power are deliberately NOT the same axis. Most of these sit above
 * the gold ceiling, but zeek and Boaster do not — a world championship won by
 * an unremarkable statistical season is still a world championship, and a tier
 * where the rarest card is always the strongest would make the rest of the
 * collection pointless.
 *
 * Everything below is a real result, checked against at least one source that
 * is not vlr.gg — see README for the list. Riot only began awarding an
 * official "Finals MVP" from 2024; the 2021-2023 Masters awards were the
 * community's (vlr.gg's and THESPIKE's), and are marked `mvp` rather than
 * `fmvp` so the game can be honest about the difference.
 */

export type LegendKind =
  /** Riot's own Finals MVP, or the Champions MVP award */
  | 'fmvp'
  /** the community's MVP for an event Riot gave no award at */
  | 'mvp'
  /** no MVP trophy, but a career the sport is organised around */
  | 'icon'

export interface Legend {
  id: string
  /** the ign in world.json this card is a version of */
  ign: string
  /** what the card is called */
  title: string
  /** the two or three words that fit across a card face */
  short: string
  year: number
  kind: LegendKind
  /**
   * The club he did it for. A world.json team id where the club still exists,
   * or an `H:` id for one that does not — chemistry only ever compares these
   * for equality, so a folded club links its own legends and nobody else.
   */
  clubId: string
  clubTag: string
  rating: number
  /** one line, shown on the card's detail panel */
  note: string
}

export const LEGENDS: Legend[] = [
  // ---------------------------------------------------------------- 官方 FMVP
  {
    id: 'L:zeek-champions-2021',
    ign: 'zeek', title: '2021 柏林冠军赛 FMVP', short: '21 柏林 FMVP',
    year: 2021, kind: 'fmvp', clubId: 'H:acend', clubTag: 'ACEND',
    // 65 today, and 90 would be a lie about a man whose case is the trophy
    rating: 88,
    note: 'Acend 3–2 Gambit，VALORANT 史上第一座世界冠军。',
  },
  {
    id: 'L:aspas-champions-2022',
    ign: 'aspas', title: '2022 伊斯坦布尔冠军赛 FMVP', short: '22 伊斯坦布尔 FMVP',
    year: 2022, kind: 'fmvp', clubId: 'T8', clubTag: 'LOUD',
    rating: 95,
    note: 'LOUD 夺冠，巴西赛区第一座世界冠军。',
  },
  {
    id: 'L:demon1-champions-2023',
    ign: 'Demon1', title: '2023 洛杉矶冠军赛 FMVP', short: '23 洛杉矶 FMVP',
    year: 2023, kind: 'fmvp', clubId: 'T10', clubTag: 'EG',
    rating: 95,
    note: 'EG 从最后一名打到世界冠军，Demon1 是那年的现象。',
  },
  {
    id: 'L:zmjjkk-champions-2024',
    ign: 'ZmjjKK', title: '2024 首尔冠军赛 FMVP', short: '24 首尔 FMVP',
    year: 2024, kind: 'fmvp', clubId: 'T36', clubTag: 'EDG',
    rating: 97,
    note: 'EDG 3–2 Heretics，决赛五图 111 杀创纪录，中国赛区首个国际冠军。',
  },
  {
    id: 'L:brawk-champions-2025',
    ign: 'brawk', title: '2025 巴黎冠军赛 FMVP', short: '25 巴黎 FMVP',
    year: 2025, kind: 'fmvp', clubId: 'T1', clubTag: 'NRG',
    rating: 94,
    note: 'NRG 3–2 FNATIC，队史首个世界冠军。',
  },
  {
    id: 'L:zekken-madrid-2024',
    ign: 'zekken', title: '2024 马德里大师赛 FMVP', short: '24 马德里 FMVP',
    year: 2024, kind: 'fmvp', clubId: 'T4', clubTag: 'SEN',
    rating: 94,
    note: 'Sentinels 3–2 Gen.G，决赛 101/85/29。',
  },
  {
    id: 'L:t3xture-shanghai-2024',
    ign: 't3xture', title: '2024 上海大师赛 FMVP', short: '24 上海 FMVP',
    year: 2024, kind: 'fmvp', clubId: 'T27', clubTag: 'GEN',
    rating: 94,
    note: 'Gen.G 3–2 Heretics，太平洋赛区第一座国际赛冠军。',
  },
  {
    id: 'L:meteor-bangkok-2025',
    ign: 'Meteor', title: '2025 曼谷大师赛 FMVP', short: '25 曼谷 FMVP',
    year: 2025, kind: 'fmvp', clubId: 'T25', clubTag: 'T1',
    rating: 93,
    note: 'T1 击败 G2 夺冠，Meteor 拿下个人第一座 FMVP。',
  },
  {
    id: 'L:forsaken-toronto-2025',
    ign: 'f0rsakeN', title: '2025 多伦多大师赛 FMVP', short: '25 多伦多 FMVP',
    year: 2025, kind: 'fmvp', clubId: 'T24', clubTag: 'PRX',
    rating: 94,
    note: 'Paper Rex 3–1 FNATIC，队史第一座国际赛冠军。',
  },
  {
    id: 'L:dambi-santiago-2026',
    ign: 'Dambi', title: '2026 圣地亚哥大师赛 FMVP', short: '26 圣地亚哥 FMVP',
    year: 2026, kind: 'fmvp', clubId: 'T26', clubTag: 'NS',
    rating: 93,
    note: 'NS 3–0 横扫 Paper Rex，用 Neon 打满七场全胜。',
  },
  {
    id: 'L:neon-london-2026',
    ign: 'Neon', title: '2026 伦敦大师赛 FMVP', short: '26 伦敦 FMVP',
    year: 2026, kind: 'fmvp', clubId: 'T0', clubTag: 'LEV',
    rating: 95,
    note: 'LEV 3–2 Paper Rex，平均年龄 19.6 岁，拉美赛区首个大师赛冠军。',
  },

  // ---------------------------------------------------------------- 社区 MVP
  {
    id: 'L:nats-berlin-2021',
    ign: 'nAts', title: '2021 柏林大师赛 MVP', short: '21 柏林大师 MVP',
    year: 2021, kind: 'mvp', clubId: 'H:gambit', clubTag: 'GMB',
    rating: 93,
    note: 'Gambit 3–0 Envy。当年还没有官方 FMVP 奖项。',
  },
  {
    id: 'L:shao-copenhagen-2022',
    ign: 'Shao', title: '2022 哥本哈根大师赛 MVP', short: '22 哥本哈根 MVP',
    year: 2022, kind: 'mvp', clubId: 'T40', clubTag: 'FPX',
    rating: 92,
    note: 'FPX 3–2 Paper Rex。THESPIKE 评选的赛事 MVP。',
  },
  {
    id: 'L:alfajer-tokyo-2023',
    ign: 'Alfajer', title: '2023 东京大师赛 MVP', short: '23 东京 MVP',
    year: 2023, kind: 'mvp', clubId: 'T14', clubTag: 'FNC',
    rating: 94,
    note: 'FNATIC 3–0 EG，vlr.gg 评选 MVP，队内一致提名。',
  },

  // ---------------------------------------------------------------- 现象级
  {
    id: 'L:ethan-two-rings',
    ign: 'Ethan', title: '双冠王', short: '双冠王',
    year: 2025, kind: 'icon', clubId: 'T1', clubTag: 'NRG',
    rating: 92,
    note: '史上唯一两次夺得世界冠军的选手：2023 EG、2025 NRG。也是首位奖金破 50 万美元的选手。',
  },
  {
    id: 'L:derke-2023-double',
    ign: 'Derke', title: '2023 双冠 FNATIC', short: '23 双冠',
    year: 2023, kind: 'icon', clubId: 'T14', clubTag: 'FNC',
    rating: 95,
    note: 'FNATIC 同年拿下 LOCK//IN 圣保罗与东京大师赛，史上第一支双大赛冠军队伍。',
  },
  {
    id: 'L:chronicle-2023-double',
    ign: 'Chronicle', title: '2023 双冠 FNATIC', short: '23 双冠',
    year: 2023, kind: 'icon', clubId: 'T14', clubTag: 'FNC',
    rating: 93,
    note: '那支 FNATIC 的中轴。生涯奖金 $519,629，卡池里数一数二。',
  },
  {
    id: 'L:boaster-2023-double',
    ign: 'Boaster', title: '2023 双冠队长', short: '23 双冠队长',
    year: 2023, kind: 'icon', clubId: 'T14', clubTag: 'FNC',
    // 62 today. He called both of those wins; the card is the shelf, not the aim
    rating: 86,
    note: '那支 FNATIC 的指挥。数据从来不好看，但两座大赛冠军是他喊下来的。',
  },
  {
    id: 'L:izu-bangkok-2025',
    ign: 'iZu', title: '2025 曼谷大师赛 冠军', short: '25 曼谷冠军',
    year: 2025, kind: 'icon', clubId: 'T25', clubTag: 'T1',
    rating: 94,
    // Meteor took the trophy; iZu carried the tournament — T1's best line
    // in Bangkok by a distance, 453 rounds at R 1.13, K/D 1.24, KAST 75%,
    // fifth of every player at the event. 「曼谷大师赛发挥爆种」.
    note: 'T1 曼谷登顶那两周的最稳一环：453 回合 R 1.13、K/D 1.24，全队第一，全赛事第五。',
  },
  {
    id: 'L:jinggg-toronto-2025',
    ign: 'Jinggg', title: '2025 多伦多冠军', short: '25 多伦多冠军',
    year: 2025, kind: 'icon', clubId: 'T24', clubTag: 'PRX',
    rating: 93,
    note: 'Paper Rex 队史首冠的突破口。',
  },
  {
    id: 'L:chichoo-champions-2024',
    ign: 'CHICHOO', title: '2024 首尔冠军', short: '24 首尔冠军',
    year: 2024, kind: 'icon', clubId: 'T36', clubTag: 'EDG',
    rating: 93,
    note: 'EDG 夺冠阵容的控场核心，中国赛区首个国际冠军成员。',
  },
]

export const LEGEND_KIND_CN: Record<LegendKind, string> = {
  fmvp: '官方 FMVP', mvp: '赛事 MVP', icon: '现象级',
}
