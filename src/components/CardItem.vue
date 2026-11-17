<template>
  <view class="card" :class="[colorClass, { selected, disabled, hint }]" @click="onClick">
    <view class="corner tl">{{ rankText }}</view>
    <view class="center-suit">{{ suitIcon }}</view>
    <view class="corner br">{{ rankText }}</view>
    <view v-if="jokerText" class="joker-text">{{ jokerText }}</view>
  </view>
</template>
<script setup>
import { computed } from 'vue'

const props = defineProps({
  cardInfo: { type: Object, default: null },
  selected: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }, // 不可出（异色校验下的同色牌）
  hint: { type: Boolean, default: false }, // 可接续提示
})
const emit = defineEmits(['click'])

const isSmallJoker = computed(() => props.cardInfo?.suit === 'jokerRed')
const isBigJoker = computed(() => props.cardInfo?.suit === 'jokerBlack')

const suitIcon = computed(() => {
  if (isSmallJoker.value) return '★'
  if (isBigJoker.value) return '☀'
  const map = { heart: '♥', diamond: '♦', spade: '♠', club: '♣' }
  return map[props.cardInfo?.suit] || ''
})
const rankText = computed(() => {
  if (isSmallJoker.value || isBigJoker.value) return ''
  return props.cardInfo?.rank || ''
})
const jokerText = computed(() => {
  if (isSmallJoker.value) return '小王'
  if (isBigJoker.value) return '大王'
  return ''
})
const colorClass = computed(() => {
  if (isSmallJoker.value) return 'c-joker-s'
  if (isBigJoker.value) return 'c-joker-b'
  return props.cardInfo?.color === 'red' ? 'c-red' : 'c-black'
})
const onClick = () => {
  if (props.disabled) return
  emit('click', props.cardInfo)
}
</script>
<style scoped>
.card {
  width: 110rpx;
  height: 160rpx;
  border: 3rpx solid #b8b8b8;
  border-radius: 12rpx;
  background: #fff;
  margin: 8rpx;
  position: relative;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.15);
  transition: transform 0.12s;
  flex-shrink: 0;
}
.card.selected {
  border-color: #2b7cff;
  background: #e8f1ff;
  transform: translateY(-16rpx);
  box-shadow: 0 8rpx 16rpx rgba(43, 124, 255, 0.3);
}
.card.hint {
  border-color: #4caf50;
}
.card.disabled {
  opacity: 0.45;
}
.c-red { color: #d32f2f; }
.c-black { color: #212121; }
.c-joker-s { color: #e91e63; background: linear-gradient(160deg, #fff 60%, #fde7ef); }
.c-joker-b { color: #455a64; background: linear-gradient(160deg, #fff 60%, #edeff1); }
.corner {
  position: absolute;
  font-size: 26rpx;
  font-weight: bold;
  line-height: 1;
}
.tl { top: 8rpx; left: 10rpx; }
.br { bottom: 8rpx; right: 10rpx; transform: rotate(180deg); }
.center-suit {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 44rpx;
  font-weight: bold;
}
.joker-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 30rpx;
  font-weight: bold;
  white-space: nowrap;
}
</style>
