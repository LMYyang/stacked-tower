import { describe, it, expect } from 'vitest'
import { createGame, startGame, playCard, passCard } from '../src/core/game.js'
import { aiDecide } from '../src/core/ai.js'
import { mulberry32 } from '../src/core/deck.js'
import { JOKER_SMALL, JOKER_BIG } from '../src/core/deck.js'
import { SUITS } from '../src/core/deck.js'

const C = (suit, rank) => ({ cardId: `${suit}-${rank}`, suit, rank, color: SUITS.find((s) => s.suit === suit).color })
const isJokerCard = (c) => c.suit === JOKER_SMALL || c.suit === JOKER_BIG

function setup(seat, top, hand, opts = {}) {
  const g = createGame(1, mulberry32(42))
  startGame(g, 2)
  g.currentTurn = seat
  g.topCard = top
  g.hands[seat] = hand
  if (opts.needColorCheck) g.needColorCheck = true
  if (opts.collapse != null) g.collapseCount = opts.collapse
  return g
}

describe('AI 决策优先级（需求11.1）', () => {
  it('优先级1：有合法普通牌直接打出', () => {
    const g = setup(1, C('heart', '7'), [C('spade', '8'), C('heart', '3')])
    const d = aiDecide(g, 1)
    expect(d.action).toBe('play')
    expect(d.cardId).toBe('spade-8')
  })
  it('优先级1：异色标记下只打颜色合规的牌', () => {
    const g = setup(1, C('heart', '7'), [C('diamond', '8'), C('spade', '8')], { needColorCheck: true })
    const d = aiDecide(g, 1)
    expect(d.action).toBe('play')
    expect(d.cardId).toBe('spade-8')
  })
  it('优先级2：无普通牌可接时用小王解僵局', () => {
    const g = setup(1, C('heart', '7'), [C('heart', '2'), { cardId: JOKER_SMALL, suit: JOKER_SMALL, rank: 'JOKER_SMALL', color: null }])
    const d = aiDecide(g, 1)
    expect(d.action).toBe('play')
    expect(d.cardId).toBe(JOKER_SMALL)
    expect(d.replaceCardId).toBe('heart-2')
  })
  it('优先级3：easy 永不用大王 → 走过牌', () => {
    const g = setup(1, C('heart', '7'), [C('heart', '2'), { cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null }])
    const d = aiDecide(g, 1, 'easy')
    expect(d.action).toBe('pass')
    expect(d.discardCardId).toBe('heart-2') // 弃非王
  })
  it('优先级3：hard 且余量充足时用大王', () => {
    const g = setup(1, C('heart', '7'), [C('heart', '2'), { cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null }], { collapse: 0 })
    const d = aiDecide(g, 1, 'hard')
    expect(d.action).toBe('play')
    expect(d.cardId).toBe(JOKER_BIG)
  })
  it('优先级3：hard 余量 2 且不能立即获胜时不用大王', () => {
    const g = setup(1, C('heart', '7'), [C('heart', '2'), { cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null }], { collapse: 1 })
    g.towerLayer = 2
    const d = aiDecide(g, 1, 'hard')
    expect(d.action).toBe('pass')
  })
  it('优先级4：过牌弃接续价值最低的牌', () => {
    const g = setup(1, C('heart', '7'), [C('heart', '2'), C('diamond', '3'), C('club', 'K')])
    const d = aiDecide(g, 1, 'easy')
    expect(d.action).toBe('pass')
    expect(d.discardCardId).toBe('heart-2') // 全部接不上时弃第一张（非王优先保王）
  })
})

describe('AI 与真人共用校验（需求11.1）', () => {
  it('AI 决策的出牌能被核心校验接受', () => {
    const g = setup(1, C('heart', '7'), [C('spade', '8'), C('club', '9')])
    const d = aiDecide(g, 1)
    expect(d.action).toBe('play')
    const res = playCard(g, 1, d.cardId, d.replaceCardId)
    expect(res.ok).toBe(true)
  })
  it('AI 过牌决策能被核心校验接受', () => {
    const g = setup(1, C('heart', '7'), [C('heart', '2'), C('diamond', '2')])
    const d = aiDecide(g, 1, 'easy')
    const res = passCard(g, 1, d.discardCardId)
    expect(res.ok).toBe(true)
  })
})
