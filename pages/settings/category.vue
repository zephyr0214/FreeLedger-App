<template>
  <view class="app-page" :class="settingStore.wotClass" :style="pageStyle">
    <PageNav title="分类管理" @back="goBack">
      <!-- 右上角：新建一级分类 -->
      <template #right>
        <view class="nav-add" @click="openCreate(null)">
          <LineIcon name="plus" :size="20" :color="primaryColor" />
        </view>
      </template>
    </PageNav>

    <!--
      支出分类 / 收入分类切换

      ★ 用全局分段控件，不再是下划线 tab ★
        下划线 tab 的选中态只有「文字变色 + 底部 4rpx 短线」，
        而这两项本来就是同一页的两个视图，本质是一个二选一开关。
        换成和「年月日筛选 / 自定义筛选」「支出 / 收入统计」
        同款的分段控件后，整个 App 里这类切换长得一模一样
        （样式定义在 App.vue 的 .seg-toggle / .seg-item）。

      ★ 这两个是整行等宽的两格 ★
        用 --block 变体（flex:1 平分），而不是卡片头里那种自适应宽度：
        页面顶部空间宽裕，平分后左右两块都够大、好点。
    -->
    <view class="type-bar">
      <view class="seg-toggle seg-toggle--block">
        <text
          v-for="t in types"
          :key="t.key"
          class="seg-item"
          :class="{ active: activeType === t.key }"
          @click="switchType(t.key)"
        >{{ t.name }}</text>
      </view>
    </view>

    <scroll-view class="page-scroll" scroll-y>
      <view v-if="tree.length === 0" class="empty-wrap">
        <EmptyState
          emoji="📂"
          title="还没有分类"
          desc="点右上角的 + 新建一个一级分类"
          action-text="新建分类"
          @action="openCreate(null)"
        />
      </view>

      <view v-for="parent in tree" :key="parent.id" class="cat-group">
        <!--
          ★ 交互约定（与标签管理页保持一致）★
            点父类行    -> 展开/收起
            点父类名字  -> 进分类详情页（看这个分类的流水与统计）
            右滑父类行  -> 露出「编辑」「删除」
            右滑子类行  -> 露出「编辑」「删除」
        -->
        <!--
          ★ 固定分类不能右滑 ★
            wd-swipe-action 的 disabled 属性直接禁掉滑动，
            比「滑出来再提示」体验好 —— 固定分类本来就没有可改的东西，
            滑出来只会被误触。

          ★ 「系统分类」例外：不能改，但要能展开 ★
            以前固定分类既不能右滑、也不能展开（它们没有子类）。
            v14 起「系统分类」是一个真正的父级 —— 下面挂着
            「借出 / 对账支出」（支出）和「借入 / 对账收入」（收入），
            所以它要能展开，只是它自己和子类都不能编辑/删除。
        -->
        <wd-swipe-action
          v-model="swipeStates[parent.id]"
          class="cat-swipe"
          :disabled="isFixed(parent)"
        >
          <view class="parent-row" @click="toggleExpand(parent.id)">
            <view class="parent-icon" :style="{ backgroundColor: (parent.color || primaryColor) + '22' }">
              <text class="parent-emoji">{{ iconEmoji(parent.icon) }}</text>
            </view>
            <text class="parent-name" @click.stop="goDetail(parent)">{{ parent.name }}</text>
            <text v-if="isFixed(parent)" class="parent-locked">固定分类</text>
            <!--
              ★ 没有子类也显示「0 个子类 ›」★
                之前是 children.length > 0 才显示，
                结果「还没建过子类的一级分类」看起来是个终点 ——
                没有箭头、没有数量，用户不知道这里还能加子类，
                只能去猜「+ 添加子分类」藏在哪。

                现在统一显示数量（没有就是 0），
                点开就能看到「+ 添加子分类」，路径和已有子类的分类完全一致。
                固定分类没有「添加子分类」入口，但「系统分类」
                本身有固定子类，数量照常显示。
            -->
            <text v-if="parent.children.length > 0" class="parent-count">{{ parent.children.length }} 个子类</text>
            <text v-else-if="!isFixed(parent)" class="parent-count">0 个子类</text>
            <text
              v-if="!isFixed(parent) || parent.children.length > 0"
              class="expand-icon"
              :class="{ expanded: expandedIds.includes(parent.id) }"
            >›</text>
          </view>

          <!--
            右滑操作区：编辑 + 删除

            ★ 为什么两个按钮各自绑 @click.stop ★
              wd-swipe-action 的整个右滑区域只会 emit 一个
              { value: 'right' } 事件，分不出是哪个按钮 ——
              它的模板是 <view class="wd-swipe-action__right" @click="onClick('right')">，
              里面放几个 view 都一样。
              所以两个按钮各自绑 @click.stop，自己处理，
              .stop 阻止冒泡到外层的 onClick('right')，避免重复触发。
          -->
          <template #right>
            <!-- 固定分类：滑出来只提示，不给操作按钮 -->
            <view v-if="isFixed(parent)" class="swipe-locked">
              <text class="swipe-locked-text">固定分类</text>
            </view>
            <template v-else>
              <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="openEdit(parent)">
                <text class="swipe-action-text">编辑</text>
              </view>
              <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="onDelete(parent)">
                <text class="swipe-action-text">删除</text>
              </view>
            </template>
          </template>
        </wd-swipe-action>

        <!-- 子分类 -->
        <view v-if="expandedIds.includes(parent.id)" class="children">
          <wd-swipe-action
            v-for="child in parent.children"
            :key="child.id"
            v-model="swipeStates[child.id]"
            class="cat-swipe cat-swipe-child"
            :disabled="isFixed(child)"
          >
            <view class="child-row">
              <!-- 子类自己的图标（v6 起二级分类有独立图标） -->
              <view class="child-icon" :style="{ backgroundColor: (child.color || parent.color || primaryColor) + '22' }">
                <text class="child-emoji">{{ iconEmoji(child.icon) }}</text>
              </view>
              <text class="child-name" @click="goDetail(child)">{{ child.name }}</text>
              <!--
                固定子类逐个标出来（借出 / 借入 / 对账支出 / 对账收入）。
                ★ 为什么不只在父级标一次 ★
                  「系统分类」展开后，用户看到的是几个子类，
                  父级那行已经滚上去了 —— 每个子类都要能自己说明「我改不了」。
              -->
              <text v-if="isFixed(child)" class="child-locked">固定</text>
            </view>

            <template #right>
              <view v-if="isFixed(child)" class="swipe-locked">
                <text class="swipe-locked-text">固定分类</text>
              </view>
              <template v-else>
                <view class="swipe-edit" :style="{ backgroundColor: primaryColor }" @click.stop="openEdit(child)">
                  <text class="swipe-action-text">编辑</text>
                </view>
                <view class="swipe-delete" style="background-color: var(--app-danger)" @click.stop="onDelete(child)">
                  <text class="swipe-action-text">删除</text>
                </view>
              </template>
            </template>
          </wd-swipe-action>

          <!--
            「+ 添加子分类」保留：
            加子分类是「在某个父类下加」，和右上角的「加一级分类」不是一回事。

            ★ 固定分类下不能加子类 ★
              「系统分类」的结构是锁死的 ——
              混进一个用户自建的子类，和固定子类就分不清了。
          -->
          <view v-if="!isFixed(parent)" class="child-row child-add" @click="openCreate(parent)">
            <text class="child-add-text">+ 添加子分类</text>
          </view>

          <!-- 固定分类：说明为什么这些子类不能改 -->
          <view v-if="isFixed(parent)" class="child-actions">
            <text class="action-lock">系统分类，不可编辑或删除</text>
          </view>
        </view>
      </view>

      <view class="bottom-space" />
    </scroll-view>

    <!-- 编辑弹层 -->
    <wd-popup v-model="showEditor" position="bottom" :safe-area-inset-bottom="true">
      <view class="editor">
        <view class="editor-head">
          <text class="editor-cancel" @click="closeEditor">取消</text>
          <text class="editor-title">{{ editorTitle }}</text>
          <text class="editor-save" @click="onSaveCategory">保存</text>
        </view>

        <scroll-view class="editor-body" scroll-y>
          <view class="editor-row">
            <text class="editor-label">名称</text>
            <input
              v-model="editorForm.name"
              class="editor-input"
              placeholder="分类名称"
              placeholder-class="editor-placeholder"
              :maxlength="10"
            />
          </view>

          <!--
            图标选择器：一级和二级都显示。
            二级分类现在可以有自己的图标（v6 起）。
          -->
          <view class="editor-row editor-row-column">
            <text class="editor-label">图标</text>
            <scroll-view class="icon-scroll" scroll-y>
              <view class="icon-grid">
                <view
                  v-for="opt in iconOptions"
                  :key="opt.key"
                  class="icon-cell"
                  :class="{ active: editorForm.icon === opt.key }"
                  @click="editorForm.icon = opt.key"
                >
                  <text class="icon-emoji">{{ iconEmoji(opt.key) }}</text>
                  <text class="icon-name">{{ opt.label }}</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- 颜色只有一级能改：二级继承父级的颜色 -->
          <view v-if="!editorForm.parent_id" class="editor-row editor-row-column">
            <text class="editor-label">颜色</text>
            <view class="color-grid">
              <view
                v-for="c in colors"
                :key="c"
                class="color-cell"
                :class="{ active: editorForm.color === c }"
                :style="{ backgroundColor: c }"
                @click="editorForm.color = c"
              />
            </view>
          </view>
          <view v-else class="editor-row editor-row-column">
            <text class="editor-label">颜色</text>
            <text class="editor-hint">子分类颜色跟随父级「{{ parentNameOf(editorForm.parent_id) }}」</text>
          </view>
        </scroll-view>

        <!--
          删除入口（只在编辑已有分类时显示）

          ★ 为什么弹层里也要能删 ★
            用户反馈：「编辑里面也不可以删除，这是什么逻辑？」
            进了编辑弹层就想把这一项改掉或删掉，
            还得先关掉弹层再去右滑找删除，太绕。

          ★ 固定分类不显示 ★
            「对账支出」「对账收入」是余额对账的记账口径，不能删。
        -->
        <view v-if="editingId && !isEditingFixed" class="editor-danger">
          <text class="danger-link" @click="onDeleteFromEditor">删除这个分类</text>
        </view>
      </view>
    </wd-popup>

    <!-- 弹窗宿主：确定框统一用组件库样式 -->
    <AppDialog />

    <!-- 更新弹窗（全局提示：任何页面都能弹出，读同一份 store 状态） -->
    <UpdateDialog />
  </view>
</template>

<script>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { onShow, onBackPress } from '@dcloudio/uni-app'
import PageNav from '@/components/PageNav.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppDialog from '@/components/AppDialog.vue'
import LineIcon from '@/components/LineIcon.vue'
import UpdateDialog from '@/components/UpdateDialog.vue'
import { useSettingStore } from '@/stores/setting.js'
import {
  listCategoryTree, createCategory, updateCategory, deleteCategory,
  isReconcileCategory, isFixedCategory, isPresetGroupCategory
} from '@/api/category.js'
import { ICON_OPTIONS, iconEmoji } from '@/utils/icons.js'
import { refreshEngelFoodCategories } from '@/api/engel.js'
import { confirmDialog, alertDialog } from '@/utils/dialog.js'
import { pushLayer, handleBackPress } from '@/utils/layerStack.js'

export default {
  components: { PageNav, EmptyState, AppDialog, LineIcon, UpdateDialog },
  setup() {
    const settingStore = useSettingStore()

    const activeType = ref('expense')
    const tree = ref([])
    const expandedIds = ref([])
    const showEditor = ref(false)
    const editingId = ref('')
    const editorForm = reactive({ name: '', color: '', icon: 'more', parent_id: null })

    /**
     * wd-swipe-action 的展开状态。
     * key 是分类 id，值是该行当前是否展开（右滑打开）。
     */
    const swipeStates = reactive({})

    /**
     * 收起某一行（或某些行）的右滑操作区
     *
     * ★ 为什么必须手动收 ★
     *   wd-swipe-action 的 v-model 值有三种：
     *     'left' | 'right' 展开，'close' 收起。
     *   组件自己会在滑回去时 emit 'close'，
     *   但「点了编辑 -> 弹层打开 -> 弹层关掉」这条路径上，
     *   那一行还保持着右滑展开状态，
     *   用户看到的是「编辑完了，右边还挂着两个按钮」。
     *
     *   所以在弹层关闭、删除确认、切类型、页面 onShow
     *   这几个时机都要主动收一下。
     *
     * @param {string} id 分类 id；不传则收起所有
     */
    function closeSwipe(id) {
      if (id) {
        swipeStates[id] = 'close'
        return
      }
      for (const key of Object.keys(swipeStates)) {
        swipeStates[key] = 'close'
      }
    }

    /** 收起所有行的右滑操作区 */
    function closeAllSwipes() {
      closeSwipe()
    }

    const iconOptions = ICON_OPTIONS

    const types = [
      { key: 'expense', name: '支出分类' },
      { key: 'income', name: '收入分类' }
    ]

    const colors = [
      '#FF976A', '#1989FA', '#EE0A24', '#7D5FFF',
      '#07C160', '#FF8F1F', '#0A8F4A', '#FF6B9D',
      '#969799', '#FFD60A'
    ]

    const primaryColor = computed(() => settingStore.primaryColor)
    const pageStyle = computed(() => settingStore.cssVars)

    /** 弹层标题：新建一级 / 新建子分类 / 编辑 */
    const editorTitle = computed(() => {
      if (editingId.value) {
        return editorForm.parent_id ? '编辑子分类' : '编辑一级分类'
      }
      return editorForm.parent_id ? '新建子分类' : '新建一级分类'
    })

    /** 某个父级分类的名字（编辑子分类时提示「颜色跟随父级 X」） */
    function parentNameOf(parentId) {
      if (!parentId) return ''
      for (const p of tree.value) {
        if (p.id === parentId) return p.name
      }
      return ''
    }

    /**
     * 当前正在编辑的是不是固定分类
     *
     * 固定分类不显示弹层里的「删除这个分类」。
     */
    const isEditingFixed = computed(() => {
      if (!editingId.value) return false
      for (const p of tree.value) {
        if (p.id === editingId.value) return isFixedCategory(p)
        for (const c of p.children) {
          if (c.id === editingId.value) return isFixedCategory(c)
        }
      }
      return false
    })

    async function load() {
      tree.value = await listCategoryTree(activeType.value, true)
    }

    /**
     * 切换支出 / 收入。
     *
     * ★ 切类型后要把所有展开状态清掉 ★
     *   两件事：
     *     1. 子类全部收起 —— 新的一类是另一套内容，
     *        把上一套的展开状态带过来会显得莫名其妙；
     *     2. 右滑按钮全部收起 —— 不然会看到半展开的操作区。
     */
    function switchType(key) {
      activeType.value = key
      expandedIds.value = []
      closeAllSwipes()
      load()
    }

    function toggleExpand(id) {
      if (expandedIds.value.includes(id)) {
        expandedIds.value = expandedIds.value.filter((x) => x !== id)
      } else {
        expandedIds.value.push(id)
      }
    }

    /**
     * 是不是「固定分类」（不可改名 / 改图标 / 改颜色 / 删除）
     *
     * ★ v14 起固定分类是一整组 ★
     *   一级「系统分类」，以及它下面挂的
     *   「借出 / 对账支出」（支出）、「借入 / 对账收入」（收入）。
     *   判定规则收在 api/category.js 的 isFixedCategory()，
     *   页面只负责用它决定「给不给编辑/删除按钮」。
     */
    function isFixed(cat) {
      return isFixedCategory(cat)
    }

    /**
     * 新建分类
     * @param {object|null} parent 传父级 = 新建子分类；传 null = 新建一级分类
     */
    function openCreate(parent) {
      // 固定分类下不能再加子分类
      if (parent && isFixed(parent)) {
        uni.showToast({ title: '固定分类不能添加子分类', icon: 'none' })
        return
      }
      editingId.value = ''
      editorForm.name = ''
      editorForm.color = colors[0]
      /**
       * 二级分类的图标不再强制继承父级了 ——
       * 用户要能给每个子类单独配图标，默认给父级的，
       * 但用户可以改。（颜色仍然继承父级。）
       */
      editorForm.icon = parent ? (parent.icon || 'more') : 'more'
      if (parent && parent.color) editorForm.color = parent.color
      editorForm.parent_id = parent ? parent.id : null
      showEditor.value = true
    }

    function openEdit(cat) {
      // 固定分类不能改 —— 改名、图标、颜色都不行
      if (isFixed(cat)) {
        uni.showToast({ title: `「${cat.name}」是固定分类，不能修改`, icon: 'none' })
        return
      }
      editingId.value = cat.id
      editorForm.name = cat.name
      editorForm.color = cat.color || colors[0]
      editorForm.icon = cat.icon || 'more'
      editorForm.parent_id = cat.parent_id
      showEditor.value = true
    }

    /**
     * 关闭编辑弹层
     *
     * ★ 右滑收起交给 watch(showEditor) ★
     *   （点遮罩关闭时 v-model 也会把 showEditor 置 false，watch 一并兜住）
     */
    function closeEditor() {
      showEditor.value = false
    }

    async function onSaveCategory() {
      if (!editorForm.name.trim()) {
        uni.showToast({ title: '请填写名称', icon: 'none' })
        return
      }

      // 编辑固定分类 -> 直接拦掉
      //   ★ 不用 flatMap ★
      //     flatMap 要 Chrome 69+/Safari 12+，老 Android WebView 上没有。
      const all = tree.value.slice()
      for (const p of tree.value) {
        for (const c of p.children) all.push(c)
      }
      if (editingId.value) {
        const target = all.find((c) => c.id === editingId.value)
        if (isFixed(target)) {
          uni.showToast({ title: `「${target.name}」是固定分类，不能修改`, icon: 'none' })
          closeEditor()
          return
        }
      }

      try {
        if (editingId.value) {
          await updateCategory(editingId.value, {
            name: editorForm.name.trim(),
            color: editorForm.color,
            icon: editorForm.icon
          })
        } else {
          await createCategory({
            name: editorForm.name.trim(),
            type: activeType.value,
            color: editorForm.color,
            parent_id: editorForm.parent_id,
            icon: editorForm.icon
          })
        }
        closeEditor()
        await load()
        uni.showToast({ title: '已保存', icon: 'success' })
        /*
         * ★ 分类一改，「哪些算吃掉的」就可能变了（本轮用户第 7 条）★
         *   恩格尔系数的食品分类清单是 AI 按分类名判的，
         *   改名/新增/删除之后旧结论会失真，所以这里直接重新判定一次。
         *   ★ 不 await、不报错 ★
         *     分类已经存好了，判定只是给统计页预热的展示型数据；
         *     让用户等它、或者因为 AI 挂了弹个错，都是本末倒置。
         */
        rejudgeEngel()
      } catch (e) {
        await alertDialog({ title: '保存失败', content: e.message })
      }
    }

    /**
     * 分类变动后重判恩格尔食品分类（后台进行）
     *
     * ★ 失败完全静默 ★
     *   分类保存是主流程，恩格尔判定是附带的缓存刷新。
     */
    function rejudgeEngel() {
      refreshEngelFoodCategories().catch(() => {})
    }

    /**
     * 删除分类
     *
     * ★ 删除有交易的分类也允许 ★
     *   用户要求：分类下的交易调整为「无分类」，交易本身不删。
     *   deleteCategory 的具体行为由 api/category.js 负责
     *   （把交易的 category_id 置 NULL，删一级时连带软删子分类）。
     *
     * @param {object} cat 要删的分类
     * @param {boolean} fromEditor true = 从编辑弹层里点的删除
     *   （弹层要跟着一起关掉）
     */
    async function onDelete(cat, fromEditor) {
      // 固定分类不能删
      if (isFixed(cat)) {
        uni.showToast({ title: `「${cat.name}」是固定分类，不能删除`, icon: 'none' })
        return
      }
      const isChild = !!cat.parent_id
      const ok = await confirmDialog({
        title: `删除「${cat.name}」？`,
        content: isChild
          ? '该分类下的交易会变成「无分类」，交易记录本身不会删除'
          : '该分类及其子分类下的交易会变成「无分类」，交易记录本身不会删除',
        confirmText: '删除',
        danger: true
      })
      // 确认框关掉了（不管是确认还是取消），右滑都收起来
      closeAllSwipes()
      if (!ok) return
      try {
        await deleteCategory(cat.id)
        if (fromEditor) showEditor.value = false
        await load()
        uni.showToast({ title: '已删除', icon: 'success' })
        // 删除分类同样会改变「哪些算吃掉的」，重新判定一次（静默）
        rejudgeEngel()
      } catch (e) {
        await alertDialog({ title: '无法删除', content: e.message })
      }
    }

    /**
     * 编辑弹层里的「删除这个分类」
     *
     * ★ 为什么弹层里也要有删除入口 ★
     *   用户反馈：「编辑里面也不可以删除，这是什么逻辑？」
     *   进了编辑弹层就想把这一项改掉或删掉，
     *   还得先关掉弹层再去右滑找删除，太绕。
     */
    function onDeleteFromEditor() {
      if (!editingId.value) return
      const all = tree.value.slice()
      for (const p of tree.value) {
        for (const c of p.children) all.push(c)
      }
      const target = all.find((c) => c.id === editingId.value)
      if (!target) return
      if (isFixed(target)) {
        uni.showToast({ title: `「${target.name}」是固定分类，不能删除`, icon: 'none' })
        return
      }
      onDelete(target, true)
    }

    /**
     * 进分类详情页。
     *
     * ★ 和账户详情 / 标签详情 / 预算详情 / 周期详情同一套结构 ★
     *   详情页里会显示这个分类的汇总卡、本月收支和最近流水，
     *   右上角「全部 ›」会带上分类筛选条件跳到交易列表页。
     */
    function goDetail(cat) {
      if (!cat || !cat.id) return
      uni.navigateTo({ url: `/pages/settings/category-detail?id=${cat.id}` })
    }

    function goBack() {
      uni.navigateBack()
    }

    /**
     * 编辑面板收起（取消/保存/删除/点遮罩关闭）时，把右滑露出的「编辑」按钮也收起。
     * 否则用户关掉弹层后，行还保持着右滑展开状态，很别扭。
     *
     * ★ 值必须是 'close' 而不是 false ★
     *   wd-swipe-action 的 modelValue 是字符串（'left' | 'close' | 'right'），
     *   传 false 会触发「Expected String, got Boolean」的类型警告，而且不生效。
     */
    watch(showEditor, (open) => {
      if (open) {
        /*
         * ★ 编辑弹层打开 → 登记进弹层栈 ★
         *   全面屏侧滑返回 / 返回键会先收起这个弹层，
         *   而不是直接退出「分类管理」页。
         */
        if (!unregisterLayer) {
          unregisterLayer = pushLayer(() => { showEditor.value = false }, 'categoryEditor')
        }
        return
      }
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
      const id = editingId.value
      if (id) swipeStates[id] = 'close'
    })

    /** 弹层栈注销函数 */
    let unregisterLayer = null

    onUnmounted(() => {
      if (unregisterLayer) {
        unregisterLayer()
        unregisterLayer = null
      }
    })

    onMounted(async () => {
      if (!settingStore.loaded) await settingStore.load()
      await load()
    })

    /**
     * 页面重新显示
     *
     * ★ 从详情页返回时要把右滑收起来 ★
     *   点分类名进详情页前那一行可能正滑着，
     *   返回后看到还挂着的操作区会以为「没退出来」。
     */
    onShow(() => {
      closeAllSwipes()
    })

    // 侧滑返回 / 返回键：编辑弹层打开时先收起弹层，不退出本页
    onBackPress(() => handleBackPress())

    return {
      settingStore, activeType, tree, expandedIds,
      showEditor, editingId, editorForm, types, colors, swipeStates,
      iconOptions, iconEmoji, editorTitle, isEditingFixed,
      primaryColor, pageStyle,
      switchType, toggleExpand, openCreate, openEdit, parentNameOf,
      isFixed, goDetail, closeEditor, closeAllSwipes, onDeleteFromEditor,
      onSaveCategory, onDelete, goBack
    }
  }
}
</script>

<style scoped>
/*
 * 支出 / 收入切换的外层
 *
 * ★ 只负责定位，控件本身在 App.vue ★
 *   原来这里还写着 .type-item / .type-text / .type-indicator 一整套
 *   下划线 tab，现在换成全局的 .seg-toggle / .seg-item
 *   （和统计页、时间筛选条同款）。
 *   局部保留同名规则会压住全局样式，所以旧的那几条必须删干净。
 *
 * ★ flex-shrink: 0 ★
 *   本页是「PageNav + 切换条 + scroll-view」的纵向 flex 布局，
 *   滚动区没有这个约束就会把切换条压扁。
 */
.type-bar {
  flex-shrink: 0;
  padding: 8rpx 32rpx 16rpx;
}

.page-scroll {
  padding: 0 32rpx;
}

.cat-group {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-bottom: 16rpx;
  overflow: hidden;
}

/* wd-swipe-action 的外层：每一行独立包一层 */
.cat-swipe {
  display: block;
  border-bottom: 1rpx solid var(--app-line);
}

.cat-swipe:last-child {
  border-bottom: none;
}

/* 子分类所在的那一层不画分隔线（由子行自己画） */
.cat-swipe-child {
  border-bottom: none;
}

/* 父类行 */
.parent-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 26rpx 28rpx;
  background-color: var(--app-card);
}
.parent-icon {
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.parent-emoji {
  font-size: 34rpx;
  line-height: 1;
}

.parent-name {
  flex: 1;
  font-size: 28rpx;
  color: var(--app-text);
  font-weight: 500;
}

.parent-count {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/* 固定分类（系统分类及其固定子类）的标记 */
.parent-locked {
  font-size: 20rpx;
  color: var(--app-text-3);
  background-color: var(--app-card-2);
  border-radius: 8rpx;
  padding: 2rpx 10rpx;
}

.action-lock {
  font-size: 22rpx;
  color: var(--app-text-3);
}

/*
 * 固定子类的「固定」小标记
 *
 * 比父级的「固定分类」标签更小、更淡 ——
 * 父级是「这是一整组固定分类」的强提示，
 * 子类只是逐个确认「我也改不了」，不需要同样抢眼。
 */
.child-locked {
  font-size: 18rpx;
  color: var(--app-text-3);
  background-color: var(--app-card-2);
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
  flex-shrink: 0;
}

.expand-icon {
  font-size: 32rpx;
  color: var(--app-text-3);
  transition: transform 0.2s;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

/*
  子分类区

  ★ 原来这里有一条 4rpx 的左侧竖线 + 40rpx 缩进 ★
    用户反馈「左边一条竖线真丑陋」——
    那种画法像代码编辑器里的缩进参考线，不像 App 列表。

  现在的层级表达（干净的二级列表）：
    1. 子类区整体用 --app-card-2 背景 —— 一眼能看出「这一块是二级的」
    2. 子类行左缩进 28rpx —— 位置本身就说明从属关系
    3. 子类图标比父类小一号（48rpx vs 68rpx）
    4. 子类文字用次级色（--app-text-2），父类用主色（--app-text）
  没有竖线、没有粗边框、没有大符号。
*/
.children {
  background-color: var(--app-card-2);
  padding: 4rpx 28rpx 4rpx 56rpx;
}

.child-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid var(--app-line);
}

.child-row:last-of-type {
  border-bottom: none;
}

/* 子类自己的图标（比父类小一号） */
.child-icon {
  width: 48rpx;
  height: 48rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.child-emoji {
  font-size: 26rpx;
  line-height: 1;
}

.child-name {
  flex: 1;
  font-size: 26rpx;
  color: var(--app-text-2);
}

.child-add {
  justify-content: flex-start;
  padding: 20rpx 0;
  border-bottom: none;
}

.child-add-text {
  font-size: 24rpx;
  color: var(--app-primary);
}

.child-actions {
  display: flex;
  justify-content: center;
  padding: 20rpx 0 8rpx;
}

/* 右滑操作区：编辑 / 删除 */
.swipe-edit,
.swipe-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 150rpx;
  height: 100%;
}

.swipe-action-text {
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 500;
}

/* 固定分类：滑出来只提示 */
.swipe-locked {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200rpx;
  height: 100%;
  background-color: var(--app-text-3);
}

.swipe-locked-text {
  color: #ffffff;
  font-size: 24rpx;
}

/* 右上角：新建一级分类 */
.nav-add {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-wrap {
  background-color: var(--app-card);
  border-radius: 20rpx;
  margin-top: 16rpx;
}

/* 编辑器 */
.editor {
  background-color: var(--app-card);
  padding-bottom: env(safe-area-inset-bottom);
}

.editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx;
  border-bottom: 1rpx solid var(--app-line);
}

.editor-cancel {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.editor-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--app-text);
}

.editor-save {
  font-size: 28rpx;
  color: var(--app-primary);
  font-weight: 500;
}

.editor-body {
  max-height: 62vh;
  padding: 8rpx 28rpx 32rpx;
}

.editor-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 96rpx;
  border-bottom: 1rpx solid var(--app-line);
  gap: 20rpx;
}

.editor-row-column {
  flex-direction: column;
  align-items: flex-start;
  padding: 24rpx 0;
  gap: 16rpx;
}

.editor-label {
  font-size: 28rpx;
  color: var(--app-text);
}

.editor-input {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: var(--app-text);
}

.editor-placeholder {
  font-size: 28rpx;
  color: var(--app-text-3);
}

.editor-hint {
  font-size: 24rpx;
  color: var(--app-text-3);
}

/* 编辑弹层底部的删除入口 */
.editor-danger {
  text-align: center;
  padding: 24rpx 0 40rpx;
  border-top: 1rpx solid var(--app-line);
  margin-top: 8rpx;
}

.danger-link {
  font-size: 26rpx;
  color: var(--app-danger);
}

.color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  width: 100%;
}

.color-cell {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
}

.color-cell.active {
  outline: 4rpx solid var(--app-text);
  outline-offset: 2rpx;
}

/* 图标选择 */
.icon-scroll {
  width: 100%;
  max-height: 380rpx;
}

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.icon-cell {
  width: calc((100% - 60rpx) / 6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  padding: 12rpx 4rpx;
  border-radius: 12rpx;
  background-color: var(--app-card-2);
  border: 2rpx solid transparent;
}

.icon-cell.active {
  border-color: var(--app-primary);
  background-color: var(--app-primary-light);
}

.icon-emoji {
  font-size: 36rpx;
  line-height: 1.1;
}

.icon-name {
  font-size: 16rpx;
  color: var(--app-text-3);
  text-align: center;
  line-height: 1.2;
}
</style>
