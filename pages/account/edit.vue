<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-inner">
        <text class="nav-back" @click="goBack">‹</text>
        <text class="nav-title">{{ isEdit ? '编辑账户' : '添加账户' }}</text>
        <text class="nav-action" @click="onSave">保存</text>
      </view>
    </view>

    <scroll-view class="page-scroll" scroll-y>
      <!--
        账户图标：从预设里挑一个

        ★ 为什么不再让 AI 画 ★
          用户原话：「ai 生成图标又报错了，修改下逻辑吧，
          删除生成图标功能，给定几个待选项，让用户选择图标」。
          AI 画图在真机上反复出问题（max_tokens 截断、推理模型不吃
          关闭思考的参数、页面销毁后回调崩溃…），
          而这个功能的收益远不如它的不稳定带来的麻烦。
          改成预设图标：立刻可选、零失败、完全可控。
      -->
      <view class="icon-preview-wrap">
        <view class="icon-preview" :style="{ backgroundColor: (form.color || primaryColor) + '22' }">
          <!-- 选中的预设图标；没选就退回首字符 -->
          <AccountIcon
            v-if="form.icon"
            :name="form.icon"
            :size="30"
            :color="form.color || primaryColor"
          />
          <text
            v-else
            class="icon-preview-text"
            :style="{ color: form.color || primaryColor }"
          >{{ form.name.trim().slice(0, 1) || '?' }}</text>
        </view>
      </view>

      <!-- 图标选择器：3 行 × 6 列 = 18 个 -->
      <view class="form-card">
        <view class="form-row form-row-column">
          <text class="form-label">账户图标</text>
          <view class="icon-grid">
            <view
              v-for="ic in ACCOUNT_ICONS"
              :key="ic.key"
              class="icon-cell"
              :class="{ active: form.icon === ic.key }"
              @click="form.icon = (form.icon === ic.key ? '' : ic.key)"
            >
              <view
                class="icon-cell-inner"
                :style="form.icon === ic.key
                  ? { backgroundColor: (form.color || primaryColor) + '22', borderColor: form.color || primaryColor }
                  : {}"
              >
                <!--
                  ★ 颜色必须传真实色值，不能传 CSS 变量 ★
                    LineIcon 内部把 SVG 编成 data URI 加载，
                    那是一个**独立的图片文档**，不在页面的 CSS 环境里，
                    `var(--app-text-2)` 在那里根本不存在 ->
                    stroke 变成无效值 -> 图标渲染成透明（看不见）。
                    这就是「图标要点击之后才看得见」的原因：
                    点中时传的是真实主题色，才显出来。
                -->
                <AccountIcon
                  :name="ic.key"
                  :size="24"
                  :color="form.icon === ic.key ? (form.color || primaryColor) : iconInk"
                />
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 名称与类型 -->
      <view class="form-card">
        <view class="form-row">
          <text class="form-label">账户名称</text>
          <input
            v-model="form.name"
            class="form-input"
            placeholder="如 招商银行"
            placeholder-class="form-placeholder"
            :maxlength="20"
          />
        </view>

        <!--
          账户类型

          ★ 组合账户不可改（用户明确要求）★
            组合是「按顺序扣款」的虚拟账户，没有余额、没有流水，
            和真实账户之间转换会让余额/成员语义彻底乱掉
            （真实账户有余额、组合有成员列表，两边互斥）。
            所以组合账户的类型锁死，只显示当前类型。

          ★ 其余账户类型都可以改（用户明确要求）★
            以前编辑时整个类型项是锁死的，导致「现金记成了储蓄卡」
            这种建错类型的情况没法自己修，只能删了重建（余额和流水全丢）。
            现在编辑时也能改类型：切换成信用卡就出现额度/账单日，
            切回储蓄卡就把这些清掉（保存时字段置 null）。

          ★ API 层还有一道兜底 ★
            api/account.js 的 updateAccount() 会拦住「组合 <-> 真实」的转换，
            见那边的注释。
        -->
        <view v-if="isEdit && isCombo" class="form-row">
          <text class="form-label">账户类型</text>
          <text class="type-locked">{{ typeName }}</text>
        </view>
        <view v-else class="form-row form-row-column">
          <text class="form-label">账户类型</text>
          <view class="type-grid">
            <view
              v-for="t in selectableTypes"
              :key="t.key"
              class="type-cell"
              :class="{ active: form.type === t.key }"
              @click="onPickType(t.key)"
            >
              <text
                class="type-cell-text"
                :style="{ color: form.type === t.key ? primaryColor : 'var(--app-text-2)' }"
              >{{ t.name }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 余额与额度（组合账户没有余额，整块不显示） -->
      <view v-if="!isCombo" class="form-card">
        <!--
          ★ 编辑时：余额只读展示 + 「修改」按钮 ★
            用户要求「不要直接改余额，改成一个弹层，
            改金额的同时下方可选『计入对账收支』或『修改当前余额』」。
            所以这里不再放可编辑的输入框 ——
            直接输入框改余额有两个说不清的地方：
              · 差额去哪了？（记成什么账）
              · 是不是把期初余额一起改了？
            这两件事的答案不一样，必须让用户自己选，见下面的余额弹层。
        -->
        <view v-if="isEdit" class="form-row">
          <text class="form-label">当前余额</text>
          <view class="bal-row-right">
            <MoneyText :cents="currentBalanceCents" :size="28" :weight="500" />
            <text class="bal-edit-link" @click="openBalanceSheet">修改</text>
          </view>
        </view>

        <!-- 新建时：填的就是期初余额，直接输入框最省事 -->
        <view v-else class="form-row">
          <text class="form-label">初始余额</text>
          <input
            v-model="form.balanceYuan"
            class="form-input"
            type="digit"
            placeholder="0.00"
            placeholder-class="form-placeholder"
          />
        </view>

        <view class="form-row">
          <text class="form-label">计入总资产</text>
          <switch
            :checked="form.include_in_total"
            :color="primaryColor"
            @change="onToggleInclude"
          />
        </view>

        <!-- 信用卡专属 -->
        <block v-if="isCredit">
          <view class="form-row">
            <text class="form-label">信用额度</text>
            <input
              v-model="form.creditLimitYuan"
              class="form-input"
              type="digit"
              placeholder="如 20000"
              placeholder-class="form-placeholder"
            />
          </view>
          <view class="form-row">
            <text class="form-label">账单日</text>
            <picker
              mode="selector"
              :range="dayRange"
              :value="form.bill_day - 1"
              @change="(e) => form.bill_day = Number(e.detail.value) + 1"
            >
              <text class="form-picker">{{ form.bill_day }} 号</text>
            </picker>
          </view>
          <view class="form-row">
            <text class="form-label">还款日</text>
            <picker
              mode="selector"
              :range="dayRange"
              :value="form.repay_day - 1"
              @change="(e) => form.repay_day = Number(e.detail.value) + 1"
            >
              <text class="form-picker">{{ form.repay_day }} 号</text>
            </picker>
          </view>
          <view class="form-row">
            <text class="form-label">卡号后四位</text>
            <input
              v-model="form.card_tail"
              class="form-input"
              type="number"
              placeholder="选填"
              placeholder-class="form-placeholder"
              :maxlength="4"
            />
          </view>
        </block>
      </view>

      <!-- 组合账户：扣款顺序成员配置 -->
      <view v-if="isCombo" class="form-card">
        <view class="form-row form-row-column">
          <text class="form-label">扣款顺序</text>

          <view v-if="memberList.length > 0" class="member-list">
            <view v-for="(m, idx) in memberList" :key="m.id" class="member-item">
              <text class="member-order">{{ idx + 1 }}</text>
              <view class="member-icon" :style="{ backgroundColor: (m.color || primaryColor) + '22' }">
                <AccountIcon
                  v-if="m.icon"
                  :name="m.icon"
                  :size="16"
                  :color="m.color || primaryColor"
                />
                <text v-else class="member-icon-text" :style="{ color: m.color || primaryColor }">
                  {{ m.name.slice(0, 1) }}
                </text>
              </view>
              <text class="member-name">{{ m.name }}</text>
              <view class="member-ops">
                <text
                  class="member-op"
                  :class="{ disabled: idx === 0 }"
                  @click="moveMember(idx, -1)"
                >↑</text>
                <text
                  class="member-op"
                  :class="{ disabled: idx === memberList.length - 1 }"
                  @click="moveMember(idx, 1)"
                >↓</text>
                <text class="member-op member-op-del" @click="removeMember(idx)">✕</text>
              </view>
            </view>
          </view>

          <view class="add-member-btn" @click="openMemberPicker">
            <text class="add-member-text">+ 添加成员</text>
          </view>
        </view>
      </view>

      <!-- 仅编辑真实账户时保留「对账调整」说明；组合/新建不加提示 -->
      <view v-if="isEdit && !isCombo" class="tip-card">
        <text class="tip-text">
          点「修改」可以改实际余额：选「计入对账收支」时差额会记成一笔对账交易，
          选「修改当前余额」则直接改期初余额、不产生流水。
        </text>
      </view>

      <view v-if="isEdit" class="danger-area">
        <!-- block + width:100%：横向撑满整个内容区 -->
        <wd-button size="large" plain block custom-class="del-btn" @click="onDelete">
          {{ isCombo ? '删除组合账户' : '删除账户' }}
        </wd-button>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 组合成员多选弹层：底部弹窗，侧滑返回可收起（登记进弹层栈） -->
    <view v-if="showMemberPicker" class="member-mask" @click="closeMemberPicker">
      <view class="member-sheet" @click.stop>
        <view class="member-sheet-head">
          <text class="member-sheet-title">选择成员</text>
          <text class="member-sheet-close" @click="closeMemberPicker">✕</text>
        </view>
        <scroll-view class="member-sheet-body" scroll-y>
          <view
            v-for="m in availableMembers"
            :key="m.id"
            class="member-pick-item"
            @click="toggleMember(m.id)"
          >
            <view class="member-icon" :style="{ backgroundColor: (m.color || primaryColor) + '22' }">
              <AccountIcon
                v-if="m.icon"
                :name="m.icon"
                :size="16"
                :color="m.color || primaryColor"
              />
              <text v-else class="member-icon-text" :style="{ color: m.color || primaryColor }">
                {{ m.name.slice(0, 1) }}
              </text>
            </view>
            <text class="member-pick-name">{{ m.name }}</text>
            <view class="member-pick-check" :class="{ checked: pickDraft.includes(m.id) }">
              <text v-if="pickDraft.includes(m.id)" class="member-pick-checkmark">✓</text>
            </view>
          </view>
          <view v-if="availableMembers.length === 0" class="member-pick-empty">
            没有可选的账户（组合不能包含组合或信用卡）
          </view>
        </scroll-view>
        <view class="member-sheet-foot">
          <view class="member-sheet-btn" @click="confirmMembers">确定</view>
        </view>
      </view>
    </view>

    <!--
      余额修改弹层

      ★ 为什么必须弹层，而不是直接在表单里输入 ★
        用户要求：「更改账户余额的时候不要直接修改，改成一个弹窗/弹层，
        修改金额的同时下方提供单选『计入对账收支』（默认）、『修改当前余额』」。
        两种口径的账务结果完全不同，必须让用户明确选一个：
          · 计入对账收支 —— 差额记一笔「对账支出/对账收入」流水，
            余额公式仍成立，流水里看得见这笔调整（推荐，默认）
          · 修改当前余额 —— 直接改期初余额，不产生任何流水

      ★ 侧滑返回 / 返回键会先收起它 ★
        和「选择成员」弹层一样登记进弹层栈，
        免得全面屏侧滑直接退出编辑页、改了一半的余额丢了。
    -->
    <view v-if="showBalanceSheet" class="bs-mask" @click="closeBalanceSheet">
      <view class="bs-sheet" @click.stop>
        <view class="bs-head">
          <text class="bs-title">修改余额</text>
          <text class="bs-close" @click="closeBalanceSheet">✕</text>
        </view>

        <view class="bs-body">
          <view class="bs-amount-row">
            <text class="bs-currency">{{ settingStore.currencySymbol }}</text>
            <input
              v-model="balanceDraft"
              class="bs-input"
              type="digit"
              placeholder="0.00"
              placeholder-class="bs-placeholder"
              :focus="balanceAutoFocus"
            />
          </view>

          <!-- 差额预览：让用户改之前就知道会发生什么 -->
          <view class="bs-diff">
            <text class="bs-diff-label">相对当前余额</text>
            <text class="bs-diff-value" :style="{ color: balanceDiffCents === 0 ? 'var(--app-text-3)' : (balanceDiffCents > 0 ? 'var(--app-income, #07C160)' : 'var(--app-danger)') }">
              {{ balanceDiffText }}
            </text>
          </view>

          <view class="bs-options">
            <view
              v-for="opt in balanceModes"
              :key="opt.key"
              class="bs-option"
              @click="balanceMode = opt.key"
            >
              <!-- 单选圆圈：不引第三方单选组件，避免和弹层层级打架 -->
              <view class="bs-radio" :class="{ checked: balanceMode === opt.key }">
                <view v-if="balanceMode === opt.key" class="bs-radio-dot" />
              </view>
              <view class="bs-option-text">
                <text class="bs-option-label">{{ opt.label }}</text>
                <text class="bs-option-desc">{{ opt.desc }}</text>
              </view>
            </view>
          </view>
        </view>

        <view class="bs-foot">
          <view class="bs-btn-cancel" @click="closeBalanceSheet">取消</view>
          <view class="bs-btn-ok" :style="{ backgroundColor: primaryColor }" @click="confirmBalance">确定</view>
        </view>
      </view>
    </view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import { onLoad, onBackPress } from '@dcloudio/uni-app'
import AppDialog from '@/components/AppDialog.vue'
import AccountIcon from '@/components/AccountIcon.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import {
  ACCOUNT_TYPES, isCreditType, isComboType, adjustAccountBalance,
  setAccountBalanceDirect, listComboMemberIds
} from '@/api/account.js'
import { ACCOUNT_ICONS } from '@/utils/accountIcons.js'
import { yuanToCents, formatCents } from '@/utils/money.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'
import { backAfterAccountDelete } from '@/utils/navBack.js'
import MoneyText from '@/components/MoneyText.vue'

export default {
  components: { AppDialog, AccountIcon, MoneyText },
  setup() {
    const settingStore = useSettingStore()

    /**
     * 未选中图标的描边色。
     *
     * ★ 必须是真实 hex，不能是 CSS 变量 ★
     *   AccountIcon 把 SVG 编成 data URI 加载，那是独立图片文档，
     *   `var(--app-text-2)` 在那里不存在 -> stroke 无效 -> 图标透明。
     *   这正是「图标要点了才看得见」的 bug 根因。
     *
     *   跟主题走：深色用浅灰、浅色用深灰，两边都有对比度。
     */
    const iconInk = computed(() => (settingStore.isDark ? '#A1A1A6' : '#646566'))
    const accountStore = useAccountStore()

    const statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 20
    const editId = ref('')
    const isEdit = ref(false)
    const initialSnapshot = ref(null)

    const form = reactive({
      name: '',
      type: 'cash',
      balanceYuan: '',
      include_in_total: true,
      creditLimitYuan: '',
      bill_day: 1,
      repay_day: 20,
      card_tail: '',
      color: '',
      /**
       * 选中的预设图标 key（空串 = 用账户名首字符）。
       *
       * 之前这里是 AI 生成的 SVG data URI 字符串。
       * 改成预设 key 之后，数据库里 icon 字段存的就是
       * 'account' / 'creditcard' 这样的短 key，
       * 渲染时走 LineIcon（和其他页面同一套线性图标），
       * 既统一又不用为每个账户存一大串 SVG。
       */
      icon: ''
    })

    /* -------------------------------------------------------- 余额弹层 */

    /**
     * 余额弹层
     *
     * ★ 为什么不是「直接改输入框」★
     *   改余额有两种完全不同的账务口径，必须让用户选：
     *     · 计入对账收支（默认）—— 差额记一笔对账流水，余额公式仍成立
     *     · 修改当前余额        —— 直接改期初余额，不产生流水
     *   所以金额和口径一起放在弹层里改。
     */
    const showBalanceSheet = ref(false)
    /** 弹层里正在输入的金额（元，字符串） */
    const balanceDraft = ref('')
    /** 弹层里的口径：'reconcile' | 'direct' */
    const balanceMode = ref('reconcile')
    /** 弹层打开时自动聚焦金额输入框 */
    const balanceAutoFocus = ref(false)

    /** 当前账户余额（分）—— 保存前它是库里的值，保存后跟着刷新 */
    const currentBalanceCents = computed(() => {
      const acc = initialSnapshot.value
      if (!acc) return 0
      return Number(acc.balance_cents) || 0
    })

    /** 弹层里输入的金额（分） */
    const balanceTargetCents = computed(() => yuanToCents(balanceDraft.value || 0))

    /** 相对当前余额的差额（分） */
    const balanceDiffCents = computed(() =>
      balanceTargetCents.value - currentBalanceCents.value
    )

    /** 差额文案（带正负号，0 显示「无变化」） */
    const balanceDiffText = computed(() => {
      const d = balanceDiffCents.value
      if (d === 0) return '无变化'
      return `${d > 0 ? '+' : '-'}${formatCents(Math.abs(d), { symbol: settingStore.currencySymbol })}`
    })

    /** 两种口径的说明 */
    const balanceModes = [
      {
        key: 'reconcile',
        label: '计入对账收支',
        desc: '差额记一笔「对账支出 / 对账收入」，流水里看得见（默认）'
      },
      {
        key: 'direct',
        label: '修改当前余额',
        desc: '直接改期初余额，不产生任何流水'
      }
    ]

    function openBalanceSheet() {
      balanceDraft.value = (currentBalanceCents.value / 100).toFixed(2)
      balanceMode.value = 'reconcile'
      balanceAutoFocus.value = false
      showBalanceSheet.value = true
      // 下一帧再聚焦：弹层刚渲染时 input 还不存在，直接 true 不生效
      setTimeout(() => { balanceAutoFocus.value = true }, 60)
    }

    function closeBalanceSheet() {
      showBalanceSheet.value = false
      balanceAutoFocus.value = false
    }

    /**
     * 弹层确定：按选中的口径改余额。
     *
     * ★ 改完要刷新余额 + 列表 ★
     *   本页的「当前余额」读的是 initialSnapshot，
     *   改完必须重新拉一次账户，否则弹层里会一直显示旧值。
     */
    async function confirmBalance() {
      if (!editId.value) return

      const target = balanceTargetCents.value
      if (target === currentBalanceCents.value) {
        closeBalanceSheet()
        uni.showToast({ title: '余额没有变化', icon: 'none' })
        return
      }

      try {
        let res
        if (balanceMode.value === 'reconcile') {
          res = await adjustAccountBalance(editId.value, target)
        } else {
          res = await setAccountBalanceDirect(editId.value, target)
        }

        await accountStore.refresh()
        // 余额变了，「当前余额」要跟着变
        const acc = await accountStore.getById(editId.value)
        if (acc) initialSnapshot.value = acc

        closeBalanceSheet()

        if (res && res.changed) {
          const diff = res.delta
          uni.showToast({
            title: `${balanceMode.value === 'reconcile' ? '已记对账' : '已改余额'} ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)}`,
            icon: 'none'
          })
        } else {
          uni.showToast({ title: '已保存', icon: 'none' })
        }
      } catch (e) {
        await alertDialog({ title: '修改失败', content: e.message })
      }
    }

    /* ------------------------------------------------------ 组合账户 */    /**
     * 组合账户的成员（按扣款顺序）。
     * 元素是账户对象（含 name/color/icon），渲染 + 排序都直接用。
     */
    const memberList = ref([])
    const showMemberPicker = ref(false)
    /** 多选弹窗里正在勾选的成员 id（确认前不落到 memberList） */
    const pickDraft = ref([])

    /** 页面是否还活着（保存流程里判断，避免卸载后调 UI 接口） */
    const alive = ref(true)
    onUnmounted(() => { alive.value = false })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)
    const isCredit = computed(() => isCreditType(form.type))
    const isCombo = computed(() => isComboType(form.type))

    /** 编辑模式里只读展示的账户类型名 */
    const typeName = computed(() => {
      const t = ACCOUNT_TYPES.find((x) => x.key === form.type)
      return t ? t.name : '现金'
    })

    /**
     * 可选账户类型
     *
     * ★ 规则 ★
     *   新建：五种真实类型任选（组合账户是「辅助工具」,
     *        不该在同一条「新建现金/储蓄卡」的路径里混进来 ——
     *        它没有余额字段，表单会整个变形）。
     *        新建组合账户的入口不在本页，见账户页的分组说明。
     *   编辑真实账户：五种真实类型之间随便改（可以现金改储蓄卡、
     *        储蓄卡改信用卡），但**不能改成组合** ——
     *        组合没有余额，转换会让余额语义彻底乱掉。
     *   编辑组合账户：类型整块锁死（模板里走只读分支）。
     */
    const selectableTypes = computed(() =>
      ACCOUNT_TYPES.filter((t) => !t.isCombo)
    )

    /**
     * 切换账户类型
     *
     * ★ 切出信用卡时要把信用卡专属字段清掉 ★
     *   否则「储蓄卡 -> 信用卡 -> 储蓄卡」之后，
     *   数据库里会残留一份额度/账单日，总资产统计里
     *   它只是个普通储蓄卡，但编辑页会冒出莫名其妙的额度行。
     */
    function onPickType(key) {
      if (form.type === key) return
      form.type = key

      if (!isCreditType(key)) {
        form.creditLimitYuan = ''
        form.bill_day = 1
        form.repay_day = 20
        form.card_tail = ''
      }
    }

    /**
     * 组合成员候选：真实账户，排除组合（禁止嵌套）和信用卡（不支持）。
     */
    const availableMembers = computed(() =>
      accountStore.list.filter((a) => !a.isCombo && !a.isCredit)
    )

    const dayRange = Array.from({ length: 31 }, (_, i) => `${i + 1}`)

    function onToggleInclude(e) {
      form.include_in_total = e.detail.value
    }

    /* ------------------------------------------------- 组合成员操作 */

    function openMemberPicker() {
      // 打开时把当前已选成员带进去，方便增删
      pickDraft.value = memberList.value.map((m) => m.id)
      showMemberPicker.value = true
    }

    function closeMemberPicker() {
      showMemberPicker.value = false
    }

    /** 弹窗里勾选/取消某个候选账户 */
    function toggleMember(id) {
      const i = pickDraft.value.indexOf(id)
      if (i >= 0) pickDraft.value.splice(i, 1)
      else pickDraft.value.push(id)
    }

    /**
     * 确认成员选择。
     *
     * 顺序规则：保留原有成员的相对顺序，新加的成员按账户列表顺序追加到末尾。
     * 用户再用 ↑↓ 调整最终顺序。
     */
    function confirmMembers() {
      const byId = {}
      const listIndex = {}
      accountStore.list.forEach((a, i) => { byId[a.id] = a; listIndex[a.id] = i })

      const existingIds = memberList.value.map((m) => m.id)
      const keptIds = existingIds.filter((id) => pickDraft.value.includes(id))
      const newIds = pickDraft.value
        .filter((id) => !existingIds.includes(id))
        .sort((a, b) => listIndex[a] - listIndex[b])

      memberList.value = [...keptIds, ...newIds]
        .map((id) => byId[id])
        .filter(Boolean)

      showMemberPicker.value = false
    }

    /** 上移/下移成员（delta: -1 上移，+1 下移） */
    function moveMember(idx, delta) {
      const to = idx + delta
      if (to < 0 || to >= memberList.value.length) return
      const arr = memberList.value.slice()
      const [item] = arr.splice(idx, 1)
      arr.splice(to, 0, item)
      memberList.value = arr
    }

    /** 移除某个成员 */
    function removeMember(idx) {
      const arr = memberList.value.slice()
      arr.splice(idx, 1)
      memberList.value = arr
    }

    /* ------------------------------------------------- 成员弹层 · 侧滑收起 */
    /**
     * 成员多选是**全屏**自绘弹层。
     * 登记进弹层栈：全面屏左缘右滑 / 安卓返回键先收起它，而不是退出本页。
     * 打开时登记、关闭/卸载时摘掉（参照 TxnPanel / budget 页的做法）。
     */
    let unregisterMemberPicker = null
    watch(showMemberPicker, (open) => {
      if (open) {
        if (!unregisterMemberPicker) {
          unregisterMemberPicker = pushLayer(() => { showMemberPicker.value = false }, 'memberPicker')
        }
        return
      }
      if (unregisterMemberPicker) {
        unregisterMemberPicker()
        unregisterMemberPicker = null
      }
    })

    /**
     * 余额弹层同样登记进弹层栈。
     *
     * ★ 为什么必须登记 ★
     *   它也是全屏遮罩 —— 不登记的话，
     *   全面屏左缘右滑会直接退出整个编辑页，
     *   用户刚输好的金额和口径选择全丢。
     */
    let unregisterBalanceSheet = null
    watch(showBalanceSheet, (open) => {
      if (open) {
        if (!unregisterBalanceSheet) {
          unregisterBalanceSheet = pushLayer(() => {
            showBalanceSheet.value = false
            balanceAutoFocus.value = false
          }, 'balanceSheet')
        }
        return
      }
      if (unregisterBalanceSheet) {
        unregisterBalanceSheet()
        unregisterBalanceSheet = null
      }
    })

    // 侧滑返回 / 返回键：有弹层先收起弹层，不退出页面
    onBackPress(() => handleBackPress())

    async function loadExisting() {
      const acc = await accountStore.getById(editId.value)
      if (!acc) {
        uni.showToast({ title: '账户不存在', icon: 'none' })
        return
      }
      initialSnapshot.value = acc
      form.name = acc.name
      form.type = acc.type
      // 编辑时显示**当前余额**（不是期初余额）
      form.balanceYuan = (acc.balance_cents / 100).toFixed(2)
      form.include_in_total = acc.include_in_total
      form.creditLimitYuan = acc.credit_limit_cents ? (acc.credit_limit_cents / 100).toFixed(0) : ''
      form.bill_day = acc.bill_day || 1
      form.repay_day = acc.repay_day || 20
      form.card_tail = acc.card_tail || ''
      // 图标：预设 key（空串 = 用首字符）
      form.icon = acc.icon || ''

      // 组合账户：回填成员（按扣款顺序）
      if (acc.isCombo) {
        const ids = await listComboMemberIds(acc.id)
        const byId = {}
        accountStore.list.forEach((a) => { byId[a.id] = a })
        memberList.value = ids.map((id) => byId[id]).filter(Boolean)
      }
    }

    async function onSave() {
      if (!form.name.trim()) {
        uni.showToast({ title: '请填写账户名称', icon: 'none' })
        return
      }

      // 组合账户必须有成员（没有成员，记账时解析不出真实账户）
      if (isCombo.value && memberList.value.length === 0) {
        uni.showToast({ title: '请至少添加一个成员', icon: 'none' })
        return
      }

      /*
       * ★ 余额不再跟着「保存」一起改 ★
       *   用户要求改余额走独立的弹层（可以选口径），
       *   所以/onSave 只管账户资料：
       *     新建 -> 期初余额 = 表单里填的初始余额
       *     编辑 -> 余额已经被弹层改过了，这里一个字段都不碰
       *
       *   编辑时 form.balanceYuan 还留着旧值（loadExisting 回填的），
       *   这里绝不能拿它当 initial_balance_cents 写回去 ——
       *   那会把用户在弹层里改好的余额又覆盖掉。
       */
      const targetCents = yuanToCents(form.balanceYuan || 0)

      // 新建：余额就是期初余额（还没有任何交易）
      const payload = {
        name: form.name.trim(),
        type: form.type,
        include_in_total: form.include_in_total,
        credit_limit_cents: isCredit.value && form.creditLimitYuan
          ? yuanToCents(form.creditLimitYuan)
          : null,
        bill_day: isCredit.value ? form.bill_day : null,
        repay_day: isCredit.value ? form.repay_day : null,
        card_tail: form.card_tail || null,
        // 预设图标 key（空串 = 用首字符）
        icon: form.icon || null
      }

      // 组合账户：带上成员（有序），其余余额类字段 API 层会强制忽略
      if (isCombo.value) {
        payload.member_ids = memberList.value.map((m) => m.id)
        payload.include_in_total = false
      }

      try {
        if (isEdit.value) {
          /*
           * 编辑：只更新账户资料。
           *
           * ★ 余额与类型的关系 ★
           *   类型可以改了（v14 起），如果从信用卡改成储蓄卡，
           *   payload 里的 credit_limit_cents / bill_day / repay_day 是 null，
           *   updateAccount 会把它们写空 —— 是对的（不再是信用卡了）。
           *
           * ★ 余额不受影响 ★
           *   期初余额没动，所以余额（期初 + 收入 - 支出）自然不变。
           *   用户如果刚在弹层里改过余额，那个改动已经落库了，
           *   这里重新 update 一遍不会把它冲掉（payload 里没有余额字段）。
           */
          await accountStore.update(editId.value, payload)
          await accountStore.refresh()
          uni.showToast({ title: '已保存', icon: 'success' })
        } else {
          // 新建：期初余额 = 填的余额（组合账户期初恒 0，由 API 层强制）
          const acc = await accountStore.create({
            ...payload,
            initial_balance_cents: targetCents
          })
          // 第一个真实账户自动设为默认（组合账户不能当默认）
          if (!acc.isCombo && accountStore.list.filter((a) => !a.isCombo).length === 1) {
            await settingStore.update({ defaultAccountId: acc.id })
          }
          uni.showToast({ title: '已添加', icon: 'success' })
        }
        /*
         * ★ 编辑真实账户保存后：退到账户列表，而不是退回详情页 ★
         *   原因和删除一样 —— 详情页是「某个账户」的视图，
         *   但用户可能刚把类型从储蓄卡改成了信用卡，
         *   详情页里信用卡专属的额度/还款日区块要重新按新类型渲染。
         *   退回账户列表（用户能看到改完之后的分组位置也变了）更自然。
         *
         *   新建账户照旧：回上一页（通常是账户列表或首页）。
         */
        if (isEdit.value && !isCombo.value) {
          setTimeout(() => backAfterAccountDelete(), 500)
        } else {
          setTimeout(() => uni.navigateBack(), 500)
        }
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function onDelete() {
      const confirmed = await confirmDialog({
        title: isCombo.value ? '删除组合账户？' : '删除账户？',
        content: isCombo.value
          ? '组合账户本身没有流水，删除后不影响任何交易记录'
          : '该账户下的交易会变成「无账户」，交易记录本身不会删除',
        confirmText: '删除',
        danger: true
      })
      // ★ 取消就什么都不做 ★
      if (!confirmed) return

      try {
        await accountStore.remove(editId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => leaveAfterDelete(), 500)
      } catch (e) {
        await alertDialog({ title: '无法删除', content: e.message })
      }
    }

    /**
     * 删除账户后怎么退出
     *
     * ★ 问题 ★
     *   用户从「账户页 → 某个账户详情 → 编辑」进来删除时，
     *   删完只 navigateBack() 一次，会退回到**那个已经被删掉的账户的详情页**，
     *   页面上还显示着刚删掉的账户名和余额 —— 看着像没删成功。
     *
     * ★ 正确行为：回到账户列表页 ★
     *   具体跳法见 utils/navBack.js 的 backAfterAccountDelete()：
     *   栈里能退到账户列表就退（中间的详情页一并跳过），
     *   否则 switchTab 过去 —— 账户列表是 tab 页，只有 switchTab 能跳。
     */
    function leaveAfterDelete() {
      backAfterAccountDelete()
    }

    function goBack() {
      uni.navigateBack()
    }

    // 用 onLoad(options) 取参数，比 getCurrentPages().options 可靠
    onLoad(async (options) => {
      editId.value = (options && options.id) || ''
      isEdit.value = !!editId.value

      if (!settingStore.loaded) await settingStore.load()
      await accountStore.load()

      if (isEdit.value) {
        await loadExisting()
      } else {
        form.name = ''
      }
    })

    return {
      ACCOUNT_TYPES, ACCOUNT_ICONS, AccountIcon, iconInk,
      statusBarHeight, isEdit, form, primaryColor, pageStyle,
      isCredit, dayRange, selectableTypes, onPickType,
      onToggleInclude, onSave, onDelete, goBack, settingStore,
      /* 余额弹层 */
      showBalanceSheet, balanceDraft, balanceMode, balanceAutoFocus,
      balanceModes, currentBalanceCents, balanceDiffCents, balanceDiffText,
      openBalanceSheet, closeBalanceSheet, confirmBalance,
      /* 组合账户 */
      isCombo, typeName, memberList, showMemberPicker, pickDraft,
      availableMembers, openMemberPicker, closeMemberPicker,
      toggleMember, confirmMembers, moveMember, removeMember
    }
  }
}
</script>

<style scoped>
.nav-bar {
  background-color: var(--app-bg);
  flex-shrink: 0;
}

.nav-inner {
  height: 88rpx;
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}

.nav-back {
  font-size: 48rpx;
  color: var(--app-text);
  width: 100rpx;
  line-height: 1;
}

.nav-title {
  flex: 1;
  text-align: center;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--app-text);
}

.nav-action {
  font-size: 28rpx;
  color: var(--app-primary);
  width: 100rpx;
  text-align: right;
  font-weight: 500;
}

.page-scroll {
  padding: 0 32rpx;
}

/* 账户标识预览 */
.icon-preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  margin-top: 16rpx;
  padding: 32rpx 0 8rpx;
}

.icon-preview {
  width: 128rpx;
  height: 128rpx;
  border-radius: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.icon-preview-img {
  width: 80rpx;
  height: 80rpx;
}

.icon-preview-text {
  font-size: 52rpx;
  font-weight: 600;
}

/* 图标选择器：3 行 × 6 列 */
.icon-grid {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  margin-top: 4rpx;
}

/*
  ★ 用百分比宽度而不是 flex:1 ★
    App 端跑在系统 WebView 上，CSS Grid 支持不稳（项目里踩过），
    所以用 flex + 百分比。6 列 = 每格 16.666%。
    减去间隙靠内层 padding 让出，不靠 gap ——
    gap 在个别低版本 WebView 上对 flex-wrap 支持不好，
    会让最后一列被挤到下一行。
*/
.icon-cell {
  width: 16.6666%;
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

/* 单元格里的内框：圆角 + 背景 + 选中描边 */
.icon-cell-inner {
  width: 78rpx;
  height: 78rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--app-card-2);
  border: 2rpx solid transparent;
}

.icon-cell.active .icon-cell-inner {
  /* 选中态的背景色/边框色由模板内联注入（跟账户色一致） */
}

.form-hint {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.6;
  width: 100%;
  margin-top: 4rpx;
}

.form-card {
  background-color: var(--app-card);
  border-radius: 20rpx;
  padding: 0 28rpx;
  margin-top: 16rpx;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.form-row:last-child {
  border-bottom: none;
}

.form-row-column {
  flex-direction: column;
  align-items: flex-start;
  padding: 24rpx 0;
  gap: 16rpx;
}

.form-label {
  font-size: 28rpx;
  color: var(--app-text);
  flex-shrink: 0;
}

.form-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.form-placeholder {
  color: var(--app-text-3);
  font-size: 28rpx;
}

.form-picker {
  font-size: 28rpx;
  color: var(--app-text-2);
}

/* 账户类型 */
.type-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  width: 100%;
}

.type-cell {
  padding: 12rpx 28rpx;
  border-radius: 20rpx;
  background-color: var(--app-card-2);
}

.type-cell.active {
  background-color: var(--app-primary-light);
}

.type-cell-text {
  font-size: 26rpx;
}

.tip-card {
  margin-top: 20rpx;
  padding: 0 12rpx;
}

.tip-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.6;
}

.danger-area {
  margin-top: 40rpx;
}

.del-btn {
  /* 横向撑满 */
  width: 100% !important;
  color: #ee0a24 !important;
  border-color: #ee0a24 !important;
}

/* 编辑模式锁定的类型（只读展示，与「账户名称」同行靠右） */
.type-locked {
  font-size: 28rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

/* 编辑时的余额行：金额 + 「修改」链接 */
.bal-row-right {
  display: flex;
  align-items: center;
  gap: 20rpx;
  flex-shrink: 0;
}

.bal-edit-link {
  font-size: 26rpx;
  color: var(--app-primary);
  font-weight: 500;
  padding: 6rpx 0 6rpx 8rpx;
}

/* ------------------------------------------------------- 余额弹层 */

.bs-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  /*
   * ★ z-index 用 9 ★
   *   项目的层级约定（见 scripts/check-layout.mjs）：
   *     页面内自绘浮层 1~9，
   *     wot 组件库的弹层默认 15，
   *     AppDialog 的确认框是 1000。
   *   本页的余额弹层 / 成员弹层都要低于库弹层，
   *   这样「改余额失败」时弹出的 AppDialog 能盖在它上面。
   */
  z-index: 9;
  display: flex;
  align-items: flex-end;
}

.bs-sheet {
  width: 100%;
  background-color: var(--app-bg);
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
  max-height: 86vh;
}

.bs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.bs-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.bs-close {
  font-size: 32rpx;
  color: var(--app-text-3);
  padding: 8rpx;
}

.bs-body {
  padding: 8rpx 32rpx 24rpx;
}

/* 金额输入：大字号 + 货币符号 */
.bs-amount-row {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 20rpx 0 16rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.bs-currency {
  font-size: 34rpx;
  color: var(--app-text-2);
  flex-shrink: 0;
}

.bs-input {
  flex: 1;
  min-width: 0;
  width: 0;
  font-size: 56rpx;
  font-weight: 600;
  color: var(--app-text);
  text-align: left;
  line-height: 1.2;
}

.bs-placeholder {
  color: var(--app-text-3);
  font-size: 56rpx;
  font-weight: 600;
}

/* 差额预览 */
.bs-diff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
}

.bs-diff-label {
  font-size: 24rpx;
  color: var(--app-text-3);
}

.bs-diff-value {
  font-size: 26rpx;
  font-weight: 500;
}

/* 口径单选 */
.bs-options {
  background-color: var(--app-card);
  border-radius: 20rpx;
  overflow: hidden;
}

.bs-option {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
  padding: 26rpx 24rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.bs-option:last-child {
  border-bottom: none;
}

.bs-radio {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2rpx;
}

.bs-radio.checked {
  border-color: var(--app-primary);
}

.bs-radio-dot {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  background-color: var(--app-primary);
}

.bs-option-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.bs-option-label {
  font-size: 28rpx;
  color: var(--app-text);
}

.bs-option-desc {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
}

/* 底部按钮 */
.bs-foot {
  display: flex;
  gap: 20rpx;
  padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
}

.bs-btn-cancel,
.bs-btn-ok {
  flex: 1;
  height: 88rpx;
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 600;
}

.bs-btn-cancel {
  background-color: var(--app-card-2);
  color: var(--app-text-2);
}

.bs-btn-ok {
  color: #ffffff;
}

/* 组合成员列表 */
.member-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  background-color: var(--app-card-2);
}

.member-order {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background-color: var(--app-primary-light);
  color: var(--app-primary);
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.member-icon {
  width: 52rpx;
  height: 52rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.member-icon-text {
  font-size: 22rpx;
  font-weight: 600;
}

.member-name {
  flex: 1;
  font-size: 26rpx;
  color: var(--app-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-ops {
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.member-op {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: var(--app-text-2);
  background-color: var(--app-card);
  border-radius: 12rpx;
}

.member-op.disabled {
  color: var(--app-text-3);
  opacity: 0.4;
}

.member-op-del {
  color: #ee0a24;
}

.add-member-btn {
  margin-top: 16rpx;
  padding: 20rpx 0;
  border-radius: 16rpx;
  border: 2rpx dashed var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.add-member-text {
  font-size: 26rpx;
  color: var(--app-primary);
}

/* 成员多选弹层：底部弹窗（不遮满屏），侧滑返回可收起 */
.member-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  /*
   * ★ 原来是 999，改成 9 ★
   *   999 会盖住 AppDialog 的确认框（1000 以下都算同一层），
   *   而本弹层里点「确定」失败时要弹确认框提示 —— 被盖住就看不见了。
   *   项目约定（scripts/check-layout.mjs）：页面内自绘浮层 1~9。
   *   和余额弹层用同一个值：两者互斥，不会同时出现。
   */
  z-index: 9;
  display: flex;
  align-items: flex-end;
}

.member-sheet {
  width: 100%;
  max-height: 75vh;
  background-color: var(--app-bg);
  border-radius: 28rpx 28rpx 0 0;
  display: flex;
  flex-direction: column;
}

.member-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 16rpx;
}

.member-sheet-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.member-sheet-close {
  font-size: 32rpx;
  color: var(--app-text-3);
  padding: 8rpx;
}

.member-sheet-body {
  flex: 1;
  min-height: 0;
  max-height: 52vh;
  padding: 0 24rpx;
  box-sizing: border-box;
}

.member-pick-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 8rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.member-pick-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
}

.member-pick-check {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-line);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.member-pick-check.checked {
  background-color: var(--app-primary);
  border-color: var(--app-primary);
}

.member-pick-checkmark {
  color: #fff;
  font-size: 26rpx;
  line-height: 1;
}

.member-pick-empty {
  padding: 40rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: var(--app-text-3);
}

.member-sheet-foot {
  padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
}

.member-sheet-btn {
  height: 88rpx;
  border-radius: 22rpx;
  background-color: var(--app-primary);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

</style>