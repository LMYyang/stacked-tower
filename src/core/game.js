/**
 * 对局状态机（纯 JS、可变状态对象）——需求第 5~10 章。
 * 所有校验与状态变更都在这里完成，server 与 AI 只是调用方。
 *
 * 状态: 'IDLE' | 'PLAYING' | 'SETTLE'
 * 动作函数返回 { ok, reason?, code? }，非法动作一律不改状态。
 *
 * 校验顺序（需求 6.3，不得调换）：
 *   1 归属校验 → 2 行动权校验 → 3 特殊牌分支 → 4 点数接续 → 5 异色校验 → 6 状态更新
 * 注：归属/行动权在 Room 层（play/pass 入口）先查 game.currentTurn，这里从步骤 3 起。
 */

import { createDeck, canFollow, isJoker, JOKER_SMALL, JOKER_BIG } from './deck.js'
import { paramsFor, MAX_COLLAPSE, HAND_LIMIT } from './settings.js'

export function createGame(gameMode, rng = Math.random) {
  const p = paramsFor(gameMode)
  return {
    rng,
    gameMode,
    state: 'IDLE',
    targetLayer: p.targetLayer,
    towerLayer: 0,
    topCard: null,
    collapseCount: 0,
    needColorCheck: false,
    drawPile: [],
    discardPile: [],
    currentTurn: null, // 手牌下标轮转：null 表示未开局
    // 操作日志：最近一次 { seat, type, result, msg }，结算页复盘崩塌用（需求 9.2）
    lastOperate: null,
    // 本局崩塌复盘记录：[{ seat, layer, type, msg }]
    collapseHistory: [],
    result: null, // { settleResult: 'win'|'lose', msg }
  }
}

/** 开局：洗牌→取塔基→发 6 张→确定首位行动玩家（需求第 5 章） */
export function startGame(g, seatCount) {
  if (g.state !== 'IDLE') return { ok: false, reason: '对局已开始' }
  g.drawPile = createDeck(g.rng)
  g.discardPile = []
  g.towerLayer = 1
  g.topCard = g.drawPile.shift()
  g.collapseCount = 0
  g.needColorCheck = false
  g.lastOperate = null
  g.collapseHistory = []
  g.result = null
  g.hands = Array.from({ length: seatCount }, () => [])
  for (let i = 0; i < HAND_LIMIT; i++) {
    for (let s = 0; s < seatCount; s++) {
      if (g.drawPile.length > 0) g.hands[s].push(g.drawPile.shift())
    }
  }
  g.currentTurn = 0
  g.state = 'PLAYING'
  return { ok: true }
}

/** 出牌成功后补牌：手牌 < 上限且抽牌堆非空时补 1 张（需求 6.4） */
function refill(g, seat) {
  if (g.drawPile.length > 0 && g.hands[seat].length < HAND_LIMIT) {
    g.hands[seat].push(g.drawPile.shift())
  }
}

/** 记录崩塌复盘信息 */
function recordCollapse(g, seat, type, msg) {
  g.collapseCount += 1
  g.collapseHistory.push({ seat, layer: g.towerLayer, type, msg })
}

/** 塔上全部卡牌（塔体只保留塔顶牌，历史层已入弃牌区，清塔即塔顶一张入弃） */
function clearTower(g) {
  if (g.topCard) g.discardPile.push(g.topCard)
  g.topCard = null
}

/**
 * 出牌（需求 6.3 校验顺序 + 第 7 章特殊牌）。
 * cardId：所打出的牌；replaceCardId：小王替换塔顶用的普通花色手牌。
 */
export function playCard(g, seat, cardId, replaceCardId = null) {
  if (g.state !== 'PLAYING') return { ok: false, code: 1001, reason: '对局未开始' }
  if (g.currentTurn !== seat) return { ok: false, code: 3001, reason: '非本回合' }
  const hand = g.hands[seat]
  const idx = hand.findIndex((c) => c.cardId === cardId)
  if (idx === -1) return { ok: false, code: 1002, reason: '卡牌不在手牌中' }
  const card = hand[idx]

  if (card.suit === JOKER_SMALL) return playSmallJoker(g, seat, idx, replaceCardId)
  if (card.suit === JOKER_BIG) return playBigJoker(g, seat, idx)
  return playNormal(g, seat, idx, card)
}

/** 小王：安全重置（需求 7.1）——不校验点数颜色、层数不变、崩塌不变、异色标记保持 */
function playSmallJoker(g, seat, jokerIdx, replaceCardId) {
  const hand = g.hands[seat]
  const repIdx = hand.findIndex((c) => c.cardId === replaceCardId)
  if (repIdx === -1 || repIdx === jokerIdx) {
    return { ok: false, code: 1002, reason: '替换牌无效：须另选一张普通花色手牌' }
  }
  const repCard = hand[repIdx]
  if (isJoker(repCard)) {
    return { ok: false, code: 1002, reason: '替换牌不能是大小王' }
  }
  // 弃旧塔顶 → 新塔顶 → 弃小王；层数/崩塌/异色标记均不变
  g.discardPile.push(g.topCard)
  g.topCard = repCard
  hand.splice(repIdx, 1)
  const joker = hand.splice(jokerIdx, 1)[0]
  g.discardPile.push(joker)
  g.lastOperate = { seat, type: 'playCard', result: 'jokerSmall', msg: '小王生效，请以新塔顶为基准继续' }
  refill(g, seat)
  return finishTurn(g, seat)
}

/** 大王：高危重置（需求 7.2）——清塔、崩塌+1、异色重置、重建塔基（抽牌堆优先，弃牌区兜底） */
function playBigJoker(g, seat, jokerIdx) {
  clearTower(g)
  g.hands[seat].splice(jokerIdx, 1)
  g.needColorCheck = false
  let newBase = g.drawPile.length > 0 ? g.drawPile.shift() : null
  if (!newBase || isJoker(newBase)) {
    // 兜底：抽牌堆顶是王或为空，从弃牌区找非王牌
    const di = g.discardPile.findIndex((c) => !isJoker(c))
    if (di !== -1) {
      newBase = g.discardPile.splice(di, 1)[0]
    } else {
      // 塔基兜底失败（需求 7.2）：无法继续，崩塌直接置上限结算失败
      recordCollapse(g, seat, 'baseFallback', '塔基兜底失败：抽牌堆与弃牌区均无非王牌')
      g.collapseCount = MAX_COLLAPSE
      return settleLose(g, seat, 'playCard', 'baseFallback', '大王生效但无法重建塔基，挑战失败！')
    }
  }
  g.discardPile.push({ cardId: JOKER_BIG, suit: JOKER_BIG, rank: 'JOKER_BIG', color: null })
  g.topCard = newBase
  g.towerLayer = 1
  recordCollapse(g, seat, 'bigJoker', '大王生效，塔已清空，崩塌次数加一')
  g.lastOperate = { seat, type: 'playCard', result: 'collapse', msg: '大王生效，塔已清空，崩塌次数加一' }
  refill(g, seat)
  if (g.collapseCount >= MAX_COLLAPSE) return settleLose(g, seat, 'playCard', 'bigJoker', '崩塌次数耗尽，挑战失败！')
  return finishTurn(g, seat)
}

/** 普通牌：先点数后颜色（需求 6.3 步骤 4/5 顺序不可调换） */
function playNormal(g, seat, idx, card) {
  const hand = g.hands[seat]
  if (!canFollow(g.topCard.rank, card.rank)) {
    return { ok: false, code: 1002, reason: '点数不匹配，无法叠放' } // 牌留在手中
  }
  if (g.needColorCheck && card.color === g.topCard.color) {
    // 异色校验失败：崩塌+1，牌入弃牌区，塔体不变，标记重置（需求 8.2）
    hand.splice(idx, 1)
    g.discardPile.push(card)
    recordCollapse(g, seat, 'colorCheck', '当前需要异色牌，颜色相同，塔崩塌')
    g.needColorCheck = false
    g.lastOperate = { seat, type: 'playCard', result: 'collapse', msg: '当前需要异色牌，颜色相同，塔崩塌' }
    refill(g, seat)
    if (g.collapseCount >= MAX_COLLAPSE) return settleLose(g, seat, 'playCard', 'colorCheck', '崩塌次数耗尽，挑战失败！')
    return finishTurn(g, seat)
  }
  // 叠塔成功：层数+1，原塔顶入弃牌区
  hand.splice(idx, 1)
  g.discardPile.push(g.topCard)
  g.topCard = card
  g.towerLayer += 1
  let msg = '叠塔成功'
  if (g.needColorCheck) {
    g.needColorCheck = false
    msg = '异色校验通过，叠塔成功'
  }
  // 异色校验节点：层数为 3 的整数倍且 < 目标层数（需求 3.1 快速局说明）
  if (g.towerLayer % 3 === 0 && g.towerLayer < g.targetLayer) {
    g.needColorCheck = true
    msg += '，下一张必须打出异色牌'
  }
  g.lastOperate = { seat, type: 'playCard', result: 'success', msg }
  // 胜利判定时机：叠放成功瞬间（需求 9.1），不再轮转、不做该层后的颜色校验
  if (g.towerLayer >= g.targetLayer) return settleWin(g, seat, msg)
  refill(g, seat)
  return finishTurn(g, seat)
}

/** 过牌（需求 6.4）：必须弃一张，塔体/崩塌/异色标记均不变，不补牌 */
export function passCard(g, seat, discardCardId) {
  if (g.state !== 'PLAYING') return { ok: false, code: 1001, reason: '对局未开始' }
  if (g.currentTurn !== seat) return { ok: false, code: 3001, reason: '非本回合' }
  const hand = g.hands[seat]
  const idx = hand.findIndex((c) => c.cardId === discardCardId)
  if (idx === -1) return { ok: false, code: 1002, reason: '手牌不存在' }
  const discard = hand.splice(idx, 1)[0]
  g.discardPile.push(discard)
  g.lastOperate = { seat, type: 'passCard', result: 'success', msg: '过牌，弃掉一张手牌' }
  // 手牌耗尽（抽牌堆也空）时过牌会让该玩家彻底无牌：全员无牌可出则无法继续，
  // 按资源枯竭结算失败（需求第10章：牌堆耗尽为不可逆枯竭，形成自然收束）
  const anyPlayable = g.hands.some((h) =>
    h.some((c) => !isJoker(c) && canFollow(g.topCard.rank, c.rank))
  )
  const anyJoker = g.hands.some((h) => h.some((c) => isJoker(c) && h.filter((x) => !isJoker(x)).length > 0))
  const anyCards = g.hands.some((h) => h.length > 0)
  if (!anyPlayable && !anyJoker && !anyCards) {
    return settleLose(g, seat, 'passCard', 'exhausted', '全员手牌耗尽且无法接续，挑战失败！')
  }
  return finishTurn(g, seat)
}

/** 轮转到下一位 */
function finishTurn(g, seat) {
  g.currentTurn = (seat + 1) % g.hands.length
  return { ok: true }
}

function settleWin(g, seat, msg) {
  g.state = 'SETTLE'
  g.result = { settleResult: 'win', msg: '全队成功搭至目标层数，挑战胜利' }
  g.lastOperate = { seat, type: 'playCard', result: 'win', msg }
  return { ok: true, settle: g.result }
}

function settleLose(g, seat, type, result, msg) {
  g.state = 'SETTLE'
  g.result = { settleResult: 'lose', msg }
  g.lastOperate = { seat, type, result, msg }
  return { ok: true, settle: g.result }
}

/** 客户端可见状态（需求附录B）：全量字段 + 操作日志 */
export function viewOf(g, viewerSeat = null) {
  return {
    gameMode: g.gameMode,
    state: g.state,
    targetLayer: g.targetLayer,
    towerLayer: g.towerLayer,
    topCard: g.topCard,
    collapseCount: g.collapseCount,
    maxCollapse: MAX_COLLAPSE,
    needColorCheck: g.needColorCheck,
    drawPileCount: g.drawPile.length,
    discardPile: g.discardPile.slice(-6),
    currentTurn: g.currentTurn,
    lastOperate: g.lastOperate,
    collapseHistory: g.collapseHistory,
    result: g.result,
    hands: viewerSeat === null ? null : g.hands[viewerSeat],
    handCounts: g.hands.map((h) => h.length),
  }
}

export { canFollow, isJoker }
