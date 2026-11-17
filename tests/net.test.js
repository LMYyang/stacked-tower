/**
 * 联网链路集成测试（server + core 全链路，socket.io-client 内存级直连）。
 * 覆盖需求 17.2 异常用例：E-01/E-02/E-03/E-06 + 单机全流程 + 结算。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { io as Client } from 'socket.io-client'
import { createServerApp, Room } from '../server/index.js'

let app
const PORT = 3757
const URL = `http://127.0.0.1:${PORT}`

function connect() {
  const c = Client(URL, { transports: ['websocket'] })
  return new Promise((resolve) => {
    c.on('connect', () => {
      c.emit('auth', { userId: 'u_' + Math.random().toString(36).slice(2), nickname: '测试玩家' + Math.floor(Math.random() * 100), platform: 'test' }, () => resolve(c))
    })
  })
}

const emit = (c, event, data) =>
  new Promise((resolve) => {
    c.emit(event, data, resolve)
  })

const waitEvent = (c, event, timeout = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`等待 ${event} 超时`)), timeout)
    c.once(event, (data) => {
      clearTimeout(t)
      resolve(data)
    })
  })

beforeAll(() => {
  app = createServerApp({ port: PORT })
})

afterAll(() => {
  app.httpServer.close()
})

describe('房间与开局', () => {
  it('建房→广播 roomChange；开局面广播 gameStart（含各自手牌）', async () => {
    const host = await connect()
    const guest = await connect()
    const createRes = await emit(host, 'createRoom', { gameMode: 1, maxPlayer: 4 })
    expect(createRes.code).toBe(0)
    const roomId = createRes.data.roomId

    const guestReady = waitEvent(guest, 'roomChange')
    const joinRes = await emit(guest, 'joinRoom', { roomCode: roomId.slice(1) })
    expect(joinRes.code).toBe(0)
    await guestReady

    await emit(guest, 'playerReady', { roomId, isReady: true })
    const hostStart = waitEvent(host, 'gameStart')
    const guestStart = waitEvent(guest, 'gameStart')
    const startRes = await emit(host, 'startGame', { roomId })
    expect(startRes.code).toBe(0)
    const hs = await hostStart
    const gs = await guestStart
    expect(hs.gameStatus).toBe('gaming')
    expect(hs.towerLayer).toBe(1)
    expect(hs.hands.length).toBe(6) // 本人手牌明细
    expect(gs.hands.length).toBe(6)
    expect(hs.playerList.every((p) => p.handCards || p.handCardCount === 6)).toBe(true)
    host.close()
    guest.close()
  })

  it('E-06 对局开始后加入被拒', async () => {
    const host = await connect()
    const guest = await connect()
    const { data } = await emit(host, 'createRoom', { gameMode: 1, maxPlayer: 4 })
    await emit(guest, 'joinRoom', { roomCode: data.roomId.slice(1) })
    await emit(guest, 'playerReady', { roomId: data.roomId, isReady: true })
    await emit(host, 'startGame', { roomId: data.roomId })
    const third = await connect()
    const res = await emit(third, 'joinRoom', { roomCode: data.roomId.slice(1) })
    expect(res.code).toBe(1001)
    host.close()
    guest.close()
    third.close()
  })
})

describe('单机合作全流程（AI 队友）', () => {
  it('createSingleGame → gameStart → AI 自动出牌推进回合', async () => {
    const c = await connect()
    // 先挂监听再建房：server 在 createSingleGame 回调前就广播 gameStart，事后注册会错过
    const gsPromise = waitEvent(c, 'gameStart')
    const res = await emit(c, 'createSingleGame', { gameMode: 1, aiCount: 2 })
    expect(res.code).toBe(0)
    const sid = res.data.singleGameId
    const gs = await gsPromise
    expect(gs.playerList.length).toBe(3)
    expect(gs.playerList.filter((p) => p.isAi).length).toBe(2)
    // 真人先手打一张合法牌（若有），然后观察 AI 是否行动（回合被推进）
    const me = gs.playerList.find((p) => !p.isAi)
    if (gs.currentTurnPlayerId === me.playerId && gs.hands.length) {
      const top = gs.topCard
      const playable = gs.hands.find(
        (h) => h.suit !== 'jokerRed' && h.suit !== 'jokerBlack' && (canFollowRank(top.rank, h.rank))
      )
      if (playable) {
        const r = await emit(c, 'playCard', { singleGameId: sid, cardId: playable.cardId })
        expect(r.code).toBe(0)
      } else {
        // 无可接牌：过牌推给 AI
        const r = await emit(c, 'passCard', { singleGameId: sid, discardCardId: gs.hands[0].cardId })
        expect(r.code).toBe(0)
      }
    }
    // 等 AI 行动产生的 gameUpdate（AI 延迟 800ms）
    const update = await waitEvent(c, 'gameUpdate', 5000)
    expect(update.lastOperate).toBeTruthy()
    c.close()
  })

  it('出牌错误码：E-01 非本回合 / E-02 卡牌不存在', async () => {
    const c = await connect()
    const gsPromise = waitEvent(c, 'gameStart')
    const res = await emit(c, 'createSingleGame', { gameMode: 1, aiCount: 1 })
    const sid = res.data.singleGameId
    const gs = await gsPromise
    const me = gs.playerList.find((p) => !p.isAi)
    if (gs.currentTurnPlayerId !== me.playerId) {
      const r = await emit(c, 'playCard', { singleGameId: sid, cardId: 'heart-2' })
      expect(r.code).toBe(3001)
    } else {
      const r = await emit(c, 'playCard', { singleGameId: sid, cardId: 'heart-99' })
      expect(r.code).toBe(1002)
      // E-03：非法提交不消耗回合，状态未变
      const st = await emit(c, 'getGameState', { singleGameId: sid })
      expect(st.data.currentTurnPlayerId).toBe(me.playerId)
    }
    c.close()
  })
})

describe('Room 纯逻辑（房主顺延/销毁）', () => {
  it('房主退出后顺延到下一位（E-07）', () => {
    const room = new Room('Rtest1', { isSingle: false })
    room.io = { to: () => ({ emit: () => {} }) }
    const p1 = room.addPlayer(null, { userId: 'a', nickname: 'A' })
    const p2 = room.addPlayer(null, { userId: 'b', nickname: 'B' })
    room.ownerUserId = 'a'
    room.removePlayer(p1)
    expect(room.ownerUserId).toBe('b')
    expect(p2.isReady).toBe(false)
  })
})

// 与 deck 测试重复引入的辅助：环形接续判定
function canFollowRank(topRank, newRank) {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  const ti = RANKS.indexOf(topRank)
  const ni = RANKS.indexOf(newRank)
  if (ti === -1 || ni === -1) return false
  const diff = (ni - ti + RANKS.length) % RANKS.length
  return diff === 1 || diff === RANKS.length - 1
}
