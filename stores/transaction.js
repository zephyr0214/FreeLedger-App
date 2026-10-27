/**
 * 交易 store —— 首页/列表页共享，负责缓存与失效
 */

import { defineStore } from 'pinia'
import {
  listTransactions, listTodayTransactions, listRecentTransactions,
  createTransaction, updateTransaction, deleteTransaction, restoreTransaction,
  getDailyTotals, getTransaction
} from '@/api/transaction.js'
import { getOverview } from '@/api/stats.js'
import { toMonthKey } from '@/utils/date.js'

export const useTransactionStore = defineStore('transaction', {
  state: () => ({
    todayList: [],
    recentList: [],
    overview: {
      monthKey: '',
      monthExpense: 0,
      monthIncome: 0,
      monthBalance: 0,
      todayExpense: 0,
      todayIncome: 0
    },
    dailyTotals: {},
    currentMonth: toMonthKey(),
    loading: false
  }),

  getters: {
    /** 首页最近交易：优先今日，为空回退最近 5 笔 */
    displayList(state) {
      return state.todayList.length > 0 ? state.todayList : state.recentList
    },
    isTodayEmpty(state) {
      return state.todayList.length === 0
    },
    /** 月历用的日汇总 */
    dayData(state) {
      return (dayKey) => state.dailyTotals[dayKey] || { expense: 0, income: 0, count: 0 }
    }
  },

  actions: {
    /** 首页数据：概览 + 今日 + 最近 + 月历 */
    async loadHome(force = false) {
      const mk = toMonthKey()
      this.loading = true
      try {
        this.currentMonth = mk
        const [overview, today, recent, daily] = await Promise.all([
          getOverview(mk),
          listTodayTransactions(20),
          listRecentTransactions(5),
          getDailyTotals(mk)
        ])
        this.overview = overview
        this.todayList = today
        this.recentList = recent
        this.dailyTotals = daily
      } finally {
        this.loading = false
      }
    },

    async loadMonth(monthKey) {
      this.currentMonth = monthKey
      const [overview, daily] = await Promise.all([
        getOverview(monthKey),
        getDailyTotals(monthKey)
      ])
      this.overview = overview
      this.dailyTotals = daily
      return { overview, daily }
    },

    async create(input) {
      const res = await createTransaction(input)
      await this.loadHome(true)
      return res
    },

    async update(id, patch) {
      const res = await updateTransaction(id, patch)
      await this.loadHome(true)
      return res
    },

    async remove(id) {
      await deleteTransaction(id)
      await this.loadHome(true)
    },

    async restore(id) {
      await restoreTransaction(id)
      await this.loadHome(true)
    },

    async detail(id) {
      return getTransaction(id)
    },

    async list(opt) {
      return listTransactions(opt)
    }
  }
})
