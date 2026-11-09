/**
 * 账户 store —— 缓存账户列表与总资产，避免每个页面重复查库
 */

import { defineStore } from 'pinia'
import {
  listAccounts, listAccountsGrouped, getTotalAssets, getTotalDebt, getAssetOverview,
  createAccount, updateAccount, deleteAccount, getAccount, recalcAllBalances
} from '@/api/account.js'

export const useAccountStore = defineStore('account', {
  state: () => ({
    list: [],
    grouped: [],
    /**
     * 总资产 = 计入总资产的账户里，**正余额之和**
     *
     * ★ 注意这里的口径 ★
     *   以前 totalAssets 是「所有余额之和」（负余额直接抵扣），
     *   所以它其实等于净资产。账户页新版把它拆成
     *   「总资产（拥有的钱）」和「负债（欠的钱）」两块，
     *   于是 totalAssets 改成只算正余额 —— 与 getAssetOverview 一致。
     */
    totalAssets: 0,
    /** 负债 = 账户负余额绝对值之和 + 未归还的借入 */
    totalDebt: 0,
    /** 负债里属于「未归还借入」的那部分（页面用来解释构成） */
    loanDebt: 0,
    /**
     * 应收（借出）= 尚未收回的借出净额（借出 - 借款收回）
     *
     * ★ 只展示，不计入净资产 ★
     *   借出的钱已经从账户余额里扣掉了，加回资产等于
     *   「借出去的钱还当自己的钱」。它又确实是可收回的钱，
     *   所以单独放一个字段给账户页显示，不混进下面的 netAssets。
     */
    /**
     * 应收 = 尚未收回的借出 + 待报销（页面「应收」那一格）
     *
     * ★ 用户反馈：应收没把待报销算进去 ★
     *   两者都是「钱已经出去了、但应当回来」，只算借出的话
     *   用户垫付的那部分在概览里完全看不见。
     */
    netReceivable: 0,
    /** 净资产 = 总资产 - 负债，账户页那个大数字 */
    netAssets: 0,
    loading: false,
    loaded: false
  }),

  getters: {
    /** 欠钱类账户（信用卡 / 网络借贷）—— 余额通常是负的 */
    creditAccounts(state) {
      return state.list.filter((a) => a.isCredit)
    },
    /**
     * 资金账户（不含欠钱类）：网络支付 / 储蓄卡 / 电话卡 / 现金 / 充值卡
     *
     * ★ 按 isCredit 取反，不要写 type !== 'credit' ★
     *   网络借贷也是欠钱的，写死 key 会把它漏到「资金账户」里。
     */
    fundAccounts(state) {
      return state.list.filter((a) => !a.isCredit)
    },
    /** 默认账户：优先设置里的 defaultAccountId，否则第一个真实账户 */
    defaultAccount(state) {
      return state.list.find((a) => !a.isCombo) || state.list[0] || null
    },
    hasAccounts(state) {
      return state.list.length > 0
    },
    /** id -> account 的映射，交易列表渲染用 */
    map(state) {
      const m = {}
      state.list.forEach((a) => { m[a.id] = a })
      return m
    }
  },

  actions: {
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return

      this.loading = true
      try {
        const [list, grouped, overview] = await Promise.all([
          listAccounts(),
          listAccountsGrouped(),
          getAssetOverview()
        ])
        this.list = list
        this.grouped = grouped
        this.totalAssets = overview.assets
        this.totalDebt = overview.debt
        this.loanDebt = overview.loanDebt || 0
        /*
         * ★ 应收（借出）★
         *   老版本 getAssetOverview 不返回 lending，
         *   这里 `|| 0` 保证升级覆盖场景下页面不会出现 NaN。
         *   ★ 它不参与 netAssets：净资产口径保持 assets - debt ★
         */
        /*
         * ★ 优先用 receivable（= 借出 + 待报销）★
         *   回退到 lending 是为了兼容「api 还没更新」的中间状态：
         *   否则一旦某次打包顺序出错，这一格会直接变 0。
         */
        this.netReceivable = overview.receivable !== undefined
          ? (overview.receivable || 0)
          : (overview.lending || 0)
        this.netAssets = overview.net
        this.loaded = true
      } finally {
        this.loading = false
      }
    },

    async refresh() {
      this.loaded = false
      await this.load(true)
    },

    async create(input) {
      const acc = await createAccount(input)
      await this.refresh()
      return acc
    },

    async update(id, patch) {
      const acc = await updateAccount(id, patch)
      await this.refresh()
      return acc
    },

    async remove(id) {
      await deleteAccount(id)
      await this.refresh()
    },

    async getById(id) {
      const cached = this.list.find((a) => a.id === id)
      if (cached) return cached
      return getAccount(id)
    },

    async repair() {
      const n = await recalcAllBalances()
      await this.refresh()
      return n
    }
  }
})
