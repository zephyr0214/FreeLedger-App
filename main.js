import App from './App'
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import { wotQueue } from './utils/wotQueue.js'

export function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()
  app.use(pinia)
  /*
   * 给 wot-design-uni 注入安全的浮层队列。
   * 清空所有数据时首页多行 wd-swipe-action 同时卸载，
   * 库自带的模块级队列会访问已销毁代理的 `$` 并抛错。
   */
  app.provide('__QUEUE_KEY__', wotQueue)
  return {
    app,
    pinia
  }
}
