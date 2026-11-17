/**
 * 牌库与卡牌定义（纯 JS、平台无关）。
 * 54 张标准扑克：四花色 A-K 各 13 张 + 小王(jokerRed) + 大王(jokerBlack)。
 * 点数序列环形接续：K 接 Q/A，A 接 K/2（序列首尾相接，下标取模判定）。
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
export const SUITS = [
  { suit: 'heart', color: 'red' },
  { suit: 'diamond', color: 'red' },
  { suit: 'spade', color: 'black' },
  { suit: 'club', color: 'black' },
]
export const JOKER_SMALL = 'jokerRed'
export const JOKER_BIG = 'jokerBlack'

export function isJoker(card) {
  return card.suit === JOKER_SMALL || card.suit === JOKER_BIG
}

/** Fisher-Yates 洗牌（不改原数组） */
export function shuffle(arr, rng = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 生成整副 54 张牌并洗序（appendixA 标识规范） */
export function createDeck(rng = Math.random) {
  const deck = []
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push({ cardId: `${s.suit}-${r}`, suit: s.suit, rank: r, color: s.color })
    }
  }
  deck.push({ cardId: JOKER_SMALL, suit: JOKER_SMALL, rank: 'JOKER_SMALL', color: null })
  deck.push({ cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null })
  return shuffle(deck, rng)
}

/** mulberry32：可注入的确定性随机源（测试用） */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 点数接续判定（环形）：new 是否可叠在 top 上。
 * 允许 top+1 或 top-1（环形边界：K 接 A、A 接 K），同点与跳点均不可。
 */
export function canFollow(topRank, newRank) {
  const ti = RANKS.indexOf(topRank)
  const ni = RANKS.indexOf(newRank)
  if (ti === -1 || ni === -1) return false
  const diff = (ni - ti + RANKS.length) % RANKS.length
  return diff === 1 || diff === RANKS.length - 1
}
