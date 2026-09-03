/**
 * Nationality, in the player's words.
 *
 * One table for every screen that names a country and for the daily
 * challenge's 国籍 column, so a code can never leak out as two capital
 * letters somewhere the name was wanted — 「SpiritZ1 的国籍显示的是 TW」.
 *
 * vlr.gg files Taiwan, Hong Kong and Macau as separate two-letter codes. This
 * game shows all three under the PRC flag and names them 中国台湾 / 中国香港 /
 * 中国澳门 — the owner's call for a game made for a mainland audience — and
 * treats them as one country wherever nationality is compared for a hint.
 * The import rule already does (engine/imports.ts).
 */
export const NAT_CN: Record<string, string> = {
  cn: '中国', kr: '韩国', us: '美国', tr: '土耳其', br: '巴西', ru: '俄罗斯',
  tw: '中国台湾', pl: '波兰', cl: '智利', ca: '加拿大', ph: '菲律宾', jp: '日本',
  ar: '阿根廷', gb: '英国', fr: '法国', es: '西班牙', de: '德国', se: '瑞典',
  dk: '丹麦', fi: '芬兰', no: '挪威', nl: '荷兰', be: '比利时', pt: '葡萄牙',
  it: '意大利', ua: '乌克兰', lv: '拉脱维亚', lt: '立陶宛', ee: '爱沙尼亚',
  cz: '捷克', sk: '斯洛伐克', hu: '匈牙利', ro: '罗马尼亚', bg: '保加利亚',
  rs: '塞尔维亚', hr: '克罗地亚', gr: '希腊', il: '以色列', sa: '沙特',
  ae: '阿联酋', eg: '埃及', ma: '摩洛哥', za: '南非', au: '澳大利亚',
  nz: '新西兰', id: '印度尼西亚', my: '马来西亚', sg: '新加坡', th: '泰国',
  vn: '越南', in: '印度', mn: '蒙古', kh: '柬埔寨', hk: '中国香港', mo: '中国澳门',
  mx: '墨西哥', co: '哥伦比亚', pe: '秘鲁', uy: '乌拉圭', ve: '委内瑞拉',
  ch: '瑞士', at: '奥地利', ie: '爱尔兰', is: '冰岛', by: '白俄罗斯', kz: '哈萨克斯坦',
}

/** Codes that are shown under another flag. */
export const FLAG_AS: Record<string, string> = { tw: 'cn', hk: 'cn', mo: 'cn' }

export const natName = (nat: string | null | undefined): string =>
  (nat && NAT_CN[nat.toLowerCase()]) || (nat ? nat.toUpperCase() : '国籍未知')

/** The country a code belongs to, for comparing two players' nationality. */
export const natCountry = (nat: string | null | undefined): string | null => {
  const k = (nat ?? '').toLowerCase()
  return k ? (FLAG_AS[k] ?? k) : null
}
