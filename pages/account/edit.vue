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

      <!-- 图标选择器：4 行 × 6 列 = 24 个（最后一行是用户指定新增的 6 个） -->
      <view class="form-card">
        <view class="form-row form-row-column">
          <text class="form-label">账户图标</text>
          <view class="icon-grid">
            <view
              v-for="ic in ACCOUNT_ICONS"
              :key="ic.key"
              class="icon-cell"
              :class="{ active: form.icon === ic.key }"
              @click="onPickIcon(ic)"
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
            现在编辑时也能改类型。改类型不再需要清任何「专属字段」——
            信用卡那四项（额度/账单日/还款日/卡尾号）已经整套删掉了，
            所有真实类型的表单条目现在完全一样，只有两处跟着类型变：
              1. 初始余额的标签（欠钱类叫「当前欠款」，保存时自动取负）
              2. 分组位置（账户页按 type 分组展示）

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

      <!-- 余额（组合账户没有余额，整块不显示） -->
      <view v-if="!isCombo" class="form-card">
        <!--
          ★ 编辑页不再管余额 ★
            用户要求「把修改余额的弹层放到账户详情页的当前余额右下角，
            同时编辑页面不动」。
            改余额是「动账」，和「编辑」（改资料）是两件事，
            放在详情页的余额旁边更顺手；
            这一页只负责账户资料，不碰余额。

          ★ 新建时还是要填初始余额 ★
            新建账户没有「当前余额」可言，
            这里填的就是期初余额（还没有任何交易），直接输入框最省事。

          ★ 欠钱类账户（信用卡 / 网络借贷）改叫「当前欠款」★
            用户后来的要求是「删掉默认的 - 号，选中这两类时
            初始余额改叫当前欠款、自动设置为负值」。
            所以界面上**看不到任何负号**：
              · 标签换成「当前欠款」，用户填的永远是心里想的正数
                （「我欠 5000」就填 5000），负号由 onSave 自动加。
              · 不在输入框里回显 -5000：那会让用户一边打字
                一边被改写，光标乱跳，也没法改（数字键盘打不出负号）。
            编辑回填仍走绝对值 —— 负余额是欠款，输入框只表达金额大小。
        -->
        <!--
          余额 + 欠款提示是**一组**，共用同一条分割线。

          ★ 为什么必须包一层 ★
            .form-row 自带 border-bottom（见样式区），
            而提示语是「当前欠款」这一项的补充说明。
            如果提示直接跟在 .form-row 后面，分割线会先画在
            输入框下方、提示语浮在线下面又不属于下一项，
            看起来像「一行字掉到了两个条目中间」。
            包进 .form-group 后，线由这一组负责画，
            提示语始终在线**上方**，归属一目了然。
        -->
        <view v-if="!isEdit" class="form-group">
          <view class="form-row form-row-flush">
            <text class="form-label">{{ isDebtType ? '当前欠款' : '初始余额' }}</text>
            <input
              v-model="form.balanceYuan"
              class="form-input"
              type="digit"
              placeholder="0.00"
              placeholder-class="form-placeholder"
            />
          </view>
          <view v-if="isDebtType" class="form-group-hint">
            <!-- 把「自动取负」当场演给用户看：填 5000 就明说会记成 -5000 -->
            <text class="form-group-hint-text">{{ debtHintText }}</text>
          </view>
        </view>

        <view class="form-row">
          <text class="form-label">计入总资产</text>
          <switch
            :checked="form.include_in_total"
            :color="primaryColor"
            @change="onToggleInclude"
          />
        </view>
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
            没有可选的账户（组合不能嵌套组合）
          </view>
        </scroll-view>
        <view class="member-sheet-foot">
          <view class="member-sheet-btn" @click="confirmMembers">确定</view>
        </view>
      </view>
    </view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
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
  ACCOUNT_TYPES, isCreditType, isComboType, listComboMemberIds
} from '@/api/account.js'
import { ACCOUNT_ICONS, accountNameForIcon } from '@/utils/accountIcons.js'
import { yuanToCents } from '@/utils/money.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'
import { backAfterAccountDelete } from '@/utils/navBack.js'
import MoneyText from '@/components/MoneyText.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'

export default {
  components: { AppDialog, AccountIcon, MoneyText, UpdateDialog },
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
      /*
       * ★ 新增账户默认「网络支付」（用户要求）★
       *   用户原话：「添加账户时，默认为网络支付」。
       *
       *   原来默认是 'cash'（现金）。但实际记账里现金用得最少，
       *   微信/支付宝这类网络支付才是绝大多数人的日常出口 ——
       *   默认成网络支付，用户点「保存」就能用，不必每次都改类型。
       *
       * ★ 只影响「新增」★
       *   编辑已有账户时 loadExisting() 会用库里的 type 覆盖这个值，
       *   所以老账户不会被这条默认值改动。
       */
      type: 'online',
      balanceYuan: '',
      include_in_total: true,
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
    const isCombo = computed(() => isComboType(form.type))
    /**
     * 这个类型是不是「欠钱」的（信用卡 / 网络借贷）。
     *
     * ★ 命名从 showMinusSign 改成 isDebtType ★
     *   用户后来要求界面上不显示负号、把标签改成「当前欠款」，
     *   名字再叫 showMinusSign 就是骗人了。
     *   它现在管两件事：标签文案、保存时自动取负。
     *   挂在 isCreditType 上而不是写死 key 列表 ——
     *   以后再加同类账户只改 ACCOUNT_TYPES，这里不用动。
     */
    const isDebtType = computed(() => isCreditType(form.type))

    /**
     * 欠款输入框下面那句提示的文案。
     *
     * ★ 为什么要实时把负数算给用户看 ★
     *   「自动设置为负值」如果只在保存那一刻发生，用户全程看不到，
     *   会觉得「我明明填的是正数，凭什么记成欠款」。
     *   边输边显示「将记为 -5000.00」，把隐式约定变成可见反馈，
     *   用户就不用去猜账本里到底存了什么。
     *   没填的时候不显示预览，否则会出现一句「将记为 -0.00」的废话。
     */
    const debtHintText = computed(() => {
      const raw = String(form.balanceYuan || '').trim()
      if (!raw) return '欠款按负值保存，用来计入负债'
      const cents = Math.abs(yuanToCents(raw))
      return `欠款按负值保存，将记为 -${(cents / 100).toFixed(2)}`
    })

    /** 编辑模式里只读展示的账户类型名 */
    const typeName = computed(() => {
      const t = ACCOUNT_TYPES.find((x) => x.key === form.type)
      return t ? t.name : '现金'
    })

    /**
     * 可选账户类型
     *
     * ★ 规则 ★
     *   新建：**全部类型都可以选**，包括组合账户。
     *        以前这里过滤掉了组合，注释说「入口在账户页的分组说明」——
     *        但那个入口根本不存在，结果组合账户完全建不出来（用户反馈的 bug）。
     *        选组合后表单自动变形：余额整块隐藏，改成「扣款顺序」成员配置。
     *   编辑真实账户：真实类型之间随便改（现金改储蓄卡、储蓄卡改信用卡、
     *        储蓄卡改电话卡……），但**不能改成组合** ——
     *        组合没有余额，转换会让余额语义彻底乱掉。
     *   编辑组合账户：类型整块锁死（模板里走只读分支）。
     *
     * ★ 别在这里写死类型个数 ★
     *   直接 filter ACCOUNT_TYPES，加减类型只改 api/account.js 一处。
     */
    const selectableTypes = computed(() => {
      // 编辑真实账户：只给真实类型，不能转成组合
      if (isEdit.value && !isCombo.value) {
        return ACCOUNT_TYPES.filter((t) => !t.isCombo)
      }
      // 新建：全给（含组合），选了组合就变成成员配置表单
      return ACCOUNT_TYPES
    })

    /**
     * 切换账户类型
     *
     * ★ 只需要改 form.type ★
     *   以前这里要在「切出信用卡」时把额度/账单日/还款日/卡尾号清空，
     *   现在这四项已经整套删掉了，所有真实类型的表单条目完全一样，
     *   没有类型专属字段需要收尾。
     *   跟着类型变的只有两处纯展示：初始余额那一行的标签（欠钱类叫「当前欠款」）、
     *   以及分组位置。保存时是否取负由 isDebtType 决定，也在同一处判断。
     */
    /**
     * 选中 / 取消选中图标（用户本轮第 2 条）
     *
     * ★ 用户原话 ★
     *   「添加账户时，我希望用户选择那个图标的时候，
     *   名字那里就预填一个该图标对应的名字」。
     *
     * ★ 为什么要“可以取消” ★
     *   图标是可以取消选择的（再点一下）。
     *   取消时不能把名字也清掉 ——
     *   那是用户可能已经改过的内容，不能因为一个图标动作就丢。
     *
     * ★ 只在“名字还是空的 / 还是上一个图标预填的”时覆盖 ★
     *   用户手写了「工资卡」再去换图标，
     *   不能把他的「工资卡」改成「中国建设银行」。
     *   判据就是「当前名是不是空 / 是不是上一个图标带来的默认名」。
     */
    function onPickIcon(ic) {
      const wasPicked = form.icon === ic.key
      const prevDefault = form.icon ? accountNameForIcon(form.icon) : ''
      const currentName = String(form.name || '').trim()

      form.icon = wasPicked ? '' : ic.key
      if (wasPicked) return

      /*
       * 只有名字为空、或耍好等于上一个图标的默认名时，才覆盖。
       * 否则保留用户自己输入的名字。
       */
      if (!currentName || currentName === prevDefault) {
        form.name = accountNameForIcon(ic.key)
      }
    }

    function onPickType(key) {
      if (form.type === key) return
      form.type = key
    }

    /**
     * 组合成员候选：除组合（禁止嵌套）以外的所有真实账户。
     *
     * ★ 用户要求允许信用卡 / 网络借贷当成员 ★
     *   以前这里用 `!a.isCredit` 把欠钱类账户排除在外，
     *   理由是「负余额扣不动」。
     *   但组合的价值在于「按顺序试扣」，欠钱的卡余额是负的，
     *   自然会在 availableCents() 那里排到后面去 ——
     *   这属于运行时排序问题，不该在选人阶段就替用户否决。
     *   而且把信用卡放进组合，用户就能统一「这个组合先刷花呗、
     *   不够再走储蓄卡」，比逼他每次手动换账户省事得多。
     */
    const availableMembers = computed(() =>
      accountStore.list.filter((a) => !a.isCombo)
    )

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
      /*
       * 编辑时回填**当前余额**，并且取绝对值。
       *
       * ★ 为什么要 abs ★
       *   信用卡 / 网络借贷的余额是负数（欠款），
       *   而表单里表达的是「金额大小」，符号由类型决定。
       *   直接回填 -5000 会让用户看到一个自己打不出来的数
       *   （数字键盘没有负号），改都没法改。
       *
       * ★ 这一行现在其实不会显示 ★
       *   余额输入框只在新建时出现（编辑改余额走详情页的弹层），
       *   保留回填是为了初始快照对比，也让「切类型看预览」不至于读到空字符串。
       */
      form.balanceYuan = (Math.abs(acc.balance_cents) / 100).toFixed(2)
      form.include_in_total = acc.include_in_total
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
       * ★ 余额只在「新建」时写 ★
       *   用户要求「把修改余额的弹层放到账户详情页，编辑页面不动」——
       *   所以：
       *     新建 -> 期初余额 = 表单里填的初始余额（还没有任何交易）
       *     编辑 -> 余额一个字段都不碰
       *   编辑时 form.balanceYuan 还留着旧值（loadExisting 回填的），
       *   这里绝不能拿它当 initial_balance_cents 写回去 ——
       *   那会把用户在详情页弹层里改好的余额又覆盖掉。
       */
      /*
       * ★ 欠钱类账户：输入的是正数，落库自动取负 ★
       *   界面上叫「当前欠款」，但存储上的含义没变：
       *   负余额 = 欠款。用户在信用卡 / 网络借贷上填 5000，
       *   心里想的是「我欠 5000」，所以存 -5000。
       *   这一步不能省 —— getAssetOverview() 是拿余额正负来拆
       *   资产 / 负债的（见 api/account.js 里的注释），
       *   存成正数会让这笔欠款被算成资产，净资产直接错一个量级。
       *
       *   用 -Math.abs() 而不是直接写负号：数字键盘敲不出负号，
       *   但粘贴可以。万一粘进来一个 "-5000"，abs 保证结果还是 -5000，
       *   不会把用户的欠款翻成存款。
       */
      const rawCents = yuanToCents(form.balanceYuan || 0)
      const targetCents = isDebtType.value ? -Math.abs(rawCents) : rawCents

      // 新建：余额就是期初余额（还没有任何交易）
      const payload = {
        name: form.name.trim(),
        type: form.type,
        include_in_total: form.include_in_total,
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
           * ★ 余额不受影响 ★
           *   期初余额没动，所以余额（期初 + 收入 - 支出）自然不变。
           *   用户如果刚在弹层里改过余额，那个改动已经落库了，
           *   这里重新 update 一遍不会把它冲掉（payload 里没有余额字段）。
           *
           * ★ 改类型也不用收尾 ★
           *   信用卡那四项专属字段已经整套删掉，
           *   所有真实类型的表单条目一样，改类型只改 type 这一个值。
           *   唯一跟着类型变的是「初始余额前有没有负号」，纯展示层。
           *
           * ★ 净资产口径自动跟上 ★
           *   信用卡 -> 储蓄卡时余额不变、符号不变；
           *   若用户想把这个负余额翻正，去详情页的「修改余额」里改 ——
           *   那是独立的一条动账路径，不该由「改资料」顺手完成。
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
         *   但用户可能刚把类型从储蓄卡改成了网络借贷，
         *   分组位置变了、余额符号的含义也变了（正数=存款，负数=欠款），
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
      isDebtType, debtHintText, selectableTypes, onPickType, onPickIcon,
      onToggleInclude, onSave, onDelete, goBack, settingStore,
      /* 余额弹层 */
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

/* 图标选择器：4 行 × 6 列（最后一行是用户指定新增的 6 个） */
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

/*
 * 说明文字统一走 .form-group-hint-text（见下方「一行 + 补充说明」那组）。
 *
 * 这里原来有一个 .form-hint（width:100% + margin-top:4rpx），
 * 是给「整张卡片的补充说明」用的通用类。现在卡内唯一的说明文字
 * 就是欠款那行注脚，它需要跟着自己的输入行成组、由组控制间距，
 * 通用类反而要去和 border 抢位置，所以删掉 —— 一个用途一套样式。
 */

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

/*
 * 「一行 + 它的补充说明」合成一组，分割线画在组尾。
 *
 * ★ 为什么要这层 ★
 *   .form-row 自己带 border-bottom，提示语却不属于任何 form-row，
 *   直接跟在后面就会出现「线在提示语上方 / 提示语像孤儿」的错位感。
 *   把线交给组来画，组内永远无内部分割线，提示语稳定贴在输入框下方。
 */
.form-group {
  border-bottom: 1rpx solid var(--app-line);
}

.form-group:last-child {
  border-bottom: none;
}

/* 组内的输入行不再自己画线，否则线和组的线会叠成两条 */
.form-row-flush {
  border-bottom: none;
}

.form-group-hint {
  display: flex;
  padding: 0 0 20rpx;
}

/*
 * 提示语用自己的类，不复用 .form-hint。
 *
 * .form-hint 原本是给「整张卡片的说明文字」用的（width:100%、margin-top:4rpx），
 * 塞进这一组里还要靠负 margin 把它拽回去 —— 两个用途抢一套样式，
 * 下次谁改 .form-hint 就会顺手把这行提示的间距弄乱。
 * 这里显式写全，和分割线的关系只由本组的 padding 决定。
 */
.form-group-hint-text {
  font-size: 22rpx;
  color: var(--app-text-3);
  line-height: 1.5;
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
