<template>
  <view v-if="visible" class="quick-add-mask">
    <!--
      ★ 背景层：只负责「挡住页面 + 点空白关闭」★
        触摸拦截必须挂在这一层，而不是包着输入条的 .quick-add-mask 上。

        踩过的坑：以前 @touchmove.stop.prevent="noop" 挂在 .quick-add-mask，
        而输入条是它的**子节点** —— 手指在输入框里左右拖时，touchmove
        从 input 冒泡到遮罩就被 preventDefault 掉了，
        原生输入框的长按选中、拖动 caret、文本横向滚动全部被吞，
        表现为「文本太长时滑不动、看不到被遮住的部分」。

        现在改成兄弟层结构：
          背景层（拦截触摸） + 输入条（浮在上面，不拦截默认行为）
        输入框里的事件冒泡到 .quick-add-mask 时已无任何处理器，原生行为得以保留。
    -->
    <view
      class="quick-add-mask-bg"
      @click="onMaskClick"
      @touchmove.stop.prevent="noop"
    />

    <!--
      ★ 输入框上方靠左的两个胶囊（用户第 4 条要求）★
        勾选状态在下面那一行里，最终识别为支出才生效
        （收入/转账既没有预算也没法报销）。
      ★ 输入内容里有「报销」二字时，待报销自动勾选 ★
        在 watch(draft) 里做 —— 用户一边打字一边就把标记带上了，
        不用打完了再回头勾。
    -->
    <view class="quick-add-flags" :style="flagsStyle" @click.stop @touchmove.stop>
      <!--
        ★ 点胶囊不能让输入条消失（本轮第 2 条 bug）★
          胶囊是原生 <input> 外面的普通 view，点它会抢走焦点，
          输入框失焦 → 键盘高度归零 → 键盘监听里 h===0 的分支
          把整个输入态 close() 掉，表现为「一点胶囊输入框就缩回去」。
          修法见 holdInputAlive() + keepAliveUntil 保护窗：
          胶囊触摸时开窗，键盘归零回调在窗内跳过 close()，
          随后用 ref 把输入框重新聚焦。
      -->
      <view
        class="qa-chip"
        :class="{ on: pendingReimburse }"
        @touchstart.stop.prevent="holdInputAlive"
        @touchend.stop="onChipTap('reimburse')"
        @click.stop="onChipClick('reimburse')"
      >
        <view class="qa-chip-box" :class="{ on: pendingReimburse }">
          <text v-if="pendingReimburse" class="qa-chip-tick">✓</text>
        </view>
        <text class="qa-chip-text">待报销</text>
      </view>

      <view
        class="qa-chip"
        :class="{ on: excludeBudget || pendingReimburse, locked: pendingReimburse }"
        @touchstart.stop.prevent="holdInputAlive"
        @touchend.stop="onChipTap('budget')"
        @click.stop="onChipClick('budget')"
      >
        <view class="qa-chip-box" :class="{ on: excludeBudget || pendingReimburse }">
          <text v-if="excludeBudget || pendingReimburse" class="qa-chip-tick">✓</text>
        </view>
        <text class="qa-chip-text">不计入预算</text>
      </view>
    </view>

    <!--
      输入条：只保留 click 拦截（点条内不关闭）。
      @touchmove 只用 .stop 拦住「页面穿透滚动」，绝不能加 .prevent ——
      那会把输入框自己的横向滚动/选区一起废掉。
    -->
    <view class="quick-add-bar" :style="barStyle" @click.stop @touchmove.stop>
      <!-- 左侧：输入框 -->
      <input
        ref="inputRef"
        v-model="draft"
        class="bar-input"
        :focus="autoFocus"
        :disabled="submitting"
        :adjust-position="false"
        :cursor-spacing="12"
        confirm-type="send"
        :confirm-hold="true"
        placeholder="说一句话，如「昨天午饭45，打车28」"
        placeholder-class="bar-placeholder"
        @confirm="submit"
      />

      <!-- 右侧：发送按钮（+ 号变身） -->
      <view
        class="bar-send"
        :style="{ backgroundColor: canSend ? primaryColor : 'var(--app-line)' }"
        @touchstart.stop
        @click.stop="submit"
      >
        <text v-if="submitting" class="send-icon">···</text>
        <text v-else class="send-icon">↑</text>
      </view>
    </view>
  </view>

  <!-- 全局弹窗宿主（组件库重绘的确认框） -->
  <AppDialog />
</template>

<script>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { useTransactionStore } from '@/stores/transaction.js'
import { listCategories, isSystemPresetName } from '@/api/category.js'
import { listTags } from '@/api/tag.js'
import { parseMessageToTransactions } from '@/api/aiParse.js'
import { listLoanPeople, isLoanPersonCategory, isLoanSettleCategory } from '@/api/loan.js'
import { combineDayTime } from '@/utils/date.js'
import { buildOriginalNoteTag, applyNoteTag, cleanNote } from '@/utils/currency.js'
import { fetchLatestRates } from '@/api/exchangeRate.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { glassVars } from '@/utils/theme.js'
import { pushLayer } from '@/utils/layerStack.js'

export default {
  name: 'QuickAddBar',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'saved', 'parsing-start', 'parsing-end'],
  components: { AppDialog },
  setup(props, { emit }) {
    const settingStore = useSettingStore()
    const accountStore = useAccountStore()
    const txnStore = useTransactionStore()

    const draft = ref('')
    const submitting = ref(false)
    const autoFocus = ref(false)
    const inputRef = ref(null)
    const keyboardHeight = ref(0)

    /**
     * 遮罩是否可点击关闭。
     * ★ 防幽灵点击 ★
     *   触摸 FAB 抬起时会触发 openQuickAdd，同时浏览器还会补发一次 click。
     *   输入条是那一刻才渲染的，这次补发的 click 就会落到刚出现的遮罩上，
     *   于是「刚打开就被关闭」，表现为单击没反应。
     *   打开后 350ms 内忽略遮罩点击即可。
     */
    const maskEnabled = ref(false)
    let maskTimer = null

    /** 本次打开期间键盘是否曾真正弹出过（用于区分"还没弹"和"已收起"） */
    let keyboardEverShown = false

    /** close() 重入锁 */
    let closing = false

    /**
     * 聚焦兜底定时器。
     * ★ 必须保存并在关闭时清掉 ★
     *   原先这两个 setTimeout 没被引用，close() 时无法取消。
     *   组件已经关闭销毁后，定时器仍会执行 autoFocus=false→true，
     *   把下一次打开时的聚焦状态打乱，表现为「第二次起键盘不弹」。
     */
    let focusTimer = null

    function clearFocusTimers() {
      if (focusTimer) {
        clearTimeout(focusTimer)
        focusTimer = null
      }
    }

    const visible = computed({
      get: () => props.modelValue,
      set: (v) => emit('update:modelValue', v)
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const canSend = computed(() => draft.value.trim().length > 0 && !submitting.value)

    /* ------------------------------------------- 不计入预算 / 待报销 */

    /**
     * 「待报销」勾选状态
     *
     * ★ 只在最终识别为支出时生效 ★
     *   AI 解析出来的 item 可能是收入或转账，那两类既没有预算
     *   也没法报销，落库时会直接忽略这两个标记（见下面的 create 调用）。
     * ★ 只能落在「待报销」这一档 ★
     *   待报销 → 已报销必须去「报销管理」页确认（本轮用户第 5 条），
     *   AI 记账和手动记账都不能把这一档推进到已报销。
     */
    const pendingReimburse = ref(false)
    /** 「不计入预算」勾选状态（待报销时被视为已勾选且锁死） */
    const excludeBudget = ref(false)

    /**
     * 输入里有没有「报销」二字的上一帧结论
     *
     * ★ 为什么要记这个 ★
     *   watch(draft) 每敲一个字都会跑；如果每次都无条件回写勾选状态，
     *   用户手动点掉「待报销」后随便再打一个字又会被重新勾上。
     *   只在「有没有报销二字」这个结论真的翻转时才回写，
     *   既能实时跟随（本轮用户第 4 条），又不吞掉手动操作。
     */
    let autoReimburse = false

    /** 胶囊行的位置：跟输入条一样贴底，但要往上挪一个输入条高度 + 间距 */
    const flagsStyle = computed(() => ({
      bottom: 'calc(env(safe-area-inset-bottom) + 20rpx + 104rpx)'
    }))

    function togglePendingReimburse() {
      pendingReimburse.value = !pendingReimburse.value
      /* 勾上待报销 → 自动勾上不计入预算（双向联动） */
      excludeBudget.value = pendingReimburse.value
    }

    function toggleExcludeBudget() {
      if (pendingReimburse.value) {
        uni.showToast({ title: '待报销的账本来就不计入预算', icon: 'none' })
        return
      }
      excludeBudget.value = !excludeBudget.value
    }

    /*
     * 胶囊的点按分发
     *
     * ★ 为什么不用现成的 @click（本轮用户第 2 条 bug 的根因）★
     *   App 端 <view> 的 @click 是「300ms 后合成的 tap」。原生输入框在手指
     *   按下时就先失焦、键盘开始收起；等 click 姗姗来迟时 focus() 追不上，
     *   键盘就真的缩回去了。
     *   现在 @touchstart 直接 .prevent（阻止默认的「夺焦」行为），
     *   @touchend 立刻处理，@click 只作为 H5/无 touch 环境的兜底 ——
     *   用 touchHandled 去重，避免一次点击切换两次。
     */
    let chipTouchedAt = 0

    function onChipTap(which) {
      chipTouchedAt = Date.now()
      applyChip(which)
    }

    function onChipClick(which) {
      // touchend 已经处理过（300ms 内）就不再处理
      if (Date.now() - chipTouchedAt < 600) return
      applyChip(which)
    }

    function applyChip(which) {
      // 再兜一次保活窗：某些机型 prevent 也拦不住键盘收起
      holdInputAlive()
      if (which === 'reimburse') togglePendingReimburse()
      else toggleExcludeBudget()
    }

    /**
     * 输入里提到「报销」就勾上待报销，提到又删掉就取消
     *
     * ★ 本轮用户第 4 条原话 ★
     *   「检测到报销两个字时，默认勾选待报销；没有这两个字时，就取消勾选」。
     *   所以要**双向实时**跟随，不能像旧版那样只勾不取消。
     */
    watch(draft, (text) => {
      const has = /报销/.test(String(text || ''))
      if (has === autoReimburse) return
      autoReimburse = has
      pendingReimburse.value = has
      /* 勾上时联动不计入预算；取消时一起取消（用户第 3 条） */
      excludeBudget.value = has
    })

    /**
     * 输入条位置：贴在 webview 底部。
     *
     * ★ 键盘高度不能叠加 ★
     *   softinputMode = adjustResize 时，webview 会收缩到键盘上沿，
     *   此时 position:fixed 的 bottom:0 天然就贴在键盘上沿。
     *   若 bottom 再写成键盘高度，等于又抬一次 ——
     *   表现为「输入框飞到屏幕中间」或「离键盘一大段距离」。
     *
     *   所以这里只加安全区，键盘高度一律不参与定位。
     *   （keyboardHeight 仅用于判断键盘是否被系统收起。）
     */
    /**
     * 输入条样式：定位 + 柔光玻璃配色。
     *
     * ★ 玻璃变量和底部 tabbar / 对话框同源 ★
     *   都走 utils/theme.js 的 glassVars()，三处观感一致，
     *   以后改玻璃参数只要动那一个函数。
     *   透明度取 tabbar 那一档（浅 0.62 / 深 0.48）：
     *   输入条是浮在页面内容上方的一小块，透一点更「浮」；
     *   上面的文字有 placeholder 深色衬底兜着，可读性没问题。
     */
    const barStyle = computed(() => ({
      bottom: 'calc(env(safe-area-inset-bottom) + 20rpx)',
      ...glassVars(settingStore.isDark, { blur: '24rpx' })
    }))

    /* ------------------------------------------------------ 键盘 */

    let keyboardTimer = null

    /**
     * 点胶囊时的「别关输入条」保护窗口
     *
     * ★ bug 现场（本轮用户第 2 条）★
     *   胶囊是 <input> 外面的普通 view。点它会抢焦点 → 输入框失焦 →
     *   系统收起键盘 → onKeyboardHeightChange 收到 height=0 →
     *   下面的 close() 把整个输入态收掉，看着就是「输入框缩回去了」。
     *   胶囊只是改个标记，不该结束输入，所以触摸时开一个短保护窗：
     *   窗口内的 height=0 一律忽略并重新聚焦，窗口外维持原来的关闭行为。
     */
    let keepAliveUntil = 0
    let refocusTimer = null

    function holdInputAlive() {
      /*
       * 保护窗开到 1.2 秒
       *
       * ★ 为什么不是 900ms ★
       *   真机上「点胶囊 → 键盘收 → 我们抢回焦点 → 键盘再弹」
       *   这一串可能超过 900ms（尤其低端机），窗口一过高度归零回调
       *   仍会把输入条 close 掉。1.2 秒覆盖完整一轮，用户感知不到。
       */
      keepAliveUntil = Date.now() + 1200
      refocus()
    }

    /** 把焦点还给输入框（不主动弹键盘，避免又触发一次高度回调） */
    function refocus() {
      if (refocusTimer) clearTimeout(refocusTimer)
      refocusTimer = setTimeout(() => {
        refocusTimer = null
        if (!visible.value) return
        try {
          if (inputRef.value && typeof inputRef.value.focus === 'function') {
            inputRef.value.focus()
          }
        } catch (e) {}
      }, 0)
    }

    function bindKeyboard() {
      try {
        if (typeof uni.onKeyboardHeightChange === 'function') {
          uni.onKeyboardHeightChange((res) => {
            const h = res.height || 0
            keyboardHeight.value = h

            /**
             * 键盘被系统收起（点空白、按返回键）时，监听会收到 height=0。
             * 此时组件自己并不知道，若不主动收尾，会出现：
             *   - 输入条还在，但位置错乱/空白
             *   - FAB 因为 hidden=showQuickAdd 一直不显示
             * 所以高度归零且已经打开过时，直接关闭输入态。
             *
             * ★ 例外：刚刚点过胶囊 ★
             *   那是「手指离开了输入框」造成的假收起，
             *   跳过 close() 并把焦点还回去，输入条原地不动。
             */
            if (h === 0 && visible.value && keyboardEverShown) {
              if (Date.now() < keepAliveUntil) {
                refocus()
                return
              }
              close()
            }
            if (h > 0) {
              keyboardEverShown = true
              keepAliveUntil = 0
            }
          })
        }
      } catch (e) {}
    }

    function unbindKeyboard() {
      try {
        if (typeof uni.offKeyboardHeightChange === 'function') {
          uni.offKeyboardHeightChange()
        }
      } catch (e) {}
      if (keyboardTimer) clearTimeout(keyboardTimer)
    }

    /* ------------------------------------------------------ 提交 */

    async function submit() {
      const text = draft.value.trim()
      if (!text || submitting.value) return

      // 没配 API Key 直接提示，避免无谓请求
      const ai = settingStore.settings.ai || {}
      if (!ai.apiKey) {
        const goConfig = await confirmDialog({
          title: '需要先配置 AI',
          content: '智能记账需要调用大模型解析你的输入。请到「我的 → AI 大模型」填写 API Key。',
          confirmText: '去配置',
          cancelText: '取消'
        })
        // ★ 只有用户点了「去配置」才跳转，取消就什么都不做 ★
        if (goConfig) {
          close()
          uni.navigateTo({ url: '/pages/settings/ai' })
        }
        return
      }

      submitting.value = true

      // 通知首页在最近交易顶部插入「正在解析」占位行
      emit('parsing-start', { text: text.length > 18 ? text.slice(0, 18) + '…' : text })

      // 解析期间先收起输入态，让用户能看到列表里的占位行
      const pendingText = text
      /*
       * ★ 勾选状态必须在 close() 之前拍照（用户反馈的 bug）★
       *   close() 会清空 pendingReimburse / excludeBudget（那是「每次打开
       *   都默认不勾」的实现方式）。而下面原来是在 close() **之后**才读
       *   这两个 ref —— 读到的永远是刚被清掉的 false，
       *   于是「勾了待报销再发」记出来的账 reimburse_status 恒为 0。
       *   拍照挪到这里：取「点发送那一刻」用户真实勾了什么。
       */
      const wantPendingReimburse = pendingReimburse.value
      const wantExcludeBudget = excludeBudget.value || wantPendingReimburse
      close()

      try {
        const [categories, tags] = await Promise.all([listCategories(), listTags()])
        await accountStore.load()

        // ★ AI 解析要能识别组合账户 ★
        //   用户日常「碰一碰/自动续费」用组合记，AI 记账也该支持。
        //   组合是虚拟账户，AI 选了它，落库时由 api 层解析成真实账户，
        //   所以这里把**全部**账户（含组合）传给解析器。
        if (accountStore.list.length === 0) {
          throw new Error('还没有账户，请先添加一个账户')
        }

        // 默认账户必须是真实账户（组合不能当默认）
        const realAccounts = accountStore.list.filter((a) => !a.isCombo)
        const prefDefault = settingStore.settings.defaultAccountId || ''
        const defaultAccountId = accountStore.list.some((a) => a.id === prefDefault && !a.isCombo)
          ? prefDefault
          : (realAccounts[0] || accountStore.list[0] || {}).id || ''

        /*
         * 已记过的人员名单 —— 给 AI 认「还给谁」用
         *
         * ★ 为什么要给 ★
         *   借款归还 / 借款收回 的人名必须和之前那笔对上，
         *   模型拼错一个字，管理页就会多出一个「新人员」，
         *   那笔账永远结不清。给候选名单能让它优先照抄已有写法。
         * ★ 拿不到不影响记账 ★
         *   人员列表只是「帮模型选得更准」，失败就当没有。
         */
        const people = await listLoanPeople().catch(() => [])

        /*
         * 胶囊状态快照已经在上面（close() 之前）拍好了。
         *
         * ★ 为什么不能在这里读 ★
         *   解析要等网络，等待期间用户还能继续勾/取消；
         *   更关键的是 close() 已经把这两个 ref 清空了 ——
         *   在这里读只会拿到 false（这就是「勾了待报销却没生效」的根因）。
         */
        const result = await parseMessageToTransactions(pendingText, {
          categories,
          accounts: accountStore.list,
          tags,
          people,
          defaultAccountId,
          baseDate: new Date()
        })

        /*
         * ★ 外币折算（AI 只识别币种，汇率和计算全在这里做）★
         *
         *   解析层返回的 amount_cents 是**原币金额**，
         *   currency 是币种代码（'CNY' 表示人民币）。
         *   这一步负责：
         *     1. 外币 -> 取当日汇率（缓存优先，走 exchangeRate 那套多源降级）
         *     2. amount_cents 改成折算后的人民币分再入库
         *     3. 原币金额/币种/汇率作为快照字段一起带上
         *     4. 备注自动追加「HKD 210」这类原币标记
         *   ★ 汇率拿不到就跳过这一笔并说明原因 ★
         *     按 1:1 记成人民币会让账目直接错，比不记更糟。
         */
        const rateCache = {}
        const rateErrors = []

        // 逐条落库
        let saved = 0
        const failures = []

        for (const item of result.items) {
          try {
            let amountCents = item.amount_cents
            let originalCurrency = null
            let originalAmountCents = null
            let exchangeRate = null

            const code = String(item.currency || 'CNY').toUpperCase()
            if (code !== 'CNY') {
              // 同一次解析里多条同币种，只拉一次
              if (!(code in rateCache)) {
                try {
                  const res = await fetchLatestRates()
                  rateCache[code] = Number(res.rates[code]) || 0
                } catch (e) {
                  rateCache[code] = 0
                }
              }
              const rate = rateCache[code]
              if (!rate || rate <= 0) {
                rateErrors.push(`${code} 汇率获取失败`)
                continue
              }
              originalAmountCents = item.amount_cents
              originalCurrency = code
              exchangeRate = rate
              amountCents = Math.round(item.amount_cents * rate)
              if (amountCents <= 0) {
                rateErrors.push(`${code} 折算后金额无效`)
                continue
              }
            }

            /*
             * ★ 借入借出的四类「资金往来」必须不计收支（用户反馈的 bug）★
             *   AI 记账以前走的是这条分支，payload 里没有 exclude_from_stats，
             *   于是 createTransaction 里 `input.exclude_from_stats ? 1 : 0`
             *   恒为 0 —— 用户看到「借出 500」被算进了本月支出。
             *
             *   判定按分类名（name 才是稳定语义，id 会随分类重建变化）：
             *     · 借出 / 借入 / 借款归还 / 借款收回 → 两个标记都置 true
             *     · 四个结清派生分类（借出坏账/借出利息/借入未还/借入利息）
             *       → exclude_from_stats 必须 false（真实损益要计入收支），
             *         只排除预算。
             *   AI 理论上选不到 hidden 的派生分类，但导入/异常分支可能带进来，
             *   所以这里显式兜住。
             */
            const catName = item.category_name || ''
            const isLoanMove = isLoanPersonCategory(catName) && !isLoanSettleCategory(catName)
            const isSettleCat = isLoanSettleCategory(catName)

            /*
             * ★ 报销标记只在支出上生效（用户第 4 条）★
             *   收入/转账既没有预算也没法报销，硬套上会让「本月支出」
             *   莫名其妙少一笔、或者支出统计里出现一条收入。
             *   所以这里按 item.type 判一次，不是支出的直接当没勾。
             */
            const isExpenseItem = item.type === 'expense'
            /*
             * ★ 系统固定分类下的支出不能标记待报销（用户本轮第 5 条）★
             *   借出 / 借入 / 对账这类是资金往来，不是消费；
             *   即使 AI 把它们识别成支出，也不该挂「待报销」——
             *   否则那笔会永远躺在报销清单里，用户还不知道怎么冒出来的。
             *   ★ 为什么要在这里挡一次，而不是只靠 api/transaction.js 的兜底 ★
             *     兜底是「静默降级」，用户已经看到「已记 N 笔」的成功提示，
             *     却不知道自己勾的待报销被丢掉了。这里先判一次，
             *     与前端其它入口的置灰规则保持一致。
             */
            const itemIsSystemCat = isSystemPresetName(item.category_name || '', item.type)
            const itemPendingReimburse = isExpenseItem && wantPendingReimburse && !itemIsSystemCat
            const itemExcludeBudget = isExpenseItem && wantExcludeBudget

            await txnStore.create({
              type: item.type,
              amount_cents: amountCents,
              account_id: item.account_id,
              to_account_id: item.to_account_id,
              category_id: item.category_id,
              occurred_day: item.occurred_day,
              /*
               * 预算排除的三个来源：借款语义 / 结清语义 / 用户勾了「不计入预算」
               * 收支排除：借款语义排除；结清语义必须计入；
               *           待报销的钱还没回来，也先排除。
               */
              exclude_from_budget: isLoanMove || isSettleCat || itemExcludeBudget,
              exclude_from_stats: isSettleCat ? false : (isLoanMove || itemPendingReimburse),
              /* 报销状态（只有支出才有意义） */
              reimburse_status: itemPendingReimburse ? 1 : 0,
              // ★ 模型识别出时刻就用它，否则由 store 按「此刻」处理
              occurred_at: item.occurred_time
                ? combineDayTime(item.occurred_day, item.occurred_time)
                : undefined,
              /*
               * 备注：优先用模型给的备注，没有就退回用户原话。
               * 用户原话仍作为「备注」保存 —— 这是他自己输入的说明，
               * 和已停用的「速记原文」不是同一件事。
               *
               * ★ 先用 cleanNote 把无信息量的残词剔除 ★
               *   AI 偶尔会把「花了」这种动词当备注吐出来
               *   （「打车花了 210 港币」→ note="花了"），
               *   直接拼进备注会变成「HKD 210.00 · 花了」，很滑稽。
               *   提示词已收紧，这里是代码兜底。
               *
               * ★ item.note 为「有意义的空」时不要再退回原话 ★
               *   cleanNote 判空说明模型给的备注是噪声，
               *   这时退回整句原话反而更糟（原话里含金额和币种）。
               */
              note: applyNoteTag(
                cleanNote(item.note) || (item.note ? '' : pendingText),
                originalCurrency
                  ? buildOriginalNoteTag(originalAmountCents, originalCurrency)
                  : null
              ),
              tag_ids: item.tag_ids,
              // 外币快照（人民币为 null）
              original_currency: originalCurrency,
              original_amount_cents: originalAmountCents,
              exchange_rate: exchangeRate
            })
            saved++
          } catch (e) {
            failures.push(e.message)
          }
        }

        if (saved > 0) {
          const summary = result.items
            .slice(0, 3)
            .map((i) => `${i.category_name || i.type} ¥${(i.amount_cents / 100).toFixed(2)}`)
            .join('、')
          const more = result.items.length > 3 ? ` 等 ${result.items.length} 笔` : ''

          uni.showToast({
            title: `已记 ${saved} 笔：${summary}${more}`,
            icon: 'none',
            duration: 2500
          })

          emit('saved')

          /*
           * ★ 这里不再检查恩格尔系数（本轮用户第 7 条）★
           *   旧版在每次 AI 记账结束后顺手让 AI 判一次食品分类，
           *   用户明确要求把这步挪走：**记账时什么都别查**，
           *   改为「每次点统计页时检查恩格尔系数的记录，有的话立即调 AI 分析」。
           *   见 pages/stats/index.vue 的 loadExtras()。
           */
        }

        // 部分失败或校验警告要告知用户
        /*
         * ★ 汇率失败必须单独说明 ★
         *   它和普通校验失败不同：用户以为记上了，其实那笔被跳过了。
         *   合并进 failures 一起弹，标题也要能覆盖这种情况。
         */
        const notes = [...result.warnings, ...rateErrors, ...failures]
        if (notes.length > 0) {
          if (saved > 0) {
            setTimeout(() => {
              alertDialog({
                title: rateErrors.length > 0 ? '部分记录未保存（汇率获取失败）' : '部分记录未保存',
                content: notes.slice(0, 5).join('\n')
              })
            }, 800)
          } else if (rateErrors.length > 0) {
            // 一笔都没存上，且原因是汇率 —— 直接说清楚
            await alertDialog({
              title: '未能记账',
              content: `${rateErrors.slice(0, 3).join('\n')}\n\n外币记账需要联网获取汇率，请检查网络后重试。`
            })
          }
        }
      } catch (e) {
        /*
         * ★ 「已报销」被拦下时换个标题 ★
         *   api/aiParse.js 会给这类错误打 isReimburseHint 标记，
         *   它不是「识别失败」（AI 明明听懂了），
         *   而是一条使用指引，标题得说清楚。
         */
        await alertDialog({
          title: e && e.isReimburseHint ? '报销需要手动确认' : '识别失败',
          content: e.message
        })
      } finally {
        submitting.value = false
        // 无论成功失败都要结束占位行动效
        emit('parsing-end')
      }
    }

    function onMaskClick() {
      if (!maskEnabled.value) return
      close()
    }

    /** 阻止遮罩上的滑动穿透到页面 */
    function noop() {}

    function close() {
      // 防重入：hideKeyboard() 会让键盘高度归零，
      // 而监听回调里 height===0 又会调 close()，不加锁会递归
      if (closing) return
      closing = true
      visible.value = false
      draft.value = ''
      /*
       * ★ 关闭时就把两个胶囊清掉（用户反馈的 bug）★
       *   上一版只在「下次打开」时重置。若某条退出路径没走到
       *   watch(modelValue) 的 open 分支（比如父层直接把 v-model 置 false、
       *   或侧滑返回走了弹层栈），勾选状态就会留到下一次，
       *   表现成「上次勾了没发送，这次打开还是勾着」。
       *   关闭时清一次 = 不管从哪条路退出都不会残留。
       */
      autoReimburse = false
      pendingReimburse.value = false
      excludeBudget.value = false
      autoFocus.value = false
      keyboardHeight.value = 0
      maskEnabled.value = false
      keyboardEverShown = false
      clearFocusTimers()
      if (refocusTimer) {
        clearTimeout(refocusTimer)
        refocusTimer = null
      }
      keepAliveUntil = 0
      if (maskTimer) {
        clearTimeout(maskTimer)
        maskTimer = null
      }
      unbindKeyboard()

      try {
        if (typeof uni.hideKeyboard === 'function') uni.hideKeyboard()
      } catch (e) {}

      /**
       * 解锁要快。
       * 这里只是防止 hideKeyboard 触发的回调递归，用不着等 50ms。
       * 等太久会让用户紧接着的下一次点击被这个锁挡住，
       * 表现为「第二次点 + 没反应」。
       */
      setTimeout(() => {
        closing = false
      }, 0)
    }

    /* ------------------------------------------------------ 生命周期 */

    /** 弹层栈注销函数 */
    let unregisterLayer = null

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    watch(
      () => props.modelValue,
      async (open) => {
        if (!open) {
          if (unregisterLayer) {
            unregisterLayer()
            unregisterLayer = null
          }
          unbindKeyboard()
          clearFocusTimers()
          // 兜底：父层直接置 false 时也不留勾选状态（见 close() 的注释）
          autoReimburse = false
          pendingReimburse.value = false
          excludeBudget.value = false
          return
        }

        /*
         * ★ 登记到弹层栈 ★
         *   侧滑返回 / 返回键先收起输入条（走 close()，会顺带收起键盘、
         *   清空草稿），而不是直接退出整个首页。
         */
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => close(), 'quickAddBar')
        }

        keyboardHeight.value = 0
        maskEnabled.value = false
        keyboardEverShown = false
        closing = false

        /*
         * ★ 每次打开都从「都不勾」开始 ★
         *   这两个胶囊是「这一笔」的属性，粘到下一笔会让人误记 ——
         *   上一句说了「要报销」，下一句日常早饭还带着待报销，
         *   那笔账就永远不会进收支统计。
         *   （草稿清空时 watch(draft) 也会兜一次，但用户可能只是
         *   手动点开胶囊、根本没打过字，所以这里显式重置。）
         */
        autoReimburse = false
        pendingReimburse.value = false
        excludeBudget.value = false

        // 延迟启用遮罩，挡掉记账按钮抬起时补发的那次 click
        if (maskTimer) clearTimeout(maskTimer)
        maskTimer = setTimeout(() => {
          maskEnabled.value = true
          maskTimer = null
        }, 350)

        bindKeyboard()
        await nextTick()

        /**
         * 聚焦。
         *
         * ★ 不能再用「autoFocus 先 false 再 true」那招 ★
         *   把 focus 设为 false 会**真的收起键盘**。而键盘一收起，
         *   onKeyboardHeightChange 就会回调 height=0，触发 close()，
         *   于是：输入条刚出现就消失、tabBar 和 + 跑到键盘上方。
         *   （真机日志实测：第二次打开后 213ms 键盘就被这个技巧收掉了。）
         *
         *   现在组件是 v-if 挂载的，每次打开都是全新的 input 元素，
         *   :focus="true" 在挂载时就会生效，不需要再折腾。
         *   若某些机型仍不生效，用 ref 调 focus() 兜底，
         *   那不会引起键盘收起。
         */
        autoFocus.value = true

        clearFocusTimers()
        focusTimer = setTimeout(() => {
          focusTimer = null
          if (!visible.value) return
          // 兜底：用 ref 直接聚焦，不改 focus 属性，避免收起键盘
          try {
            if (inputRef.value && typeof inputRef.value.focus === 'function') {
              inputRef.value.focus()
            }
          } catch (e) {}
        }, 300)
      },
      { immediate: false }
    )

    return {
      visible, draft, submitting, autoFocus, inputRef,
      primaryColor, canSend, barStyle,
      pendingReimburse, excludeBudget, flagsStyle,
      togglePendingReimburse, toggleExcludeBudget, holdInputAlive,
      onChipTap, onChipClick,
      submit, close, onMaskClick, noop
    }
  }
}
</script>

<style scoped>
.quick-add-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 600;
  background-color: transparent;
}

/**
 * ★ 背景层：只负责「挡住页面」与「点空白关闭」★
 *   独立成一个铺满全屏的层，触摸拦截绑在它身上（见模板注释）。
 *
 *   transparent 而不是半透明黑 —— 保持原有观感：
 *   输入条浮起时页面内容不被压暗，只是单纯不能再点。
 */
.quick-add-mask-bg {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: transparent;
}

/*
 * ★ 柔光玻璃输入条（与底部 tabbar 同款）★
 *   底色走 --glass-* 变量（barStyle 里由 glassVars 注入）。
 *   兜底顺序和 tabbar 一致：先给高不透明度实色，
 *   @supports 命中 backdrop-filter 后才换成更透的 + 模糊。
 *   不支持模糊的设备（多数安卓 WebView）走实色，不会「透出内容却不糊」显脏。
 *
 *   圆角保持 48rpx 胶囊，描边用玻璃内高光而不是实线，
 *   这样浮在页面内容上时边界是「折射感」而不是「画了个框」。
 */
/*
 * 输入框上方的两个胶囊（待报销 / 不计入预算）
 *
 * ★ 为什么浮在输入条上方而不是塞进输入条 ★
 *   输入条高度已经被输入框 + 发送按钮占满，再塞两个胶囊会把
 *   输入框压得很窄；而这一行只在需要时看一眼，浮在上面更清爽。
 *   bottom 由 flagsStyle 计算（输入条高度 + 间距），
 *   和 barStyle 的 bottom 保持同一个基准，键盘弹起时两者一起抬。
 */
.quick-add-flags {
  position: fixed;
  left: 32rpx;
  z-index: 601;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

/*
 * 两个胶囊（待报销 / 不计入预算）
 *
 * ★ 不再用主题色描边（用户本轮要求）★
 *   用户原话：「优化一下 ai 记账上方两个小胶囊的样式，
 *   尝试不是用主题色描边，但是不要和背景融为一体」。
 *
 *   为什么去掉主题色描边：
 *     主题色描边在这里是「两件事说一遍」——
 *     胶囊里已经有一个主题色的勾选框，再给整个胶囊描上同色边框，
 *     两个小元素抢同一份注意力，看起来像「一个按钮里套了另一个按钮」。
 *     浅色下尤其明显：绿边 + 绿框 + 绿勾，三层绿堆在一起反而脏。
 *
 *   那怎么保证不和背景融在一起：
 *     靠**中性描边 + 投影**把它从背景里抬起来，而不是靠颜色叫喧。
 *     1) 卡片色底（--app-card：浅色白、深色 #1C1C1E）——
 *        它浮在普通页面内容上，白底与内容区分开；
 *     2) 1rpx 中性描边（--app-line）——浅色下白底白底也有一圈轮廓，
 *        深色下 #1C1C1E 底 + #2E2E31 边清楚地分出轮廓；
 *     3) 投影（--app-shadow）——这是最关键的一层：
 *        弹窗/悬浮元素「离开页面」的感觉靠得就是它。
 *        没有投影时，浅色下白胶囊盖在白卡片上就是一块「真空」。
 *
 * ★ 选中态怎么表达 ★
 *   不描主题色边了，就反过来用**主题浅底填充**：
 *   底色一变，「点没点上」比描边更一目了然，而且不会和内部勾选框抢颜色。
 *   用 --app-primary-light-solid（不透明）而不是 --app-primary-light（半透明）：
 *   胶囊是圆角大、面积小的元素，半透明底在深色下会和投影叠在一起发灰。
 */
.qa-chip {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background-color: var(--app-card);
  border: 1rpx solid var(--app-line);
  /*
   * 关键：没有这层投影，浅色下白胶囊会和白卡片融成一片。
   *
   * ★ 为什么不直接用 --app-shadow ★
   *   那个是给整张卡片的（0 2rpx 16rpx），模糊半径大、浓度低，
   *   小尺寸的胶囊用它几乎看不出投影。
   *   这里用更小的半径 + 更集中的浓度，胶囊才像「浮在输入条上面」。
   */
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.10);
}

/*
 * 选中态：**只换底色**，描边仍然是中性色
 *
 * ★ 为什么选中也不给主题色描边 ★
 *   用户要求的是「不用主题色描边」，如果选中了又浮出一圈绿边，
 *   那只是把同一个问题推到了另一个状态里。
 *   底色从卡片色 → 主题浅色，这个变化本身就够明显；
 *   层级感仍然靠基础那层 --app-shadow 提供，不用叠。
 */
.qa-chip.on {
  background-color: var(--app-primary-light-solid);
}

/* 深色下需要更重的投影：黑底上 10% 的阴影几乎看不见，胶囊会漂在半空中 */
.wot-theme-dark .qa-chip {
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.55);
}

/* 锁死态（待报销时的「不计入预算」）：只把整体压暗一点表示不可点 */
.qa-chip.locked {
  opacity: 0.85;
}

/*
 * 勾选框：未选中用中性灰描边，选中才填主题色
 *
 * ★ 为什么未选中不用主题色 ★
 *   未选中时它只是一个「空位」，用主题色描边会让人以为
 *   已经选上了（小忽得只看边框不看对勾）。
 *   用 --app-text-3 的灰描边，「这里可以打勾」的暗示刚刚好。
 */
.qa-chip-box {
  width: 28rpx;
  height: 28rpx;
  border-radius: 6rpx;
  border: 2rpx solid var(--app-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background-color 0.16s ease, border-color 0.16s ease;
}

.qa-chip-box.on {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.qa-chip-tick {
  font-size: 18rpx;
  color: #ffffff;
  line-height: 1;
}

.qa-chip-text {
  font-size: 22rpx;
  color: var(--app-text-2);
}

/* 选中后文字跟着加重，和浅底一起强化「已勾上」 */
.qa-chip.on .qa-chip-text {
  color: var(--app-text);
  font-weight: 500;
}

.quick-add-bar {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 12rpx 12rpx 12rpx 28rpx;
  background-color: var(--glass-bg-solid, var(--app-card));
  border-radius: 48rpx;
  border-width: 1rpx;
  border-style: solid;
  border-color: var(--glass-border, rgba(255, 255, 255, 0.75));
  box-shadow: var(--glass-shadow, 0 8rpx 32rpx rgba(0, 0, 0, 0.16));
  transition: bottom 0.18s ease;
}

@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .quick-add-bar {
    background-color: var(--glass-bg, var(--app-card));
    -webkit-backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
    backdrop-filter: saturate(180%) blur(var(--glass-blur, 24rpx));
  }
}

/**
 * ★ 输入框必须能在 flex 行里被压缩 ★
 *
 *   App 端 <input> 编译成 <uni-input>，它在 flex 容器里默认 min-width:auto
 *   —— 「auto」意味着最小宽度等于内容宽度。
 *   文本一长，这个最小宽度跟着涨，于是整条输入条被撑开、
 *   把右侧发送按钮挤出去；输入框自身的可视宽度却没变，
 *   用户看到的就是「文本被遮住、还滑不动」。
 *
 *   三步一起给才有效：
 *     flex: 1      —— 占满剩余空间
 *     width: 0     —— 把基准宽度归零，否则 flex-basis:auto 还是按内容算
 *     min-width: 0 —— 允许缩到比内容更窄（关键的一条）
 *   三者齐备后，输入框宽度只由容器决定，溢出的文字交给原生输入框
 *   自己的横向滚动处理，左右拖动就能看到被遮住的部分。
 *
 *   视觉不变：height / line-height / font-size 原样保留。
 */
.bar-input {
  flex: 1;
  width: 0;
  min-width: 0;
  height: 64rpx;
  font-size: 28rpx;
  color: var(--app-text);
  line-height: 64rpx;
}

.bar-placeholder {
  color: var(--app-text-3);
  font-size: 26rpx;
}

.bar-send {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.send-icon {
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 600;
  line-height: 1;
}
</style>
