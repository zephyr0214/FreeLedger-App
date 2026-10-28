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

        <view class="form-row form-row-column">
          <text class="form-label">账户类型</text>
          <view class="type-grid">
            <view
              v-for="t in ACCOUNT_TYPES"
              :key="t.key"
              class="type-cell"
              :class="{ active: form.type === t.key }"
              @click="form.type = t.key"
            >
              <text
                class="type-cell-text"
                :style="{ color: form.type === t.key ? primaryColor : 'var(--app-text-2)' }"
              >{{ t.name }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 余额与额度 -->
      <view class="form-card">
        <view class="form-row">
          <text class="form-label">{{ isEdit ? '当前余额' : '初始余额' }}</text>
          <input
            v-model="form.balanceYuan"
            class="form-input"
            type="digit"
            :placeholder="isEdit ? '当前账户里的实际金额' : '0.00'"
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

      <view class="tip-card">
        <text class="tip-text">
          {{ isEdit
            ? '改成实际余额后，差额会记成一笔「对账调整」交易，在流水里能看到。'
            : '初始余额是开户时的实际金额，之后的所有交易都会自动累加。' }}
        </text>
      </view>

      <view v-if="isEdit" class="danger-area">
        <!-- block + width:100%：横向撑满整个内容区 -->
        <wd-button size="large" plain block custom-class="del-btn" @click="onDelete">
          删除账户
        </wd-button>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 全局弹窗宿主（组件库重绘的确认框） -->
    <AppDialog />
  </view>
</template>

<script>
import { ref, reactive, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppDialog from '@/components/AppDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import { useAccountStore } from '@/stores/account.js'
import { ACCOUNT_TYPES, isCreditType, adjustAccountBalance } from '@/api/account.js'
import { yuanToCents } from '@/utils/money.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'

export default {
  components: { AppDialog },
  setup() {
    const settingStore = useSettingStore()
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
      card_tail: ''
    })

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)
    const isCredit = computed(() => isCreditType(form.type))

    const dayRange = Array.from({ length: 31 }, (_, i) => `${i + 1}`)

    function onToggleInclude(e) {
      form.include_in_total = e.detail.value
    }

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
    }

    async function onSave() {
      if (!form.name.trim()) {
        uni.showToast({ title: '请填写账户名称', icon: 'none' })
        return
      }

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
        card_tail: form.card_tail || null
      }

      try {
        if (isEdit.value) {
          // ★ 编辑：差额记成「对账调整」交易 ★
          //   余额公式（期初 + 收入 - 支出）保持成立，
          //   用户在流水里能看到这笔调整。
          await accountStore.update(editId.value, payload)

          const acc = await accountStore.getById(editId.value)
          const current = acc ? Number(acc.balance_cents) || 0 : 0
          if (targetCents !== current) {
            await adjustAccountBalance(editId.value, targetCents)
            await accountStore.refresh()
            const diff = targetCents - current
            uni.showToast({
              title: `已调整 ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)}`,
              icon: 'none'
            })
          } else {
            uni.showToast({ title: '已保存', icon: 'success' })
          }
        } else {
          // 新建：期初余额 = 填的余额
          const acc = await accountStore.create({
            ...payload,
            initial_balance_cents: targetCents
          })
          // 第一个账户自动设为默认
          if (accountStore.list.length === 1) {
            await settingStore.update({ defaultAccountId: acc.id })
          }
          uni.showToast({ title: '已添加', icon: 'success' })
        }
        setTimeout(() => uni.navigateBack(), 500)
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    async function onDelete() {
      const confirmed = await confirmDialog({
        title: '删除账户？',
        content: '该账户下的交易会变成「无账户」，交易记录本身不会删除',
        confirmText: '删除',
        danger: true
      })
      // ★ 取消就什么都不做 ★
      if (!confirmed) return

      try {
        await accountStore.remove(editId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 500)
      } catch (e) {
        await alertDialog({ title: '无法删除', content: e.message })
      }
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
      ACCOUNT_TYPES,
      statusBarHeight, isEdit, form, primaryColor, pageStyle,
      isCredit, dayRange,
      onToggleInclude, onSave, onDelete, goBack, settingStore
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

</style>
