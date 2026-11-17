<template>
  <view class="game">
    <!-- 顶部状态栏：崩塌计数 + 层数常驻（需求 13.1） -->
    <view class="topbar">
      <view class="collapse-box">
        <view class="collapse-dots">
          <view v-for="i in maxCollapse" :key="i" class="dot" :class="{ used: i <= collapseCount }" />
        </view>
        <text class="collapse-text">崩塌 {{ collapseCount }}/{{ maxCollapse }}</text>
      </view>
      <view class="layer-box">
        <text class="layer-text">{{ towerLayer }} / {{ targetLayer }} 层</text>
        <view class="layer-bar">
          <view class="layer-fill" :style="{ width: (towerLayer / targetLayer * 100) + '%' }" />
        </view>
      </view>
    </view>

    <!-- 塔区 -->
    <view class="tower-area">
      <view v-if="needColorCheck" class="color-alert">⚠ 下一张必须打出异色牌</view>
      <view class="tower-display">
        <view class="tower-stack">
          <view v-for="i in towerLayer" :key="i" class="tower-layer-block" :class="{ top: i === towerLayer }">
            <text v-if="i === towerLayer && topCard">{{ topRankText }}</text>
          </view>
        </view>
        <view v-if="topCard" class="top-card-box">
          <CardItem :cardInfo="topCard" />
          <view class="draw-info">牌堆剩 {{ drawPileCount }}</view>
        </view>
      </view>
      <view class="turn-hint" :class="{ mine: isMyTurn }">
        {{ turnHintText }}
      </view>
    </view>

    <!-- 他人手牌数量 -->
    <view class="others">
      <view v-for="p in otherPlayers" :key="p.playerId" class="other-p" :class="{ active: currentTurnPlayerId === p.playerId, offline: p.isOffline }">
        <text>{{ p.isAi ? '🤖' : '👤' }} {{ p.nickname }}</text>
        <text class="hand-count">{{ p.handCardCount }} 张</text>
      </view>
    </view>

    <!-- 操作日志 -->
    <view v-if="lastOperate" class="operate-log" :class="lastOperate.result">
      {{ lastOperateText }}
    </view>

    <!-- 手牌区（需求 13.1：屏幕下半部） -->
    <view class="hand-area">
      <view class="hand-scroll">
        <CardItem
          v-for="c in myHandCards"
          :key="c.cardId"
          :cardInfo="c"
          :selected="selectCard?.cardId === c.cardId"
          :disabled="isMyTurn && needColorCheck && !isJokerC(c) && c.color === topCard?.color"
          :hint="isMyTurn && !needColorCheck && canFollowTop(c)"
          @click="onSelectCard"
        />
      </view>
      <view v-if="myHandCards.length === 0" class="empty-hand">手牌已用完</view>
    </view>

    <!-- 操作按钮（仅本人回合可用，需求 13.3） -->
    <view class="btn-group">
      <button class="btn play" :disabled="!isMyTurn || !selectCard" @click="onPlay">出牌</button>
      <button class="btn pass" :disabled="!isMyTurn || !selectCard" @click="onPass">过牌（弃这张）</button>
    </view>

    <!-- 小王替换选择弹层（需求 7.1/13.3） -->
    <view v-if="showJokerSelect" class="mask" @click="cancelJokerSelect">
      <view class="pop" @click.stop>
        <view class="pop-title">小王生效，请选择一张手牌作为新塔顶</view>
        <view class="pop-hand">
          <CardItem
            v-for="c in jokerSelectList"
            :key="c.cardId"
            :cardInfo="c"
            :hint="true"
            @click="confirmJokerReplace"
          />
        </view>
        <button class="btn" @click="cancelJokerSelect">取消</button>
      </view>
    </view>

    <!-- 结算弹层（需求 9.2） -->
    <view v-if="settle" class="mask">
      <view class="pop settle-pop">
        <view class="settle-title" :class="settle.settleResult">
          {{ settle.settleResult === 'win' ? '🎉 挑战胜利' : '💥 挑战失败' }}
        </view>
        <view class="settle-msg">{{ settle.msg }}</view>
        <view class="settle-stats">
          <view>最终层数：{{ towerLayer }} / {{ targetLayer }}</view>
          <view>崩塌次数：{{ collapseCount }} / {{ maxCollapse }}</view>
        </view>
        <view v-if="collapseHistory.length" class="collapse-review">
          <view class="cr-title">崩塌复盘</view>
          <view v-for="(h, i) in collapseHistory" :key="i" class="cr-item">
            第 {{ h.layer }} 层 · {{ playerName(h.seat) }} · {{ h.msg }}
          </view>
        </view>
        <button v-if="isSingle" class="btn primary" @click="backHome">再来一局</button>
        <button v-else class="btn primary" @click="backRoom">返回房间</button>
      </view>
    </view>
  </view>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ensureSocket } from '@/utils/socket.js'
import CardItem from '@/components/CardItem.vue'

const socket = ensureSocket()
const props = defineProps({
  roomId: { type: String, default: '' },
  singleGameId: { type: String, default: '' },
})

const maxCollapse = ref(3)
const collapseCount = ref(0)
const towerLayer = ref(1)
const targetLayer = ref(8)
const needColorCheck = ref(false)
const topCard = ref(null)
const drawPileCount = ref(0)
const myHandCards = ref([])
const selectCard = ref(null)
const currentTurnPlayerId = ref(null)
const myPlayerId = ref(null)
const playerList = ref([])
const lastOperate = ref(null)
const collapseHistory = ref([])
const settle = ref(null)
const isSingle = computed(() => !!props.singleGameId)

const showJokerSelect = ref(false)
const jokerSelectList = ref([])
const pendingSmallJokerCardId = ref('')

const isJokerC = (c) => c.suit === 'jokerRed' || c.suit === 'jokerBlack'
const canFollowTop = (c) => {
  if (!topCard.value || isJokerC(c)) return false
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  const ti = RANKS.indexOf(topCard.value.rank)
  const ni = RANKS.indexOf(c.rank)
  if (ti === -1 || ni === -1) return false
  const diff = (ni - ti + 13) % 13
  return diff === 1 || diff === 12
}

const topRankText = computed(() => topCard.value?.rank || '')
const otherPlayers = computed(() => playerList.value.filter((p) => p.playerId !== myPlayerId.value))
const isMyTurn = computed(() => myPlayerId.value !== null && currentTurnPlayerId.value === myPlayerId.value && !settle.value)

const turnHintText = computed(() => {
  if (settle.value) return '对局已结束'
  if (isMyTurn.value) return '轮到你了，请出牌或过牌'
  const cur = playerList.value.find((p) => p.playerId === currentTurnPlayerId.value)
  return cur ? `等待 ${cur.nickname} 操作…` : '等待中…'
})
const lastOperateText = computed(() => {
  if (!lastOperate.value) return ''
  const p = playerList.value.find((x) => x.playerId === lastOperate.value.seat)
  return `${p ? p.nickname : '玩家'}：${lastOperate.value.msg}`
})

const playerName = (seat) => playerList.value.find((p) => p.playerId === seat)?.nickname || `玩家${seat}`

onMounted(() => {
  socket.on('gameStart', refreshGame)
  socket.on('gameUpdate', onGameUpdate)
  socket.on('gameSettle', onGameSettle)
  socket.on('playerAutoAi', (d) => uni.showToast({ title: d.msg || '队友离线，已托管', icon: 'none' }))
  fetchState()
})

onUnmounted(() => {
  socket.off('gameStart', refreshGame)
  socket.off('gameUpdate', onGameUpdate)
  socket.off('gameSettle', onGameSettle)
})

function fetchState() {
  // 重连/直刷恢复：拉取当前对局状态（E-04）
  const emitState = () => {
    socket.emit('getGameState', { roomId: props.roomId, singleGameId: props.singleGameId }, (res) => {
      if (res.code === 0 && res.data && res.data.gameStatus !== 'wait') refreshGame(res.data)
    })
  }
  if (socket.connected) emitState()
  else socket.once('connect', emitState)
}

function refreshGame(data) {
  if (!data || !data.playerList) return
  collapseCount.value = data.collapseCount
  maxCollapse.value = data.maxCollapse || 3
  towerLayer.value = data.towerLayer
  targetLayer.value = data.targetLayer
  needColorCheck.value = data.needColorCheck
  topCard.value = data.topCard
  drawPileCount.value = data.drawPileCount
  currentTurnPlayerId.value = data.currentTurnPlayerId
  playerList.value = data.playerList
  lastOperate.value = data.lastOperate
  collapseHistory.value = data.collapseHistory || []
  const me = data.playerList.find((p) => p.handCards)
  if (me) {
    myHandCards.value = me.handCards || []
    myPlayerId.value = me.playerId
  }
  selectCard.value = null
}

function onGameUpdate(data) {
  refreshGame(data)
}

function onGameSettle(data) {
  refreshGame(data)
  settle.value = data.result || { settleResult: data.settleResult, msg: data.msg }
}

function onSelectCard(c) {
  if (!isMyTurn.value) return
  if (c.suit === 'jokerRed') {
    // 小王：进入替换牌选择状态，未选定时不得提交（需求 13.3）
    pendingSmallJokerCardId.value = c.cardId
    jokerSelectList.value = myHandCards.value.filter((x) => !isJokerC(x) && x.cardId !== c.cardId)
    if (jokerSelectList.value.length === 0) {
      uni.showToast({ title: '没有普通手牌可作新塔顶', icon: 'none' })
      return
    }
    showJokerSelect.value = true
    return
  }
  selectCard.value = selectCard.value?.cardId === c.cardId ? null : c
}

function cancelJokerSelect() {
  showJokerSelect.value = false
  pendingSmallJokerCardId.value = ''
}

function emitPlay(cardId, replaceCardId) {
  socket.emit(
    'playCard',
    { roomId: props.roomId, singleGameId: props.singleGameId, cardId, replaceCardId },
    (res) => {
      if (res.code !== 0) uni.showToast({ title: res.msg || '操作失败', icon: 'none' })
    }
  )
}

const onPlay = () => {
  if (!selectCard.value) return
  emitPlay(selectCard.value.cardId, null)
}

const confirmJokerReplace = (replaceCard) => {
  showJokerSelect.value = false
  emitPlay(pendingSmallJokerCardId.value, replaceCard.cardId)
  pendingSmallJokerCardId.value = ''
}

const onPass = () => {
  if (!selectCard.value) return
  socket.emit(
    'passCard',
    { roomId: props.roomId, singleGameId: props.singleGameId, discardCardId: selectCard.value.cardId },
    (res) => {
      if (res.code !== 0) uni.showToast({ title: res.msg || '操作失败', icon: 'none' })
    }
  )
}

const backHome = () => {
  settle.value = null
  uni.redirectTo({ url: '/pages/index/index' })
}

const backRoom = () => {
  settle.value = null
  if (props.roomId) uni.redirectTo({ url: `/pages/room/room?roomId=${props.roomId}` })
  else uni.navigateBack()
}
</script>
<style scoped>
.game {
  min-height: 100vh;
  background: linear-gradient(180deg, #5b6abf 0%, #7a5fa0 100%);
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}
/* 顶部状态栏 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 24rpx;
}
.collapse-box { display: flex; align-items: center; gap: 12rpx; }
.collapse-dots { display: flex; gap: 8rpx; }
.dot {
  width: 24rpx;
  height: 24rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
}
.dot.used { background: #ff5252; box-shadow: 0 0 8rpx rgba(255, 82, 82, 0.8); }
.collapse-text { color: #fff; font-size: 24rpx; }
.layer-box { text-align: right; }
.layer-text { color: #fff; font-size: 26rpx; font-weight: bold; }
.layer-bar {
  width: 200rpx;
  height: 10rpx;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 6rpx;
  margin-top: 8rpx;
  overflow: hidden;
}
.layer-fill { height: 100%; background: #ffd54f; border-radius: 6rpx; transition: width 0.3s; }

/* 塔区 */
.tower-area {
  background: rgba(255, 255, 255, 0.12);
  margin: 0 24rpx;
  border-radius: 20rpx;
  padding: 20rpx;
  text-align: center;
}
.color-alert {
  background: #ff5252;
  color: #fff;
  font-size: 26rpx;
  padding: 10rpx;
  border-radius: 10rpx;
  margin-bottom: 16rpx;
  font-weight: bold;
}
.tower-display { display: flex; align-items: center; justify-content: center; gap: 30rpx; }
.tower-stack { display: flex; flex-direction: column-reverse; align-items: center; }
.tower-layer-block {
  width: 100rpx;
  height: 14rpx;
  background: rgba(255, 255, 255, 0.35);
  border-radius: 4rpx;
  margin-top: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tower-layer-block.top {
  height: 30rpx;
  background: #ffd54f;
  color: #5d4037;
  font-size: 22rpx;
  font-weight: bold;
}
.top-card-box { display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.draw-info { color: rgba(255, 255, 255, 0.7); font-size: 22rpx; }
.turn-hint {
  margin-top: 16rpx;
  color: rgba(255, 255, 255, 0.8);
  font-size: 26rpx;
}
.turn-hint.mine { color: #ffd54f; font-weight: bold; font-size: 30rpx; }

/* 他人手牌 */
.others {
  display: flex;
  justify-content: center;
  gap: 16rpx;
  padding: 16rpx 24rpx 0;
  flex-wrap: wrap;
}
.other-p {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 12rpx;
  padding: 8rpx 16rpx;
  color: rgba(255, 255, 255, 0.85);
  font-size: 22rpx;
  display: flex;
  gap: 10rpx;
  align-items: center;
}
.other-p.active { background: #ffd54f; color: #5d4037; font-weight: bold; }
.other-p.offline { opacity: 0.5; }
.hand-count { font-size: 22rpx; }

/* 操作日志 */
.operate-log {
  margin: 16rpx 24rpx 0;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 10rpx;
  padding: 12rpx 20rpx;
  font-size: 24rpx;
  color: #555;
  text-align: center;
}
.operate-log.collapse { background: #ffebee; color: #c62828; font-weight: bold; }
.operate-log.win { background: #e8f5e9; color: #2e7d32; font-weight: bold; }

/* 手牌区 */
.hand-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 16rpx 12rpx;
}
.hand-scroll {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  min-height: 180rpx;
  align-items: flex-end;
}
.empty-hand { color: rgba(255, 255, 255, 0.6); text-align: center; width: 100%; }

/* 按钮 */
.btn-group {
  display: flex;
  gap: 20rpx;
  padding: 16rpx 24rpx 30rpx;
}
.btn {
  flex: 1;
  border-radius: 16rpx;
  border: none;
  font-size: 30rpx;
  font-weight: bold;
  background: rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.5);
}
.btn.play { background: #ffd54f; color: #5d4037; }
.btn.play[disabled] { background: rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.4); }
.btn.pass { background: rgba(255, 255, 255, 0.9); color: #5b6abf; }
.btn.pass[disabled] { background: rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.4); }
.btn.primary { background: #ffd54f; color: #5d4037; margin-top: 20rpx; }

/* 弹层 */
.mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.pop {
  width: 85%;
  max-width: 600rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 36rpx;
}
.pop-title { font-size: 30rpx; font-weight: bold; color: #333; text-align: center; margin-bottom: 24rpx; }
.pop-hand { display: flex; flex-wrap: wrap; justify-content: center; margin-bottom: 20rpx; }
.settle-title { font-size: 48rpx; font-weight: bold; text-align: center; margin-bottom: 16rpx; }
.settle-title.win { color: #2e7d32; }
.settle-title.lose { color: #c62828; }
.settle-msg { text-align: center; color: #666; font-size: 28rpx; margin-bottom: 24rpx; }
.settle-stats {
  background: #f5f5f5;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 26rpx;
  color: #555;
  line-height: 1.8;
  margin-bottom: 20rpx;
}
.collapse-review { max-height: 300rpx; overflow-y: auto; }
.cr-title { font-weight: bold; font-size: 26rpx; color: #c62828; margin-bottom: 8rpx; }
.cr-item { font-size: 24rpx; color: #666; line-height: 1.7; }
</style>
