/**
 * 全局参数（需求 3.1）：标准局/快速局共用一套内核，仅参数不同。
 * 异色校验节点按「层数为 3 的整数倍且小于目标层数」判定，不写死 3/6。
 */

export const GAME_MODE_STANDARD = 1
export const GAME_MODE_FAST = 2

export const MAX_COLLAPSE = 3 // 崩塌上限（全队共享）
export const HAND_LIMIT = 6 // 手牌上限
export const COLOR_CHECK_STEP = 3 // 每叠满 3 层触发异色校验

export function paramsFor(gameMode) {
  const standard = gameMode === GAME_MODE_STANDARD
  return {
    targetLayer: standard ? 8 : 6,
    colorCheckLayer: (layer) => layer % COLOR_CHECK_STEP === 0 && layer < (standard ? 8 : 6),
  }
}
