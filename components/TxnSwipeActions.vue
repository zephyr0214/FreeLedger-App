<template>
  <!--
    流水行的右滑快捷操作（删除 / 标签）

    ★ 为什么抽成组件而不是两个页面各写一份 ★
      首页和「全部交易」页都要求「右滑某条流水可以快捷删除和添加标签」。
      两处的按钮尺寸、颜色、间距必须一模一样 ——
      各写一份的话，改一处漏一处，同一操作在两个页面长得不一样。

    ★ 为什么按钮自己绑 @click.stop ★
      wd-swipe-action 的整个右滑区只 emit 一个 click 事件（还不带按的是哪个按钮），
      所以每个按钮自己绑 @click.stop，点完顺手把这一行收回去。
  -->
  <view class="swipe-actions">
    <!--
      ★ 底色画在内层，外层留 2rpx 透明边（修复「右滑按钮渗出一条竖线」）★
        wd-swipe-action 收起时靠 transform: translate3d(100%, 0, 0) 把右滑区
        推到可视区外面，再由父级 overflow: hidden 裁掉。
        但手机是 2x/3x 屏，100% 位移换算成物理像素时会有亚像素误差 ——
        滚动的瞬间会露出约 1px 的按钮底色，看起来就是流水行右侧
        多出一条深色竖线（用户反馈「漏出来了一点标签的黑色竖线」）。

        修法不是去调位移（那要改库），而是让**最靠左的那 2rpx 是透明的**：
        外层只负责布局，内层铺底色。误差再大也只是露出透明，看不见。
    -->
    <view class="swipe-btn" @click.stop="onTag">
      <view class="swipe-btn-face swipe-btn-face--tag">
        <text class="swipe-btn-text">标签</text>
      </view>
    </view>
    <view class="swipe-btn" @click.stop="onDelete">
      <view class="swipe-btn-face swipe-btn-face--del">
        <text class="swipe-btn-text">删除</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'TxnSwipeActions',
  emits: ['delete', 'tag'],
  setup(props, { emit }) {
    /*
     * ★ 删除用危险色、标签用中性色 ★
     *   删除是不可逆操作（软删除，但用户界面里就是删了），必须用红；
     *   标签是普通编辑动作，用中性灰即可 —— 两个都用彩色反而分不出轻重。
     */
    function onDelete() {
      emit('delete')
    }
    function onTag() {
      emit('tag')
    }
    return { onDelete, onTag }
  }
}
</script>

<style scoped>
.swipe-actions {
  display: flex;
  height: 100%;
}

/* 外层：只占位，留出左侧 2rpx 的透明缓冲（见模板注释） */
.swipe-btn {
  width: 130rpx;
  height: 100%;
  padding-left: 2rpx;
  box-sizing: border-box;
}

/* 内层：真正的按钮面，铺满剩余空间 */
.swipe-btn-face {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.swipe-btn-face--tag {
  background-color: var(--app-text-3);
}

.swipe-btn-face--del {
  background-color: var(--app-danger);
}

.swipe-btn-text {
  font-size: 26rpx;
  /* 彩色底上只有白字能保证对比度，这是全项目唯一允许写死白色的场景 */
  color: #ffffff;
}
</style>
