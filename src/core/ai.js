/**
 * AI 决策（需求第 11 章）：与真人共用同一套校验函数，仅决策来源不同。
 * 优先级：1 合法普通牌 → 2 小王解僵局 → 3 大王（按难度/崩塌余量）→ 4 过牌弃最差牌。
 */

import { canFollow, isJoker, JOKER_SMALL, JOKER_BIG } from './deck.js'
import { MAX_COLLAPSE } from './settings.js'

/**
 * AI 回合决策。
 * g: 对局状态；seat: AI 座位；difficulty: 'easy' | 'hard'
 * 返回 { action: 'play'|'pass', cardId, replaceCardId? , discardCardId? }
 */
export function aiDecide(g, seat, difficulty = 'easy') {
  const hand = g.hands[seat]
  const top = g.topCard
  if (!top) return { action: 'pass', discardCardId: hand[0]?.cardId }

  // 优先级 1：点数接续且异色合规的普通牌，选能维持后续接续空间的点数
  const normalLegal = hand.filter(
    (c) => !isJoker(c) && canFollow(top.rank, c.rank) && !(g.needColorCheck && c.color === top.color)
  )
  if (normalLegal.length > 0) {
    const best = normalLegal.sort((a, b) => followSpace(g, b) - followSpace(g, a))[0]
    return { action: 'play', cardId: best.cardId }
  }

  // 优先级 2：小王 + 存在可替换的普通手牌 → 解僵局
  const smallJoker = hand.find((c) => c.suit === JOKER_SMALL)
  const otherNormal = hand.find((c) => !isJoker(c))
  if (smallJoker && otherNormal) {
    return { action: 'play', cardId: smallJoker.cardId, replaceCardId: otherNormal.cardId }
  }

  // 优先级 3：大王（需求 11.2 难度分级）
  const bigJoker = hand.find((c) => c.suit === JOKER_BIG)
  if (bigJoker && shouldUseBigJoker(g, difficulty)) {
    return { action: 'play', cardId: bigJoker.cardId }
  }

  // 优先级 4：过牌，弃接续价值最低的一张（非王优先弃，保住王）
  const discardable = hand.filter((c) => !isJoker(c))
  const pool = discardable.length > 0 ? discardable : hand
  const worst = pool.reduce((w, c) => (followValue(g, c) < followValue(g, w) ? c : w), pool[0])
  return { action: 'pass', discardCardId: worst.cardId }
}

/** 该牌打出后塔顶新点数的后续接续空间（手中+估判），越大越优先打出 */
function followSpace(g, card) {
  const hand = g.hands.flatMap((h) => h)
  return hand.filter((c) => c !== card && !isJoker(c) && canFollow(card.rank, c.rank)).length
}

/** 过牌弃牌价值：越接不上当前塔顶越该弃 */
function followValue(g, card) {
  if (isJoker(card)) return 10
  return canFollow(g.topCard.rank, card.rank) ? 5 : 0
}

/** 大王使用条件：easy 永不用；hard 看崩塌余量（余 3 谨慎用，余 2 仅确认可立即获胜才用） */
function shouldUseBigJoker(g, difficulty) {
  if (difficulty === 'easy') return false
  const remain = MAX_COLLAPSE - g.collapseCount
  if (remain >= 3) return true
  if (remain === 2) return g.towerLayer + 1 >= g.targetLayer // 仅立即获胜才值得
  return false
}
