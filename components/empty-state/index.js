/**
 * 公共空态组件 —— 统一并存的空态范式
 * （.empty-state / .empty-page / .order-empty）
 *
 * 用法：
 *   <empty-state icon="box" text="还没有订单" />
 *   <empty-state emoji="📭" text="还没有反馈记录" />
 *   <empty-state icon="bus" text="加载失败" btnText="点击重试" bind:tapbtn="loadLines" />
 *
 * 说明：
 * - emoji 提供时优先渲染 emoji，否则用 icon（项目 components/icon）渲染；
 * - btnText 提供时显示按钮，点击触发 tapbtn 事件；
 * - styleIsolation: apply-shared 使组件 wxss 里的 .elderly-mode 选择器
 *   能命中页面根节点上的老年模式类（页面 wxss 也会应用到组件内）。
 */

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    icon: { type: String, value: '' },      // components/icon 的图标名
    emoji: { type: String, value: '' },     // 提供时渲染 emoji 代替 icon
    text: { type: String, value: '' },      // 主文案
    subText: { type: String, value: '' },   // 可选副文案
    btnText: { type: String, value: '' }    // 可选按钮文案，提供时显示按钮
  },

  methods: {
    onBtnTap() {
      this.triggerEvent('tapbtn')
    }
  }
})
