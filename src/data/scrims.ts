/**
 * 群友内战: results of the player group's own ten-person matches, shown under 杯赛 → 内战.
 * Hand-kept. Names are the 开瓦包 名字 #tag of each account (looked up by 对战码), newest event first.
 */
export interface ScrimTeam {
  players: string[]
  coach?: string
}

export interface ScrimEvent {
  date: string
  title: string
  champion: ScrimTeam
  runnerUp: ScrimTeam
}

export const SCRIMS: ScrimEvent[] = [
  {
    date: '10/14',
    title: '猪之杯 S0',
    champion: {
      players: ['伦敦雨没有我忧郁 #7686', 'M0kueir #F494', '926 #E4A2', '虫儿飞 #AE3F', '四叶草 #BEB7'],
      coach: '吾自当以一当十速战速决 #D060',
    },
    runnerUp: {
      players: ['重铸lev荣光 #271E', 'miumiu #9E2C', '一行琉璃 #268A', '凉拌玛卡巴卡 #AA88', '魔法披风 #F0DE'],
      coach: 'Edward #E54B',
    },
  },
]
