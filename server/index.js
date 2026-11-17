/**
 * 叠塔联网服务器（Socket.IO，服务端唯一权威 —— 需求 1.1/15.1）。
 * 职责：房间组织、开局发牌、回合轮转、出牌/过牌校验（复用 src/core）、
 *       崩塌与胜负判定广播、AI 队友与掉线托管、断线重连恢复。
 * 客户端只上报操作意图，所有判定一律服务端完成（需求 1.1 硬性原则）。
 *
 * 事件清单见需求 15.3（表13）；错误码见 15.5（表14）。
 */

import { Server } from 'socket.io'
import http from 'node:http'
import path from 'node:path'
import { createGame, startGame, playCard, passCard, viewOf } from '../src/core/game.js'
import { aiDecide } from '../src/core/ai.js'
import { GAME_MODE_STANDARD, MAX_COLLAPSE } from '../src/core/settings.js'
import { isJoker } from '../src/core/deck.js'

const AI_DELAY_MS = 800 // AI 固定延迟（需求 11.3），让真人看清 AI 操作
const TURN_TIMEOUT_MS = 30_000 // 回合决策时限（需求 3.1），超时按过牌处理
const OFFLINE_AI_DELAY_MS = 1_500 // 掉线托管稍微慢一点，界面可感知

const rooms = new Map() // roomId -> Room（好友房/匹配房共用）
const singleGames = new Map() // singleGameId -> Room（单机合作）
const socketIndex = new Map() // socket.id -> { room, seat } 反查索引

function log(...args) {
  console.log('[stacked-tower]', ...args)
}

export class Room {
  constructor(roomId, { gameMode = GAME_MODE_STANDARD, maxPlayer = 4, isSingle = false } = {}) {
    this.roomId = roomId
    this.gameMode = gameMode
    this.maxPlayer = maxPlayer
    this.isSingle = isSingle
    this.ownerUserId = null
    this.players = [] // { seat, userId, nickname, isReady, isOffline, isAi, socket, handCards, aiTimer, turnTimer, offlineTimer }
    this.gameStatus = 'wait' // wait | gaming | settle
    this.game = null
    this.io = null
  }

  /** 开局（需求第5章）：构建 core 状态机并广播初始状态 */
  startGame() {
    this.game = createGame(this.gameMode, Math.random)
    startGame(this.game, this.players.length)
    this.players.forEach((p, seat) => {
      p.seat = seat
      p.handCards = this.game.hands[seat]
    })
    this.gameStatus = 'gaming'
    this.broadcastGameStart()
    this.armTurnTimer()
    this.maybeAiAct()
  }

  seatOf(userId) {
    return this.players.find((p) => p.userId === userId)
  }

  broadcast(event, data) {
    this.io.to(this.roomId).emit(event, data)
  }

  /** 组装对局状态（附录B）：手牌只下发本人，他人仅数量（需求 3.3 隐私约束） */
  buildGameData(viewerSeat = null) {
    const v = viewOf(this.game, viewerSeat)
    return {
      roomId: this.roomId,
      singleGameId: this.isSingle ? this.roomId : undefined,
      gameMode: v.gameMode,
      gameStatus: this.gameStatus,
      state: v.state,
      targetLayer: v.targetLayer,
      towerLayer: v.towerLayer,
      topCard: v.topCard,
      collapseCount: v.collapseCount,
      maxCollapse: MAX_COLLAPSE,
      needColorCheck: v.needColorCheck,
      drawPileCount: v.drawPileCount,
      discardPile: v.discardPile,
      currentTurnPlayerId: v.currentTurn,
      lastOperate: v.lastOperate,
      collapseHistory: v.collapseHistory,
      result: v.result,
      hands: v.hands || [], // 本人手牌明细（仅按人下发时携带）
      playerList: this.players.map((p) => {
        const obj = {
          playerId: p.seat,
          userId: p.userId,
          nickname: p.nickname,
          isOffline: p.isOffline,
          isAi: p.isAi,
          isReady: p.isReady,
        }
        if (viewerSeat !== null && p.seat === viewerSeat) obj.handCards = [...p.handCards]
        else obj.handCardCount = p.handCards ? p.handCards.length : 0
        return obj
      }),
    }
  }

  broadcastGameStart() {
    // gameStart 按人各发一份（各自带手牌明细），不走房间广播
    for (const p of this.players) {
      if (p.socket) p.socket.emit('gameStart', this.buildGameData(p.seat))
    }
  }

  /** gameUpdate 按人各发一份（手牌隐私隔离） */
  broadcastUpdate() {
    for (const p of this.players) {
      if (p.socket) p.socket.emit('gameUpdate', this.buildGameData(p.seat))
    }
  }

  armTurnTimer() {
    // 回合时限（需求 3.1）：超时按过牌处理，不判负。AI 回合不需要定时器。
    for (const p of this.players) clearTimeout(p.turnTimer)
    if (this.gameStatus !== 'gaming' || !this.game || this.game.state !== 'PLAYING') return
    const cur = this.players[this.game.currentTurn]
    if (!cur || cur.isAi) return
    cur.turnTimer = setTimeout(() => {
      if (this.gameStatus !== 'gaming' || this.game.state !== 'PLAYING') return
      if (this.game.currentTurn !== cur.seat) return
      log(`seat ${cur.seat} 回合超时，自动过牌`)
      this.doTimeoutPass(cur)
    }, cur.isOffline ? OFFLINE_AI_DELAY_MS : TURN_TIMEOUT_MS)
  }

  /** 超时托管：优先弃一张最差牌（复用 AI 决策），无牌可弃则直接轮转 */
  doTimeoutPass(player) {
    const d = aiDecide(this.game, player.seat, 'easy')
    let res
    if (d.action === 'play') {
      res = this.applyPlay(player, d.cardId, d.replaceCardId, true)
    } else if (d.discardCardId && player.handCards.some((c) => c.cardId === d.discardCardId)) {
      res = this.applyPass(player, d.discardCardId, true)
    } else {
      // 无牌可弃：直接轮转并提示（需求第10章，避免玩家卡死在无法操作的界面）
      this.game.lastOperate = { seat: player.seat, type: 'passCard', result: 'success', msg: '无牌可弃，跳过回合' }
      this.game.currentTurn = (player.seat + 1) % this.players.length
      res = { ok: true }
    }
    if (res && res.settle) this.broadcastSettle()
    else {
      this.broadcastUpdate()
      this.armTurnTimer()
      this.maybeAiAct()
    }
  }

  maybeAiAct() {
    if (this.gameStatus !== 'gaming' || !this.game || this.game.state !== 'PLAYING') return
    const cur = this.players[this.game.currentTurn]
    if (!cur || !cur.isAi) return
    clearTimeout(cur.aiTimer)
    cur.aiTimer = setTimeout(() => this.aiAction(cur), AI_DELAY_MS)
  }

  /** AI 决策并落子（复用与真人相同的校验函数 —— 需求 11.1） */
  aiAction(player) {
    if (this.gameStatus !== 'gaming' || this.game.state !== 'PLAYING') return
    if (this.game.currentTurn !== player.seat) return
    const d = aiDecide(this.game, player.seat, 'hard')
    let res
    if (d.action === 'play') res = this.applyPlay(player, d.cardId, d.replaceCardId, false)
    else res = this.applyPass(player, d.discardCardId, false)
    if (res && res.settle) this.broadcastSettle()
    else {
      this.broadcastUpdate()
      this.armTurnTimer()
      this.maybeAiAct()
    }
  }

  /** 出牌落子（core 校验 + 广播 + 结算判定） */
  applyPlay(player, cardId, replaceCardId, isAuto) {
    const res = playCard(this.game, player.seat, cardId, replaceCardId)
    if (!res.ok) return res
    this.syncHandsFromCore()
    if (res.settle || this.game.state === 'SETTLE') {
      this.gameStatus = 'settle'
      return { ok: true, settle: this.game.result, isAuto }
    }
    return { ok: true, isAuto }
  }

  /** 过牌落子 */
  applyPass(player, discardCardId, isAuto) {
    const res = passCard(this.game, player.seat, discardCardId)
    if (!res.ok) return res
    this.syncHandsFromCore()
    // 过牌也可能触发结算（全员手牌耗尽，需求第10章资源枯竭）
    if (res.settle || this.game.state === 'SETTLE') {
      this.gameStatus = 'settle'
      return { ok: true, settle: this.game.result, isAuto }
    }
    return { ok: true, isAuto }
  }

  /** core.hands 与 players.handCards 保持同一引用（startGame 时已对齐，出牌后重同步数量） */
  syncHandsFromCore() {
    this.players.forEach((p, seat) => {
      p.handCards = this.game.hands[seat]
    })
  }

  broadcastSettle() {
    this.gameStatus = 'settle'
    for (const p of this.players) clearTimeout(p.turnTimer)
    for (const p of this.players) {
      if (p.socket) p.socket.emit('gameSettle', this.buildGameData(p.seat))
    }
    log(`room ${this.roomId} 结算:`, this.game.result && this.game.result.settleResult)
  }

  addPlayer(socket, { userId, nickname }) {
    const seat = this.players.length
    const p = {
      seat,
      userId,
      nickname,
      isReady: seat === 0, // 房主默认已准备（需求 4.2）
      isOffline: false,
      isAi: false,
      socket,
      handCards: [],
      aiTimer: null,
      turnTimer: null,
      offlineTimer: null,
    }
    this.players.push(p)
    if (socket) {
      socket.join(this.roomId)
      socketIndex.set(socket.id, { room: this, seat })
    }
    return p
  }

  addAi(nickname) {
    const seat = this.players.length
    this.players.push({
      seat,
      userId: `ai_${this.roomId}_${seat}`,
      nickname,
      isReady: true,
      isOffline: false,
      isAi: true,
      socket: null,
      handCards: [],
      aiTimer: null,
      turnTimer: null,
      offlineTimer: null,
    })
  }

  /** 房主顺延（需求 4.2）：房主退出后按加入顺序交给下一位 */
  reassignOwner() {
    if (this.players.length === 0) return
    if (this.players.some((p) => p.userId === this.ownerUserId)) return
    this.ownerUserId = this.players[0].userId
  }

  /** 玩家离线（需求 4.2/11.3）：标记离线，超时后按托管过牌（复用 AI 决策器） */
  markOffline(player) {
    player.socket = null
    player.isOffline = true
    clearTimeout(player.turnTimer)
    this.broadcastRoomChange()
    this.broadcast('playerAutoAi', { playerId: player.seat, msg: `队友${player.nickname}已离线，由系统托管` })
    // 轮到离线玩家时由 armTurnTimer 用短超时（OFFLINE_AI_DELAY_MS）自动托管，
    // 未轮到时保持原节奏；重连后 rebindSocket 恢复人工操作
    if (this.gameStatus === 'gaming' && this.game && this.game.currentTurn === player.seat) {
      this.armTurnTimer()
    }
  }

  /** 重连恢复（E-04）：换绑 socket，恢复人工操作 */
  rebindSocket(player, socket) {
    player.socket = socket
    player.isOffline = false
    clearTimeout(player.offlineTimer)
    socket.join(this.roomId)
    socketIndex.set(socket.id, { room: this, seat: player.seat })
    this.broadcastRoomChange()
  }

  removePlayer(player) {
    clearTimeout(player.aiTimer)
    clearTimeout(player.turnTimer)
    clearTimeout(player.offlineTimer)
    if (player.socket) socketIndex.delete(player.socket.id)
    this.players = this.players.filter((p) => p !== player)
    this.reassignOwner()
  }

  broadcastRoomChange() {
    this.broadcast('roomChange', {
      roomId: this.roomId,
      singleGameId: this.isSingle ? this.roomId : undefined,
      roomCode: this.roomId.slice(1),
      ownerUserId: this.ownerUserId,
      gameMode: this.gameMode,
      maxPlayer: this.maxPlayer,
      gameStatus: this.gameStatus,
      playerList: this.players.map((p) => ({
        playerId: p.seat,
        userId: p.userId,
        nickname: p.nickname,
        isReady: p.isReady,
        isOffline: p.isOffline,
        isAi: p.isAi,
      })),
    })
  }

  destroy() {
    for (const p of this.players) {
      clearTimeout(p.aiTimer)
      clearTimeout(p.turnTimer)
      clearTimeout(p.offlineTimer)
    }
    this.players = []
  }
}

export function createServerApp({ port = 3000 } = {}) {
  const httpServer = http.createServer()
  const io = new Server(httpServer, { cors: true })
  io.rooms = rooms // 测试注入用
  io.singleGames = singleGames

  const findGame = (data) => {
    const room = data.roomId ? rooms.get(data.roomId) : null
    const single = !room && data.singleGameId ? singleGames.get(data.singleGameId) : null
    return room || single || null
  }

  io.on('connection', (socket) => {
    let auth = { userId: null, nickname: '玩家' }
    log('connect', socket.id)

    socket.on('auth', (data = {}, cb = () => {}) => {
      auth = { userId: data.userId || `u_${socket.id}`, nickname: data.nickname || '玩家', platform: data.platform || 'h5' }
      cb({ code: 0, msg: 'success', data: { token: socket.id } })
    })

    socket.on('createRoom', (data = {}, cb = () => {}) => {
      const rid = 'R' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
      const room = new Room(rid, {
        gameMode: data.gameMode || GAME_MODE_STANDARD,
        maxPlayer: data.maxPlayer || 4,
        isSingle: false,
      })
      room.io = io
      room.ownerUserId = auth.userId
      room.addPlayer(socket, auth)
      rooms.set(rid, room)
      cb({ code: 0, msg: '创建成功', data: { roomId: rid, roomCode: rid.slice(1) } })
      room.broadcastRoomChange()
    })

    socket.on('joinRoom', (data = {}, cb = () => {}) => {
      const room = rooms.get('R' + data.roomCode)
      if (!room) return cb({ code: 2001, msg: '房间不存在' })
      if (room.gameStatus !== 'wait') return cb({ code: 1001, msg: '对局已开始，无法加入' }) // E-06
      if (room.players.length >= room.maxPlayer) return cb({ code: 2002, msg: '房间已满' })
      room.addPlayer(socket, auth)
      cb({ code: 0, msg: '加入成功', data: { roomId: room.roomId, roomCode: room.roomId.slice(1) } })
      room.broadcastRoomChange()
    })

    socket.on('playerReady', (data = {}, cb = () => {}) => {
      const room = findGame(data) || rooms.get(data.roomId)
      if (!room) return cb({ code: 2001, msg: '房间不存在' })
      const p = room.seatOf(auth.userId)
      if (!p) return cb({ code: 1001, msg: '不在房间内' })
      p.isReady = !!data.isReady
      cb({ code: 0 })
      room.broadcastRoomChange()
    })

    socket.on('leaveRoom', (data = {}, cb = () => {}) => {
      const room = rooms.get(data.roomId)
      if (!room) return cb({ code: 2001 })
      const p = room.seatOf(auth.userId)
      if (!p) return cb({ code: 1001 })
      room.removePlayer(p)
      cb({ code: 0 })
      if (room.players.length === 0) {
        rooms.delete(room.roomId)
        room.destroy()
        log(`room ${room.roomId} 已空解散`)
      } else {
        room.broadcastRoomChange()
      }
    })

    socket.on('dismissRoom', (data = {}, cb = () => {}) => {
      const room = rooms.get(data.roomId)
      if (!room) return cb({ code: 2001 })
      if (room.ownerUserId !== auth.userId) return cb({ code: 1001, msg: '仅房主可解散' })
      room.broadcast('roomDismiss', { msg: '房主已解散房间' })
      rooms.delete(room.roomId)
      room.destroy()
      cb({ code: 0 })
    })

    socket.on('startGame', (data = {}, cb = () => {}) => {
      const room = rooms.get(data.roomId)
      if (!room) return cb({ code: 2001, msg: '房间不存在' })
      if (room.ownerUserId !== auth.userId) return cb({ code: 1001, msg: '仅房主可开局' })
      const allReady = room.players.every((p) => p.isReady)
      if (room.players.length < 2 || !allReady) return cb({ code: 1001, msg: '人数不足或有人未准备' }) // 需求4.2
      room.startGame()
      cb({ code: 0 })
    })

    socket.on('createSingleGame', (data = {}, cb = () => {}) => {
      const sid = 'S' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
      const room = new Room(sid, {
        gameMode: data.gameMode || GAME_MODE_STANDARD,
        maxPlayer: (data.aiCount || 1) + 1,
        isSingle: true,
      })
      room.io = io
      room.ownerUserId = auth.userId
      room.addPlayer(socket, auth)
      const aiCount = Math.min(3, Math.max(1, data.aiCount || 1))
      for (let i = 1; i <= aiCount; i++) room.addAi(`AI队友${i}`)
      singleGames.set(sid, room)
      room.startGame()
      cb({ code: 0, msg: 'ok', data: { singleGameId: sid } })
    })

    socket.on('getGameState', (data = {}, cb = () => {}) => {
      const room = findGame(data)
      if (!room) return cb({ code: 2001, msg: '对局不存在' })
      const p = room.seatOf(auth.userId)
      cb({ code: 0, data: room.buildGameData(p ? p.seat : null) })
    })

    socket.on('playCard', (data = {}, cb = () => {}) => {
      const room = findGame(data)
      if (!room) return cb({ code: 2001, msg: '对局不存在' })
      if (room.gameStatus !== 'gaming') return cb({ code: 1001, msg: '对局未开始' })
      const p = room.seatOf(auth.userId)
      if (!p) return cb({ code: 1001, msg: '不在对局中' })
      if (p.isOffline) return cb({ code: 1001, msg: '已离线托管中' })
      const res = room.applyPlay(p, data.cardId, data.replaceCardId || null, false)
      if (!res.ok) return cb({ code: res.code || 1002, msg: res.reason })
      cb({ code: 0 })
      if (res.settle) room.broadcastSettle()
      else {
        room.broadcastUpdate()
        room.armTurnTimer()
        room.maybeAiAct()
      }
    })

    socket.on('passCard', (data = {}, cb = () => {}) => {
      const room = findGame(data)
      if (!room) return cb({ code: 2001, msg: '对局不存在' })
      if (room.gameStatus !== 'gaming') return cb({ code: 1001, msg: '对局未开始' })
      const p = room.seatOf(auth.userId)
      if (!p) return cb({ code: 1001, msg: '不在对局中' })
      if (p.isOffline) return cb({ code: 1001, msg: '已离线托管中' })
      const res = room.applyPass(p, data.discardCardId, false)
      if (!res.ok) return cb({ code: res.code || 1002, msg: res.reason })
      cb({ code: 0 })
      if (res.settle) room.broadcastSettle()
      else {
        room.broadcastUpdate()
        room.armTurnTimer()
        room.maybeAiAct()
      }
    })

    socket.on('disconnect', () => {
      log('disconnect', socket.id)
      const entry = socketIndex.get(socket.id)
      if (!entry) return
      socketIndex.delete(socket.id)
      const { room, seat } = entry
      const p = room.players.find((x) => x.seat === seat)
      if (!p) return
      p.socket = null
      if (room.isSingle) {
        // 单机局：真人退出即整局销毁（AI 无需继续）
        singleGames.delete(room.roomId)
        room.destroy()
        return
      }
      if (room.gameStatus === 'wait') {
        // 等待期退出：房主顺延或解散（E-07）
        room.removePlayer(p)
        if (room.players.length === 0) {
          rooms.delete(room.roomId)
          room.destroy()
          log(`room ${room.roomId} 已空解散`)
        } else {
          room.broadcastRoomChange()
        }
      } else {
        // 对局中掉线：标记离线并托管（E-05）
        room.markOffline(p)
      }
    })
  })

  httpServer.listen(port, () => log(`✅ 叠塔服务器: http://127.0.0.1:${port}`))
  return { httpServer, io, rooms, singleGames }
}

// 直接运行时启动；被测试 import 时不自动监听
import { pathToFileURL } from 'node:url'
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain || process.env.STACKED_TOWER_START === '1') {
  const port = Number(process.env.PORT) || 3000
  createServerApp({ port })
}
