/**
 * 账户 store —— 缓存账户列表与总资产，避免每个页面重复查库
 */

import { defineStore } from 'pinia'
import {
  listAccounts, listAccountsGrouped, getTotalAssets, getTotalDebt,
  createAccount, updateAccount, deleteAccount, getAccount, recalcAllBalances
} from '@/api/account.js'

export const useAccountStore = defineStore('account', {
  state: () => ({
    list: [],
    grouped: [],
    totalAssets: 0,
    totalDebt: 0,
    loading: false,
    loaded: false
  }),

  getters: {
    /** 信用账户（信用卡）—— 会欠款的 */
    creditAccounts(state) {
      return state.list.filter((a) => a.isCredit)
    },
    /** 资金账户（不含信用）：网络支付 / 储蓄卡 / 现金 / 充值卡 */
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
        const [list, grouped, assets, debt] = await Promise.all([
          listAccounts(),
          listAccountsGrouped(),
          getTotalAssets(),
          getTotalDebt()
        ])
        this.list = list
        this.grouped = grouped
        this.totalAssets = assets
        this.totalDebt = debt
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
