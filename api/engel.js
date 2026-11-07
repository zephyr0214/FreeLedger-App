/**
 * 恩格尔系数辅助 —— 判断哪些一级分类属于「吃掉的」
 *
 * ★ 为什么要用 AI 判断，而不是写死一张表 ★
 *   分类名是用户自己起的（「餐饮食品」「吃饭」「早餐」「食堂」…），
 *   写死一张表永远覆盖不全；用户明确要求「使用 ai 来判断哪些属于吃掉的分类」。
 *
 * ★ 为什么把结果缓存到 setting ★
 *   分类表很少变，AI 判定一次就能一直用；不缓存的话每打开统计页
 *   都要请求一次大模型（慢、费钱，还可能因为网络失败而空着）。
 *   缓存键 `engelFoodCategories`，值是分类 id 数组。
 *
 * ★ 什么时候刷新 ★
 *   用户的第 11 条要求：**每次调用 AI 记账结束后检查一次是否有该数据，
 *   没有的话就执行一次**。见 components/QuickAddBar.vue 的 ensureEngelFoodCategories()。
 *   另外分类增删改之后（分类页保存）也应该让它失效 —— 见 clearEngelCache()。
 */

import { listCategories } from './category.js'
import { getSetting, setSetting } from './settings.js'
import { chat } from './ai.js'

/** setting 表里的缓存键 */
export const ENGEL_CACHE_KEY = 'engelFoodCategories'

/**
 * 读缓存（没有就返回空数组，不触发 AI）。
 *
 * @returns {Promise<string[]>} 一级分类 id 数组
 */
export async function getCachedEngelFoodIds() {
  const raw = await getSetting(ENGEL_CACHE_KEY, null)
  return Array.isArray(raw) ? raw.filter(Boolean) : []
}

/** 让缓存失效（分类增删改后调用，下次会重新判定） */
export async function clearEngelCache() {
  await setSetting(ENGEL_CACHE_KEY, null)
}

/**
 * 取「属于吃的」一级分类 id。
 *
 * ★ 缓存优先 ★
 *   有缓存直接返回，一次网络都不发；缓存为空才请求 AI。
 *
 * ★ AI 失败怎么办 ★
 *   抛错不往外传 —— 恩格尔系数是展示型指标，
 *   因为 AI 挂了让统计页整体报错不值得。失败时返回空数组，
 *   页面上显示「暂时算不出来」，用户下次数完账还会再试一次。
 *
 * @param {{force?:boolean}} [opt]
 * @returns {Promise<string[]>}
 */
export async function ensureEngelFoodCategories(opt = {}) {
  if (!opt.force) {
    const cached = await getCachedEngelFoodIds()
    if (cached.length > 0) return cached
  }

  // 取全部一级分类（支出方向）：恩格尔系数只看支出
  const list = await listCategories('expense')
  const roots = list.filter((c) => !c.parent_id)
  if (roots.length === 0) return []

  /*
   * ★ 提示词只给一级分类名 ★
   *   二级分类太细（「午餐」「奶茶」），模型容易挑花眼；
   *   恩格尔系数的口径本来就是大类（食品支出 / 总支出）。
   */
  const names = roots.map((c) => c.name)
  const systemPrompt = `你是一个记账 App 的分类助手。
用户会给出他的支出分类名列表，请你判断哪些分类属于「食品/饮食消费」。

判断标准：
- 属于：正餐、零食、饮料、咖啡奶茶、外卖、买菜、食材、水果、食堂、聚餐
- 不属于：烟酒（虽然是入口的，但统计口径上不算食品）、交通、购物、居住、娱乐、
  医疗、教育、人情、通讯、宠物、旅行

只输出 JSON 数组，元素是**用户给的分类名原文**，不要输出解释。
没有属于食品的分类就输出 []。`

  const userPrompt = `支出分类名列表：
${names.map((n) => `- ${n}`).join('\n')}

请输出属于食品/饮食消费的分类名数组。`

  try {
    const res = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { temperature: 0, maxTokens: 500, disableThinking: true }
    )

    /*
     * ★ chat() 返回的是对象不是字符串 ★
     *   形如 { text, reason, reasoning, truncated }（见 api/ai.js 的 extractContent）。
     *   把整个对象当字符串用会得到 "[object Object]"，
     *   于是永远解析不出分类 —— 这里必须取 .text。
     */
    const text = String(res && res.text ? res.text : '').trim()
    // 从回复里抠出第一个 JSON 数组（模型可能包了 markdown 代码块）
    const match = text.match(/\[[\s\S]*?\]/)
    let picked = []
    if (match) {
      try {
        const arr = JSON.parse(match[0])
        if (Array.isArray(arr)) picked = arr.map((x) => String(x || '').trim()).filter(Boolean)
      } catch (e) {
        picked = []
      }
    }

    // 名字 -> id（只认一级分类，忽略模型编出来的名字）
    const idByName = {}
    roots.forEach((c) => { idByName[c.name] = c.id })
    const ids = picked.map((n) => idByName[n]).filter(Boolean)

    await setSetting(ENGEL_CACHE_KEY, ids)
    return ids
  } catch (e) {
    console.warn('[engel] AI 判定失败:', e && e.message)
    /*
     * ★ 失败不写缓存 ★
     *   写空数组会让「没数据」和「判定结果是空」混为一谈，
     *   下次就再也不会重试了。
     */
    return []
  }
}
