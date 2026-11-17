import { io } from 'socket.io-client'

// 服务器地址：与叠塔服务器（server/index.js）对应。部署时改为服务器 IP/域名。
const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL || 'http://127.0.0.1:3000'

let socket = null
let currentUserId = null
let currentNickname = null

function randomUser() {
  const uid = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 10000)
  return { userId: uid, nickname: '玩家' + Math.floor(Math.random() * 1000) }
}

function connect({ userId, nickname, platform = 'h5' }) {
  if (socket) socket.disconnect()
  currentUserId = userId
  currentNickname = nickname
  socket = io(SOCKET_URL, { autoConnect: true, reconnection: true })
  socket.on('connect', () => {
    socket.emit('auth', { userId, nickname, platform }, () => {})
  })
  return socket
}

/** 惰性建连：游客身份，全站共用一条连接 */
export function ensureSocket() {
  if (socket) return socket
  const u = randomUser()
  return connect({ ...u, platform: 'h5' })
}

export function getSocket() {
  return socket
}

export function getAuth() {
  return { userId: currentUserId, nickname: currentNickname }
}

export function closeSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
