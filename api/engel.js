/**
 * 恩格尔系数「算食品」的分类 —— 纯存储
 *
 * ★ 为什么这里只剩读写，一点判定逻辑都没有 ★
 *   旧版本用 AI 按分类名判断哪些一级分类属于「吃掉的」，结果缓存到
 *   setting 的 engelFoodCategories 键上。用户本轮明确要求：
 *   「复用多选分类弹层，让用户自行选择用于食物消费的支出分类来计算恩格尔系数，
 *     之前添加的 ai 识别食物消费什么的逻辑全部删除。」
 *
 *   所以判定链路（chat 调用、提示词、refreshEngelFoodCategories /
 *   ensureEngelFoodCategories / getEngelCacheState 等）整段删掉，
 *   分类清单的唯一来源变成「用户在组件管理页手选的结果」。
 *
 * ★ 为什么本来也该这么改（不只是听用户话）★
 *   1. AI 判定不稳定：同一个账本同一批分类，模型换个版本、换个温度，
 *      判出来的清单可能就不一样，恩格尔曲线会莫名其妙地跳；
 *   2. AI 判定解释不了：用户看到「食品支出 ¥800」时，最想问的是
 *      「你把哪几个分类算进去了」—— 手选清单能直接答，
 *      AI 判定的清单用户既看不懂也没法改。
 *   3. 它还是唯一一处「为了展示一个百分比而发网络请求」的地方：
 *      断网、Key 失效、额度用完，统计页就得干等或空着。
 *
 * ★ 键名为什么沿用 engelFoodCategories（没改名）★
 *   老用户库里已经存着 AI 判定的结果，键名不变的话升级后清单不空，
 *   统计页立刻能出数；用户想调整再去「组件管理 → 恩格尔系数 → 食品分类」改。
 *   改名等于强制所有人重新配一遍，没有必要。
 *
 * ★ 只存 id，不存分类名 ★
 *   分类可以改名，存名字的话统计页显示的还是旧名字。
 *   id 是稳定主键，名字由页面用 listCategories 现查现拼。
 */

import { getSetting, setSetting } from './settings.js'

/** setting 表里的键名（与 DEFAULT_SETTINGS.engelFoodCategories 一致） */
export const ENGEL_FOOD_KEY = 'engelFoodCategories'

/**
 * 归一化一份 id 数组：去空、去重、只留字符串。
 *
 * ★ 为什么在这里也做一遍（写入时已经做过）★
 *   这个函数同时给「读」用。库里可能是：
 *     · 从没设过（默认值 []）
 *     · 覆盖导入的一份老 JSON（里面可能带 null / 数字 / 重复项）
 *     · 上一个版本 AI 写进去的结果（脏数据可能性更高）
 *   读口不归一化，页面 v-for 就会渲染出空标签，或者 :key 重复报错。
 *
 * @param {any} raw
 * @returns {string[]} 全新的数组（不共享引用）
 */
function normalizeFoodIds(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    // 只认字符串 id：数字 id 是脏数据（分类 id 是 'cat_xxx' 这种前缀串）
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id) continue
    if (out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * 读用户手选的「算食品」的一级支出分类 id。
 *
 * 永远返回数组（不返回 null / undefined），
 * 统计页可以无脑 `.length` 判断「用户还没选过」。
 *
 * @returns {Promise<string[]>}
 */
export async function getEngelFoodIds() {
  try {
    const raw = await getSetting(ENGEL_FOOD_KEY, [])
    return normalizeFoodIds(raw)
  } catch (e) {
    // 设置读失败不该让统计页整体挂掉：恩格尔只是展示型指标
    console.warn('[engel] 读食品分类失败:', e && e.message)
    return []
  }
}

/**
 * 保存用户手选的「算食品」分类 id。
 *
 * 去空去重后写 setting —— 多选弹层回传的就是一串 id，
 * 但用户在弹层里反复勾选/取消很容易带出重复项，这里统一收口。
 *
 * @param {string[]} ids 一级支出分类 id 数组
 * @returns {Promise<string[]>} 实际写进去的数组（去重后的）
 */
export async function setEngelFoodIds(ids) {
  const next = normalizeFoodIds(ids)
  await setSetting(ENGEL_FOOD_KEY, next)
  return next
}

/**
 * 清空（用户想重新选时用；组件管理页的「清空」走弹层回传空数组，
 * 这个函数留给将来可能的「重置」入口，语义更直白）。
 *
 * @returns {Promise<string[]>} 空数组
 */
export async function clearEngelFoodIds() {
  await setSetting(ENGEL_FOOD_KEY, [])
  return []
}
