<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="今日汇率" @back="goBack">
      <template #right>
        <!--
          ★ 右上角是「刷新」而不是「保存」★
            这一页没有要保存的东西：金额是即时换算的，
            汇率每次进入都会自动重拉（用户要求「每次进入都充值」）。
            放一个手动刷新，是为了「页面一直开着、想再拉一次最新价」的场景。
        -->
        <text class="nav-refresh" @click="reload">{{ loading ? '刷新中' : '刷新' }}</text>
      </template>
    </PageNav>

    <scroll-view class="page-scroll" scroll-y>
      <!--
        汇率说明条

        ★ 为什么要写「仅供参考」★
          这几个源都是每日/工作日一价，不是银行柜台价。
          拿它算旅行预算完全够用，当成结算价就会差出几毛钱。
          提前说清楚，比藏在关于页里诚实。
      -->
      <view class="hint-row">
        <text class="hint-text">{{ sourceText }}</text>
        <text class="hint-text">数据仅供参考，以实际结算为准</text>
      </view>

      <!-- 加载中（首次进入、还没有任何汇率时才有意义） -->
      <view v-if="loading && !hasRates" class="state-box">
        <text class="state-text">正在获取最新汇率…</text>
      </view>

      <!--
        ★ 拉取彻底失败 ★
          判据是「除 CNY 外一行都没有」，而不是 rows 为空 ——
          rows 里永远有 CNY 那一行（它是基准，不依赖网络）。
      -->
      <view v-else-if="!hasRates" class="state-box">
        <text class="state-title">汇率获取失败</text>
        <text class="state-text">{{ errorText || '请检查网络后重试' }}</text>
        <view class="state-btn" :style="{ backgroundColor: primaryColor }" @click="reload">
          <text class="state-btn-text">重新获取</text>
        </view>
      </view>

      <view v-else class="rate-card">
        <!--
          ★ 第一行恒为 CNY 100 元 ★
            用户明确要求「第一位显示 CNY，100 元」，
            并且「每次进入都保持这个状态」——
            所以每次重拉汇率后都把基准重置成 100，不保留上次的输入。
            下面每一行都是它的换算结果，也可以反过来改：
            改任何一行，其余所有行跟着重算。
        -->
        <view
          v-for="row in rows"
          :key="row.code"
          class="rate-row"
          :class="{ 'is-base': row.isBase }"
        >
          <view class="rate-left">
            <view class="rate-name-row">
              <text class="rate-name">{{ row.name }}</text>
              <text class="rate-code">{{ row.code }}</text>
            </view>
            <text v-if="row.rateText" class="rate-per">{{ row.rateText }}</text>
          </view>
          <input
            class="rate-input"
            type="digit"
            :value="amounts[row.code]"
            :placeholder="row.isBase ? '100' : '0.0000'"
            placeholder-class="rate-placeholder"
            @input="(e) => onAmountInput(row.code, e)"
          />
        </view>
      </view>

      <!-- 刷新失败但有旧数据：提示条（不挡操作） -->
      <view v-if="errorText && hasRates" class="warn-bar">
        <text class="warn-text">{{ errorText }}</text>
      </view>

      <view class="tip-text">
        <text>改任意一行的金额，其余币种会按当前汇率同步换算，保留四位小数。</text>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { fetchLatestRates } from '@/api/exchangeRate.js'
import { SUPPORTED_CURRENCIES, BASE_CURRENCY } from '@/utils/currency.js'
import {
  DEFAULT_BASE_AMOUNT,
  sanitizeAmountInput,
  buildAmountTexts,
  formatAmount
} from '@/utils/exchange.js'

export default {
  components: { PageNav, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 当前汇率：rates[code] = 1 单位外币值多少 CNY（CNY 恒为 1） */
    const rates = ref({ [BASE_CURRENCY]: 1 })
    /** 各币种输入框里显示的文本（key 是币种代码） */
    const amounts = reactive({})
    const loading = ref(false)
    const errorText = ref('')
    /** 数据来源的说明文字（源 + 日期，来自接口返回） */
    const sourceText = ref('')

    /**
     * 要展示的行
     *
     * ★ 顺序固定：CNY 打头，其余按 utils/currency.js 的白名单顺序 ★
     *   白名单本身就是「按出境游常见度排序」的，
     *   再排一次反而会和记账面板里的币种顺序对不上。
     *
     * ★ 没有汇率的币种直接不显示 ★
     *   接口偶尔会缺某个小币种（比如 TWD）。
     *   显示一行「0.0000」会让人以为汇率是 0，
     *   不如干脆不出现 —— 反正这一页只是查询用，不影响记账。
     */
    const rows = computed(() => {
      const list = [
        { code: BASE_CURRENCY, name: '人民币', isBase: true, rateText: '基准币种' }
      ]
      for (const c of SUPPORTED_CURRENCIES) {
        const rate = Number(rates.value[c.code])
        if (!Number.isFinite(rate) || rate <= 0) continue
        list.push({
          code: c.code,
          name: c.name,
          isBase: false,
          rateText: rateTextOf(c.code, rate)
        })
      }
      return list
    })

    const displayCodes = computed(() => rows.value.map((r) => r.code))

    /**
     * 除了 CNY 之外还有没有真实汇率
     *
     * ★ 不要用 rows.length 判断「有没有数据」★
     *   rows 里永远有 CNY 那一行（它是基准，不需要网络）。
     *   拿长度判断会导致：网络全挂时页面照样渲染一张只有「人民币 100」的表格，
     *   既没报错也没加载态 —— 用户以为汇率就是这个值。
     */
    const hasRates = computed(() => rows.value.length > 1)

    /**
     * 某一行的汇率说明
     *
     * ★ 为什么不是一律写「1 外币 = x CNY」★
     *   越南盾、日元这类币种的 rate 很小（VND ≈ 0.00028），
     *   保留四位小数会变成 0.0003，一眼看不出真实价格。
     *   所以 rate < 1 时反过来写「1 CNY = x 外币」，
     *   两种写法都是四位小数，读起来都不失真。
     */
    function rateTextOf(code, rate) {
      if (rate >= 1) return `1 ${code} = ${formatAmount(rate)} CNY`
      return `1 CNY = ${formatAmount(1 / rate)} ${code}`
    }

    /**
     * 以人民币金额为基准重算所有行
     *
     * 每次重拉汇率都要调 —— 汇率变了，下面各行的数字必须跟着变，
     * 否则页面上会出现「旧汇率换算出来的价 + 新汇率的说明」互相矛盾。
     */
    function applyBase(cny) {
      const { texts } = buildAmountTexts(BASE_CURRENCY, cny, displayCodes.value, rates.value)
      for (const code of displayCodes.value) amounts[code] = texts[code]
    }

    /** 某一行的金额被改动：以它为基准重算其余所有行 */
    function onAmountInput(code, e) {
      const raw = sanitizeAmountInput(e.detail && e.detail.value)
      // 被编辑的那一行保留用户正在输入的原始形状（不格式化），
      // 否则「12.」会被立刻改写成「12.0000」，光标被顶走、小数点消失。
      amounts[code] = raw
      const { texts } = buildAmountTexts(code, raw, displayCodes.value, rates.value)
      for (const other of displayCodes.value) {
        if (other === code) continue
        amounts[other] = texts[other]
      }
    }

    /**
     * 拉取最新汇率
     *
     * 失败时：
     *   · 已有数据 → 保留旧数据，只在下面挂一条提示条（不影响继续换算）
     *   · 没有数据 → 显示失败态 + 重新获取按钮
     */
    async function reload() {
      if (loading.value) return
      loading.value = true
      errorText.value = ''
      try {
        const res = await fetchLatestRates()
        rates.value = res.rates || { [BASE_CURRENCY]: 1 }
        sourceText.value = buildSourceText(res)
        if (res.fromCache) {
          errorText.value = '实时汇率获取失败，当前显示的是 ' + (res.day || '上次') + ' 的缓存'
        }
      } catch (e) {
        // 一行数据都没有时才有必要把错误甩给用户看；有数据就继续用
        errorText.value = '刷新失败：' + ((e && e.message) || '网络错误')
        if (!sourceText.value) sourceText.value = '未能获取汇率'
      } finally {
        loading.value = false
        // ★ 每次都回到「CNY 100」这个基准 ★
        //   用户要求「每次进入都保持第一位显示 CNY、100 元这种状态」。
        applyBase(DEFAULT_BASE_AMOUNT)
      }
    }

    /** 说明条的文案：来源 + 日期 */
    function buildSourceText(res) {
      const day = res && res.day ? res.day : ''
      const src = res && res.fromCache ? '缓存' : (res && res.source) || '在线'
      return day ? `汇率来源：${src} · ${day}` : `汇率来源：${src}`
    }

    function goBack() {
      uni.navigateBack()
    }

    /*
     * ★ 用 onShow 而不是 onMounted 拉取 ★
     *   用户要求「每次进入都充值（重新拉取），保证当前汇率最新」。
     *   从别的页面返回这一页时不会再触发 onMounted，
     *   但会触发 onShow —— 放在 onShow 才是真正的「每次进入」。
     *   首次进入 onMounted 之后紧跟着就会触发一次 onShow，
     *   所以不会漏掉首屏。
     */
    onShow(() => {
      reload()
    })

    return {
      settingStore, primaryColor, pageStyle,
      loading, errorText, sourceText, hasRates,
      rows, amounts,
      onAmountInput, reload, goBack
    }
  }
}
</script>

<style scoped>
.nav-refresh {
  font-size: 28rpx;
  color: var(--app-primary);
  font-weight: 500;
}

.page-scroll {
  padding: 0 32rpx;
}

.hint-row {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 20rpx 8rpx 4rpx;
}

.hint-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
}

/* 失败 / 加载态 */
.state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 72rpx 40rpx;
  margin-top: 20rpx;
}

.state-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.state-text {
  font-size: 24rpx;
  color: var(--app-text-3);
  text-align: center;
  line-height: 1.6;
}

.state-btn {
  margin-top: 8rpx;
  padding: 16rpx 44rpx;
  border-radius: 20rpx;
}

.state-btn-text {
  font-size: 26rpx;
  color: #ffffff;
  font-weight: 500;
}

/* 汇率表 */
.rate-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 0 28rpx;
  margin-top: 20rpx;
}

.rate-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  min-height: 112rpx;
  padding: 16rpx 0;
  border-bottom: 1rpx solid var(--app-line);
}

.rate-row:last-child {
  border-bottom: none;
}

/*
 * 基准行（CNY）左侧加一条主题色竖线
 *
 * ★ 为什么要有这个标记 ★
 *   这一页的每一行都能编辑、数字长得都一样，
 *   不给基准行一点视觉重量的话，用户会分不清「哪一行是源、哪些是换算结果」。
 */
.rate-row.is-base {
  border-left: 4rpx solid var(--app-primary);
  padding-left: 16rpx;
  margin-left: -20rpx;
}

.rate-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.rate-name-row {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
}

.rate-name {
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

.rate-code {
  font-size: 22rpx;
  color: var(--app-text-3);
}

.rate-per {
  font-size: 20rpx;
  color: var(--app-text-3);
  line-height: 1.4;
}

/*
 * 金额输入框
 *
 * ★ 右对齐 + 等宽感 ★
 *   这一列是数字对齐的长表，右对齐才能让小数点位置大致对齐，
 *   扫一眼就能比较大小。字号比其他行内容大一号，因为它是主角。
 */
.rate-input {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.rate-placeholder {
  color: var(--app-text-3);
  font-weight: 400;
}

/* 刷新失败提示条 */
.warn-bar {
  background-color: var(--app-card-2);
  border-radius: 16rpx;
  padding: 16rpx 24rpx;
  margin-top: 20rpx;
}

.warn-text {
  font-size: 22rpx;
  color: var(--app-text-2);
  line-height: 1.5;
}

.tip-text {
  padding: 24rpx 8rpx 0;
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.6;
}
</style>
