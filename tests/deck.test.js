import { describe, it, expect } from 'vitest'
import { RANKS, createDeck, mulberry32, canFollow } from '../src/core/deck.js'

describe('牌库构成', () => {
  it('54 张：52 张花色牌 + 大小王，标识符合附录A', () => {
    const deck = createDeck(mulberry32(1))
    expect(deck.length).toBe(54)
    const suits = {}
    for (const c of deck) suits[c.suit] = (suits[c.suit] || 0) + 1
    expect(suits.heart).toBe(13)
    expect(suits.diamond).toBe(13)
    expect(suits.spade).toBe(13)
    expect(suits.club).toBe(13)
    expect(suits.jokerRed).toBe(1)
    expect(suits.jokerBlack).toBe(1)
    expect(deck.find((c) => c.cardId === 'heart-A').color).toBe('red')
    expect(deck.find((c) => c.cardId === 'spade-K').color).toBe('black')
    expect(deck.find((c) => c.cardId === 'jokerRed').color).toBe(null)
  })

  it('洗牌不改原数组且确定性可复现', () => {
    const d1 = createDeck(mulberry32(42))
    const d2 = createDeck(mulberry32(42))
    expect(d1.map((c) => c.cardId)).toEqual(d2.map((c) => c.cardId))
  })
})

describe('点数接续（环形边界，R-01/R-02/R-03）', () => {
  it('全序列相邻点数可接续', () => {
    for (let i = 0; i < RANKS.length; i++) {
      const next = RANKS[(i + 1) % RANKS.length]
      const prev = RANKS[(i - 1 + RANKS.length) % RANKS.length]
      expect(canFollow(RANKS[i], next)).toBe(true)
      expect(canFollow(RANKS[i], prev)).toBe(true)
    }
  })
  it('R-01 塔顶 K 可接 Q 与 A', () => {
    expect(canFollow('K', 'Q')).toBe(true)
    expect(canFollow('K', 'A')).toBe(true)
    expect(canFollow('K', 'J')).toBe(false)
  })
  it('R-02 塔顶 A 可接 K 与 2', () => {
    expect(canFollow('A', 'K')).toBe(true)
    expect(canFollow('A', '2')).toBe(true)
    expect(canFollow('A', '3')).toBe(false)
  })
  it('R-03 同点与跳点不可叠', () => {
    expect(canFollow('7', '7')).toBe(false)
    expect(canFollow('7', '9')).toBe(false)
    expect(canFollow('7', '5')).toBe(false)
  })
})
