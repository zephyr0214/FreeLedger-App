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
