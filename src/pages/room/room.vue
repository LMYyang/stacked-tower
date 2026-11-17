<template>
  <view class="container">
    <view class="room-head">
      <view class="room-code-box">
        <text class="room-label">房间号</text>
        <text class="room-code">{{ roomCode }}</text>
      </view>
      <button class="btn-copy" size="mini" @click="copyCode">复制</button>
    </view>

    <view class="mode-info">
      {{ gameMode === 1 ? '标准局 · 目标 8 层' : '快速局 · 目标 6 层' }}｜{{ playerList.length }}/{{ maxPlayer }} 人
    </view>

    <view class="player-list">
      <view v-for="p in playerList" :key="p.userId" class="player-item" :class="{ offline: p.isOffline }">
        <view class="p-left">
          <view class="p-icon">{{ p.userId === ownerUserId ? '👑' : (p.isAi ? '🤖' : '👤') }}</view>
          <view>
            <view class="p-name">{{ p.nickname }} <text v-if="isMe(p)" class="me-tag">(我)</text></view>
            <view class="p-status">
              {{ p.isAi ? 'AI 队友' : (p.isOffline ? '已离线' : (p.isReady ? '已准备' : '等待准备…')) }}
            </view>
          </view>
        </view>
        <view class="ready-dot" :class="{ on: p.isReady }">{{ p.isReady ? '✓' : '' }}</view>
      </view>
    </view>

    <view class="btn-area">
      <button
        v-if="!isOwner"
        class="btn primary"
        :class="{ ready: isReady }"
        @click="toggleReady"
      >{{ isReady ? '取消准备' : '准 备' }}</button>
      <button v-if="isOwner" class="btn primary" :disabled="!canStart" @click="startGame">
        {{ canStart ? '开始游戏' : '等待全员准备' }}
      </button>
      <button class="btn" @click="leaveRoom">退出房间</button>
      <button v-if="isOwner" class="btn danger" @click="dismissRoom">解散房间</button>
    </view>
  </view>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ensureSocket, getAuth } from '@/utils/socket.js'

const socket = ensureSocket()
const props = defineProps({ roomId: { type: String, default: '' } })

const roomCode = ref('')
const playerList = ref([])
const ownerUserId = ref('')
const gameMode = ref(1)
const maxPlayer = ref(4)
const myUserId = ref('')

const isOwner = computed(() => ownerUserId.value === myUserId.value)
const isReady = computed(() => playerList.value.find((p) => p.userId === myUserId.value)?.isReady || false)
const canStart = computed(() => playerList.value.length >= 2 && playerList.value.every((p) => p.isReady))

const isMe = (p) => p.userId === myUserId.value

onMounted(() => {
  myUserId.value = getAuth().userId || socket.auth?.userId
  socket.on('roomChange', onRoomChange)
  socket.on('roomDismiss', onDismiss)
})

onUnmounted(() => {
  socket.off('roomChange', onRoomChange)
  socket.off('roomDismiss', onDismiss)
})

function onRoomChange(data) {
  if (data.roomId !== props.roomId) return
  playerList.value = data.playerList
  roomCode.value = data.roomCode || data.roomId.slice(1)
  ownerUserId.value = data.ownerUserId
  gameMode.value = data.gameMode || 1
  maxPlayer.value = data.maxPlayer || 4
  if (data.gameStatus === 'gaming') {
    uni.redirectTo({ url: `/pages/game/game?roomId=${props.roomId}` })
  }
}

function onDismiss() {
  uni.showToast({ title: '房间已解散', icon: 'none' })
  setTimeout(() => uni.navigateBack(), 800)
}

const copyCode = () => {
  uni.setClipboardData({ data: roomCode.value })
}

const toggleReady = () => {
  socket.emit('playerReady', { roomId: props.roomId, isReady: !isReady.value })
}

const startGame = () => {
  if (!canStart.value) return
  socket.emit('startGame', { roomId: props.roomId }, (res) => {
    if (res.code !== 0) uni.showToast({ title: res.msg || '开局失败', icon: 'none' })
  })
}

const leaveRoom = () => {
  socket.emit('leaveRoom', { roomId: props.roomId }, () => {
    uni.navigateBack()
  })
}

const dismissRoom = () => {
  uni.showModal({
    title: '解散房间',
    content: '确定解散该房间？所有玩家将被移出。',
    success: (r) => {
      if (r.confirm) {
        socket.emit('dismissRoom', { roomId: props.roomId }, () => uni.navigateBack())
      }
    },
  })
}
</script>
<style scoped>
.container { padding: 30rpx; min-height: 100vh; background: #f4f5fa; }
.room-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }
.room-code-box {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx 30rpx;
  flex: 1;
  margin-right: 16rpx;
  display: flex;
  align-items: baseline;
  gap: 16rpx;
}
.room-label { font-size: 26rpx; color: #888; }
.room-code { font-size: 48rpx; font-weight: bold; color: #4a3f8f; letter-spacing: 4rpx; }
.btn-copy { background: #4a3f8f; color: #fff; border-radius: 12rpx; }
.mode-info { font-size: 24rpx; color: #888; margin-bottom: 20rpx; }
.player-list { background: #fff; border-radius: 16rpx; overflow: hidden; }
.player-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.player-item.offline { opacity: 0.5; }
.p-left { display: flex; align-items: center; gap: 16rpx; }
.p-icon { font-size: 36rpx; }
.p-name { font-size: 30rpx; color: #333; }
.me-tag { font-size: 22rpx; color: #2b7cff; }
.p-status { font-size: 22rpx; color: #999; margin-top: 4rpx; }
.ready-dot {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: #eee;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
}
.ready-dot.on { background: #4caf50; }
.btn-area { margin-top: 40rpx; padding: 0 20rpx; }
.btn {
  margin: 16rpx 0;
  border-radius: 16rpx;
  background: #fff;
  color: #4a3f8f;
  font-size: 30rpx;
  border: none;
}
.btn.primary { background: #4a3f8f; color: #fff; }
.btn.primary.ready { background: #4caf50; color: #fff; }
.btn.primary[disabled] { background: #c5c2dd; color: #fff; }
.btn.danger { color: #d32f2f; }
</style>
