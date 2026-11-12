<template>
  <wd-popup
    v-model="visible"
    position="bottom"
    :z-index="zIndex"
    :safe-area-inset-bottom="true"
    custom-style="background-color: var(--app-card); border-radius: 28rpx 28rpx 0 0;"
  >
    <view class="acc-sheet">
      <view class="acc-head">
        <text class="acc-title">{{ title }}</text>
        <text class="acc-close" @click="close">关闭</text>
      </view>

      <scroll-view class="acc-scroll" scroll-y>
        <!--
          ★ 「选择全部」行（用户本轮第 1 条）★
            用户原话：「在全部交易筛选列表里的这个账户，
            选择的这个面板要添加一个『选择全部』的选项」。

            ★ 为什么放在列表最前面、而不是做成底部按钮 ★
              它和下面的账户是**同一种选择**（当前位置 = 全部账户），
              不是「动作」（清空/应用）。放进列表、参与「当前值打勾」
              才能和账户一样表达「我现在选的是这个」。

            ★ 为什么只有筛选面板要它 ★
              记账/报销都是「这一笔从哪个账户出」，必须选一个具体账户；
              筛选的「全部账户」是「不加账户条件」，只有那里说得通。
              所以做成 allow-all 开关，默认关。
        -->
        <view
          v-if="allowAll"
          class="acc-row"
          :class="{ active: !selectedId }"
          @click="onPickAll"
        >
          <view class="acc-icon" :style="{ backgroundColor: 'var(--app-card-2)' }">
            <text class="acc-all-glyph">全</text>
          </view>
          <view class="acc-info">
            <text class="acc-name">{{ allLabel || '全部账户' }}</text>
            <text class="acc-sub">不加账户条件</text>
          </view>
          <text v-if="!selectedId" class="acc-tick">✓</text>
        </view>

        <view
          v-for="acc in list"
          :key="acc.id"
          class="acc-row"
          :class="{ active: acc.id === selectedId }"
          @click="onPick(acc)"
        >
          <!--
            账户图标：和账户页的 .acc-icon 同一套观感
            —— 圆角方框 + 账户色的 14% 浅底 + 本色图标。
          -->
          <view class="acc-icon" :style="iconBoxStyle(acc)">
            <AccountIcon
              v-if="acc.icon"
              :name="acc.icon"
              :size="20"
              :color="acc.color || primaryColor"
            />
            <text v-else class="acc-icon-text" :style="{ color: acc.color || primaryColor }">
              {{ (acc.name || '?').slice(0, 1) }}
            </text>
          </view>

          <view class="acc-info">
            <text class="acc-name">{{ acc.name }}</text>
            <!--
              组合账户没有余额（它是「按顺序扣款」的虚拟账户），
              显示 0.00 会误导，所以换成一句说明。
            -->
            <text v-if="acc.isCombo" class="acc-sub">按顺序扣款</text>
            <MoneyText
              v-else
              class="acc-balance"
              :cents="acc.balance_cents || 0"
              variant="balance"
              :muted="!acc.include_in_total"
              :size="24"
              :weight="400"
            />
          </view>

          <!-- 单选：当前值打一个对勾（不画方框，方框会被误读成多选） -->
          <text v-if="acc.id === selectedId" class="acc-tick">✓</text>
        </view>

        <view v-if="list.length === 0" class="acc-empty">
          <text class="acc-empty-text">还没有账户，先去账户页添加</text>
        </view>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<script>
/**
 * 账户选择弹层（单选）
 *
 * ═════════════════════════════════════════════════════════════
 * ★ 用户本轮要求 ★
 *   「现在只重写一下这个账户选择的面板，单选，显示图标和金额，用在：
 *     1. 筛选面板的账户选择
 *     2. 记账面板的账户选择
 *     3. 报销弹层的账户选择」
 *
 * ★ 为什么原来的不统一 ★
 *   三处用的都是 wd-action-sheet，它是组件库的系统控件：
 *     · 行内只有一个 name + subname 文本，**没有图标**
 *     · 行高、字号、底部按钮全是库自己的，和 App 其它弹层不是一套
 *   而账户在 App 里是有明确视觉身份的（账户页、流水行都有
 *   「圆角方框 + 账户色浅底 + 图标」），选择器里却只剩一个名字，
 *   用户得靠读字来认账户。
 *
 * ★ 现在的做法 ★
 *   自绘一个单选弹层，每行 = 图标 + 名字 + 余额，本质上是把
 *   账户页那一行的信息密度搬进弹层，选中值打对勾。
 *
 * ★ 为什么只做单选 ★
 *   三个使用场景都是「这一笔从哪个账户出 / 进哪个账户」，
 *   语义上只有一个答案。多选（如批量筛选）另有多选面板可用，
 *   不需要一个组件兼两种模式 —— 那样 props 会变复杂、模板里到处 if。
 *
 * ★ 为什么用 MoneyText 而不自己拼金额 ★
 *   余额的符号与配色规则（正负、不计入资产的浅灰）全 App 统一在
 *   components/MoneyText.vue 里。这里拼一份 (x/100).toFixed(2)，
 *   就会出现「账户页的余额是灰色、选择器里是黑色」这种不一致。
 */
import { computed, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/setting.js'
import { pushLayer } from '@/utils/layerStack.js'
import AccountIcon from '@/components/AccountIcon.vue'
import MoneyText from '@/components/MoneyText.vue'

export default {
  name: 'AccountPickerSheet',
  components: { AccountIcon, MoneyText },
  props: {
    modelValue: { type: Boolean, default: false },
    /** 可选账户列表（调用方自己决定要不要过滤组合账户） */
    accounts: { type: Array, default: () => [] },
    /** 当前选中的账户 id */
    selectedId: { type: String, default: '' },
    title: { type: String, default: '选择账户' },
    /**
     * 是否提供「全部账户」选项
     *
     * ★ 只有筛选面板要它（用户本轮第 1 条）★
     *   记账 / 报销是「这一笔从哪个账户出」，必须选一个具体账户；
     *   筛选的「全部账户」表示「不加账户条件」，只有那里说得通。
     *   默认关，避免记账面板多出一个选不了账户的选项。
     */
    allowAll: { type: Boolean, default: false },
    /** 「全部」那一行的文案 */
    allLabel: { type: String, default: '全部账户' },
    /**
     * 弹层层级
     *
     * ★ 必须显式给 ★
     *   wd-popup 默认 10。这个弹层常常叠在别的弹层上面打开
     *   （筛选面板 100、报销弹层、记账面板），低于那个值就会
     *   渲染在它背后 —— 表现为「点了没反应，只看到遮罩变暗」。
     */
    zIndex: { type: Number, default: 120 }
  },
  /**
   * ★ 事件名用 picked，不用 select / change / confirm ★
   *   这三个都是原生事件名（见 scripts/check-events.mjs），
   *   父组件写 @select 会被编译成监听根节点的原生事件，收不到。
   */
  emits: ['update:modelValue', 'picked'],
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const primaryColor = computed(() => settingStore.primaryColor)

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const list = computed(() => props.accounts || [])

    /**
     * 图标方框的底色
     *
     * ★ 账户色 14% 透明底 ★
     *   和账户页 .acc-icon 的 `color + '22'`（约 13%）同一档，
     *   用户在两处看到的是同一种「浅色底 + 本色图形」。
     *   ★ 为什么不用字符串拼 '22' ★
     *     acc.color 可能是 null / '' / 已带透明度的 rgba，
     *     拼出来会得到 `null22` 这种非法值，底色直接丢失。
     */
    function iconBoxStyle(acc) {
      const c = acc.color || primaryColor.value
      return { backgroundColor: withAlpha(c, 0.14) }
    }

    function withAlpha(color, alpha) {
      const s = String(color || '').trim()
      if (/^#[0-9a-fA-F]{6}$/.test(s)) {
        const r = parseInt(s.slice(1, 3), 16)
        const g = parseInt(s.slice(3, 5), 16)
        const b = parseInt(s.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
      // 非 6 位 hex（rgba / 主题色名）：退回统一的浅底，至少不会渲染成透明方块
      return 'var(--app-card-2)'
    }

    function onPick(acc) {
      emit('picked', acc)
      visible.value = false
    }

    /**
     * 选中「全部」
     *
     * ★ 回传一个 id 为空的对象，而不是 null ★
     *   调用方统一写 `acc && acc.id ? acc.id : ''`，
     *   回传 null 会让「没选」和「选了全部」区分不出来；
     *   回传 `{ id: '', isAll: true }` 语义明确，调用方也能特判。
     */
    function onPickAll() {
      emit('picked', { id: '', isAll: true })
      visible.value = false
    }

    function close() {
      visible.value = false
    }

    /*
     * ★ 接入弹层栈 ★
     *   这个面板是叠在筛选面板 / 记账面板 / 报销弹层之上的，
     *   侧滑返回、安卓返回键应该只收起它，而不是把下面那层也关掉。
     *   打开时登记、关闭/卸载时摘掉，和其它弹层同一套做法。
     */
    let unregisterLayer = null

    watch(
      () => props.modelValue,
      (open) => {
        if (open) {
          if (!unregisterLayer) {
            unregisterLayer = pushLayer(() => { visible.value = false }, 'accountPickerSheet')
          }
          return
        }
        if (unregisterLayer) {
          unregisterLayer()
          unregisterLayer = null
        }
      }
    )

    onUnmounted(() => {
      if (unregisterLayer) unregisterLayer()
    })

    return { visible, primaryColor, list, iconBoxStyle, onPick, onPickAll, close }
  }
}
</script>

<style scoped>
.acc-sheet {
  display: flex;
  flex-direction: column;
  max-height: 72vh;
}

.acc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.acc-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.acc-close {
  font-size: 26rpx;
  color: var(--app-text-3);
}

.acc-scroll {
  flex: 1;
  min-height: 200rpx;
  max-height: 60vh;
  padding: 0 20rpx 24rpx;
}

/*
 * 一行账户
 *
 * ★ 内边距 16rpx、圆角 20rpx ★
 *   和账户页的卡片行同一档；
 *   整行可点、选中整行变底色，比「只有右侧对勾可点」好用。
 */
.acc-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 16rpx 12rpx;
  border-radius: 20rpx;
}

.acc-row.active {
  background-color: var(--app-card-2);
}

/* 图标方框：与账户页 .acc-icon 同款（圆角方框而非圆形，账户页就是这样） */
.acc-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.acc-icon-text {
  font-size: 28rpx;
  font-weight: 600;
}

/* 「全部」那一行没有账户图标，用一个中性的「全」字块 */
.acc-all-glyph {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--app-text-2);
}

.acc-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.acc-name {
  font-size: 28rpx;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acc-sub {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 余额：字号比名字小一档，视觉上属于「附加信息」 */
.acc-balance {
  line-height: 1.2;
}

/* 单选的当前值：一个纯对勾，不画方框（方框会被误读成「还能多选」） */
.acc-tick {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-primary);
  flex-shrink: 0;
}

.acc-empty {
  padding: 60rpx 0;
  text-align: center;
}

.acc-empty-text {
  font-size: 26rpx;
  color: var(--app-text-3);
}
</style>
