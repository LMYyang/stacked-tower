<template>
  <view class="container">
    <view class="hero">
      <view class="title">叠塔</view>
      <view class="subtitle">全队协作 · 把塔搭到目标层数</view>
    </view>

    <view class="menu">
      <button class="btn primary" @click="createRoom">创建好友房</button>
      <button class="btn" @click="showJoin = !showJoin">输入房间号加入</button>
      <view v-if="showJoin" class="join-box">
        <input v-model="roomCode" class="input" type="text" maxlength="10" placeholder="输入房间号" />
        <button class="btn primary" :disabled="!roomCode" @click="doJoin">加入</button>
      </view>
      <button class="btn" @click="createSingle(1)">单机模式（1 AI 队友）</button>
      <button class="btn" @click="createSingle(2)">单机模式（2 AI 队友）</button>
    </view>

    <view class="rules">
      <view class="rule-title">玩法速览</view>
      <view class="rule-item">· 点数比塔顶大 1 或小 1 才能叠放（K 接 A、A 接 K）</view>
      <view class="rule-item">· 每叠满 3 层，下一张必须与塔顶异色</view>
      <view class="rule-item">· 同色强叠 = 塔崩塌 1 次，全队共 3 次机会</view>
      <view class="rule-item">· 小王安全换塔顶；大王清塔重来但崩塌 +1</view>
      <view class="rule-item">· 搭到 8 层全队胜利！</view>
    </view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { ensureSocket } from '@/utils/socket.js'

const roomCode = ref('')
const showJoin = ref(false)
const socket = ensureSocket()

const createRoom = () => {
  uni.showLoading({ title: '创建中' })
  socket.emit('createRoom', { gameMode: 1, maxPlayer: 4 }, (res) => {
    uni.hideLoading()
    if (res.code === 0) {
      uni.navigateTo({ url: `/pages/room/room?roomId=${res.data.roomId}` })
    } else {
      uni.showToast({ title: res.msg || '创建失败', icon: 'none' })
    }
  })
}
const doJoin = () => {
  if (!roomCode.value) return
  socket.emit('joinRoom', { roomCode: roomCode.value.trim() }, (res) => {
    if (res.code === 0) {
      uni.navigateTo({ url: `/pages/room/room?roomId=${res.data.roomId}` })
    } else {
      uni.showToast({ title: res.msg || '加入失败', icon: 'none' })
    }
  })
}
const createSingle = (aiCount) => {
  uni.showLoading({ title: '开局中' })
  socket.emit('createSingleGame', { gameMode: 1, aiCount }, (res) => {
    uni.hideLoading()
    if (res.code === 0) {
      uni.navigateTo({ url: `/pages/game/game?singleGameId=${res.data.singleGameId}` })
    } else {
      uni.showToast({ title: res.msg || '创建失败', icon: 'none' })
    }
  })
}
</script>
<style scoped>
.container {
  padding: 40rpx;
  min-height: 100vh;
  background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
}
.hero { text-align: center; margin: 60rpx 0; }
.title {
  font-size: 72rpx;
  color: #fff;
  font-weight: bold;
  letter-spacing: 12rpx;
  text-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.3);
}
.subtitle { color: rgba(255, 255, 255, 0.85); font-size: 26rpx; margin-top: 12rpx; }
.menu { margin: 0 20rpx; }
.btn {
  margin: 20rpx 0;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.92);
  color: #4a3f8f;
  font-size: 30rpx;
  font-weight: 500;
  border: none;
}
.btn.primary { background: #ffd54f; color: #5d4037; }
.join-box {
  background: rgba(255, 255, 255, 0.92);
  border-radius: 16rpx;
  padding: 20rpx;
  margin: 10rpx 0;
}
.input {
  border: 2rpx solid #ddd;
  padding: 16rpx;
  border-radius: 10rpx;
  margin-bottom: 16rpx;
  font-size: 30rpx;
}
.rules {
  margin: 40rpx 20rpx 0;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 16rpx;
  padding: 24rpx;
}
.rule-title { color: #fff; font-weight: bold; margin-bottom: 12rpx; font-size: 28rpx; }
.rule-item { color: rgba(255, 255, 255, 0.9); font-size: 24rpx; line-height: 1.8; }
</style>
