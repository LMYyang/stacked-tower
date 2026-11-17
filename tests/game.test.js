import { describe, it, expect } from 'vitest'
import { createGame, startGame, playCard, passCard, viewOf } from '../src/core/game.js'
import { mulberry32, canFollow } from '../src/core/deck.js'
import { RANKS, SUITS } from '../src/core/deck.js'
import { JOKER_SMALL, JOKER_BIG } from '../src/core/deck.js'

/** 找手牌中满足条件的牌 */
const findCard = (g, seat, pred) => g.hands[seat].find(pred)
const normal = (c) => c.suit !== JOKER_SMALL && c.suit !== JOKER_BIG

/** 强制设塔顶（测试辅助：绕开随机发牌，构造指定局面） */
function setTop(g, suit, rank) {
  const color = SUITS.find((s) => s.suit === suit)?.color || null
  g.topCard = { cardId: `${suit}-${rank}`, suit, rank, color }
}
function forceHand(g, seat, cards) {
  g.hands[seat] = cards
}

function freshGame(mode = 1, seats = 2, seed = 42) {
  const g = createGame(mode, mulberry32(seed))
  startGame(g, seats)
  return g
}

/** 把指定座位的回合对齐好并构造「塔顶 X + 手牌指定」的可控局面 */
function setupTurn(g, seat, topSuit, topRank, hand) {
  g.currentTurn = seat
  setTop(g, topSuit, topRank)
  forceHand(g, seat, hand)
}

const C = (suit, rank) => ({ cardId: `${suit}-${rank}`, suit, rank, color: SUITS.find((s) => s.suit === suit).color })

describe('开局（需求第5章）', () => {
  it('开局后塔基 1 层、每人 6 张、崩塌 0、首位玩家行动', () => {
    const g = freshGame(1, 2)
    expect(g.state).toBe('PLAYING')
    expect(g.towerLayer).toBe(1)
    expect(g.topCard).toBeTruthy()
    expect(g.hands.every((h) => h.length === 6)).toBe(true)
    expect(g.collapseCount).toBe(0)
    expect(g.needColorCheck).toBe(false)
    expect(g.currentTurn).toBe(0)
  })
})

describe('R-01/R-02/R-03 点数接续', () => {
  it('塔顶 K 接 Q/A 成功', () => {
    const g = freshGame()
    setupTurn(g, 0, 'spade', 'K', [C('heart', 'Q'), C('club', 'A')])
    expect(playCard(g, 0, 'heart-Q').ok).toBe(true)
    expect(g.towerLayer).toBe(2)
  })
  it('塔顶 A 接 K/2 成功', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', 'A', [C('spade', 'K'), C('diamond', '2')])
    expect(playCard(g, 0, 'diamond-2').ok).toBe(true)
    expect(g.towerLayer).toBe(2)
  })
  it('R-03 打 7/9 于塔顶 7 被拒，牌留手中', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('heart', '7'), C('heart', '9')])
    const res = playCard(g, 0, 'heart-7')
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1002)
    expect(g.hands[0].length).toBe(2) // 牌未离开手牌
    expect(g.towerLayer).toBe(1)
  })
})

describe('R-04~R-07 异色校验', () => {
  it('R-04 叠至第 3 层置异色标记（快速局也在 3 层触发）', () => {
    const g = freshGame(2, 2) // 快速局 targetLayer=6
    g.towerLayer = 2
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    const res = playCard(g, 0, 'spade-8')
    expect(res.ok).toBe(true)
    expect(g.towerLayer).toBe(3)
    expect(g.needColorCheck).toBe(true)
  })
  it('R-05 异色标记下打同色：崩塌+1、塔体不变、标记重置、牌入弃牌区', () => {
    const g = freshGame()
    g.towerLayer = 3
    g.needColorCheck = true
    setupTurn(g, 0, 'heart', '7', [C('diamond', '8')]) // 同红色
    const res = playCard(g, 0, 'diamond-8')
    expect(res.ok).toBe(true)
    expect(g.collapseCount).toBe(1)
    expect(g.towerLayer).toBe(3) // 塔体不变
    expect(g.topCard.rank).toBe('7') // 塔顶不变
    expect(g.needColorCheck).toBe(false)
    expect(g.discardPile.some((c) => c.cardId === 'diamond-8')).toBe(true)
  })
  it('R-06 异色标记下打异色：成功且标记重置', () => {
    const g = freshGame()
    g.towerLayer = 3
    g.needColorCheck = true
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    expect(playCard(g, 0, 'spade-8').ok).toBe(true)
    expect(g.towerLayer).toBe(4)
    expect(g.collapseCount).toBe(0)
    expect(g.needColorCheck).toBe(false)
  })
  it('R-07 标准局叠至第 6 层再次触发', () => {
    const g = freshGame(1, 2)
    g.towerLayer = 5
    g.needColorCheck = false
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    playCard(g, 0, 'spade-8')
    expect(g.towerLayer).toBe(6)
    expect(g.needColorCheck).toBe(true)
  })
  it('目标层本身（第8/6层）不再触发校验且立即胜利（R-10）', () => {
    const g = freshGame(1, 2)
    g.towerLayer = 7
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    const res = playCard(g, 0, 'spade-8')
    expect(res.ok).toBe(true)
    expect(g.state).toBe('SETTLE')
    expect(g.result.settleResult).toBe('win')
    expect(g.needColorCheck).toBe(false)
  })
})

describe('特殊牌（需求第7章）', () => {
  it('R-08 小王：塔顶替换、层数/崩塌不变、异色标记保持', () => {
    const g = freshGame()
    g.towerLayer = 3
    g.needColorCheck = true
    setupTurn(g, 0, 'heart', '7', [
      { cardId: JOKER_SMALL, suit: JOKER_SMALL, rank: 'JOKER_SMALL', color: null },
      C('spade', '3'),
    ])
    const res = playCard(g, 0, JOKER_SMALL, 'spade-3')
    expect(res.ok).toBe(true)
    expect(g.topCard.rank).toBe('3')
    expect(g.towerLayer).toBe(3) // 层数不变
    expect(g.collapseCount).toBe(0) // 崩塌不变
    expect(g.needColorCheck).toBe(true) // 标记保持，基准变为新塔顶
    expect(g.discardPile.some((c) => c.cardId === JOKER_SMALL)).toBe(true)
  })
  it('小王替换牌无效：王不能作替换牌、必须另选手牌', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [
      { cardId: JOKER_SMALL, suit: JOKER_SMALL, rank: 'JOKER_SMALL', color: null },
      { cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null },
    ])
    expect(playCard(g, 0, JOKER_SMALL, JOKER_BIG).ok).toBe(false)
    expect(playCard(g, 0, JOKER_SMALL, null).ok).toBe(false)
    expect(g.hands[0].length).toBe(2) // 状态未变
  })
  it('R-09 大王：清塔、层数重置 1、崩塌+1、标记重置、重建塔基', () => {
    const g = freshGame()
    g.towerLayer = 4
    g.needColorCheck = true
    setupTurn(g, 0, 'heart', '7', [
      { cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null },
      C('spade', '2'),
    ])
    const res = playCard(g, 0, JOKER_BIG)
    expect(res.ok).toBe(true)
    expect(g.towerLayer).toBe(1)
    expect(g.collapseCount).toBe(1)
    expect(g.needColorCheck).toBe(false)
    expect(g.topCard).toBeTruthy()
    expect(normal(g.topCard)).toBe(true) // 新塔基是非王牌
  })
  it('R-11 大王后崩塌达 3 立即结算失败', () => {
    const g = freshGame()
    g.collapseCount = 2
    setupTurn(g, 0, 'heart', '7', [
      { cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null },
      C('spade', '2'),
    ])
    const res = playCard(g, 0, JOKER_BIG)
    expect(res.ok).toBe(true)
    expect(g.state).toBe('SETTLE')
    expect(g.result.settleResult).toBe('lose')
  })
})

describe('R-10/R-11 胜负判定', () => {
  it('R-11 崩塌达 3 立即结算失败（异色失败路径）', () => {
    const g = freshGame()
    g.collapseCount = 2
    g.towerLayer = 3
    g.needColorCheck = true
    setupTurn(g, 0, 'heart', '7', [C('diamond', '8')])
    playCard(g, 0, 'diamond-8')
    expect(g.state).toBe('SETTLE')
    expect(g.result.settleResult).toBe('lose')
  })
})

describe('R-12/R-13/R-14 过牌与补牌', () => {
  it('R-12 过牌必须弃一张', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('spade', '2')])
    expect(passCard(g, 0, '不存在').ok).toBe(false)
    expect(g.hands[0].length).toBe(1)
  })
  it('R-13 出牌后自动补至 6 张', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    expect(g.drawPile.length).toBeGreaterThan(0)
    playCard(g, 0, 'spade-8')
    expect(g.hands[0].length).toBe(1) // 1-1+1=1（原 1 张，补 1 张）
  })
  it('R-14 抽牌堆为空时不补牌', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('spade', '8'), C('spade', '6')])
    g.drawPile = []
    playCard(g, 0, 'spade-8')
    expect(g.hands[0].length).toBe(1) // 不补
  })
  it('过牌不补牌且塔状态不变', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('spade', '8'), C('spade', '6')])
    const layerBefore = g.towerLayer
    const collapseBefore = g.collapseCount
    passCard(g, 0, 'spade-6')
    expect(g.towerLayer).toBe(layerBefore)
    expect(g.collapseCount).toBe(collapseBefore)
    expect(g.hands[0].length).toBe(1) // 2-1=1，不补
    expect(g.discardPile.some((c) => c.cardId === 'spade-6')).toBe(true)
  })
})

describe('回合与权限（E-01/E-02/E-03）', () => {
  it('E-01 非本回合提交被拒', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    const res = playCard(g, 1, 'spade-8')
    expect(res.ok).toBe(false)
    expect(res.code).toBe(3001)
  })
  it('E-02 提交不存在的卡牌被拒', () => {
    const g = freshGame()
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    const res = playCard(g, 0, 'heart-99')
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1002)
  })
  it('回合轮转：出牌后轮到下一位', () => {
    const g = freshGame(1, 3)
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    playCard(g, 0, 'spade-8')
    expect(g.currentTurn).toBe(1)
  })
  it('结算后拒绝一切操作（R-11 后续请求全部拒绝）', () => {
    const g = freshGame()
    g.collapseCount = 3
    g.state = 'SETTLE'
    setupTurn(g, 0, 'heart', '7', [C('spade', '8')])
    g.state = 'SETTLE'
    const res = playCard(g, 0, 'spade-8')
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1001)
  })
})

describe('viewOf（附录B）', () => {
  it('本人视角含手牌，他人视角只有数量', () => {
    const g = freshGame(1, 2)
    const v0 = viewOf(g, 0)
    expect(v0.hands.length).toBe(6)
    expect(v0.handCounts).toEqual([6, 6])
    expect(v0.targetLayer).toBe(8)
    const vFast = viewOf(freshGame(2, 2))
    expect(vFast.targetLayer).toBe(6)
  })
})
