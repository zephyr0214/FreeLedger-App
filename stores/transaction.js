/**
 * 交易 store —— 首页/列表页共享，负责缓存与失效
 */

import { defineStore } from 'pinia'
import {
  listTransactions, listTodayTransactions, listRecentTransactions,
  listAllTransactionsOfDay,
  createTransaction, updateTransaction, deleteTransaction, restoreTransaction,
  getDailyTotals, getAllDailyTotals, getTransaction
} from '@/api/transaction.js'
import { getOverview } from '@/api/stats.js'
import { toMonthKey } from '@/utils/date.js'

export const useTransactionStore = defineStore('transaction', {
  state: () => ({
    todayList: [],
    recentList: [],
    /**
     * 今天的**全部**流水（不限条数）
     *
     * ★ 为什么单独一份，不复用 todayList ★
     *   todayList 是 listTodayTransactions(20)，有 20 条上限，
     *   只够「今日概览」用。首页最近收支的新规则要求
     *   「当日 >= 5 条时显示全部当日记录」——
     *   用带上限的那个，记了 25 笔的那天就会少显示 5 笔。
     */
    todayAll: [],
    overview: {
      monthKey: '',
      monthExpense: 0,
      monthIncome: 0,
      monthBalance: 0,
      todayExpense: 0,
      todayIncome: 0
    },
    dailyTotals: {},
    /**
     * 全部流水的按日汇总（不限月份）
     *
     * ★ 和 dailyTotals 的区别 ★
     *   dailyTotals 只含当月（月历用）；
     *   这里是所有日期的 —— 首页「最近收支」的分组金额要用它，
     *   因为最近几条可能跨月，而且要显示**当日全部**流水
     *   而不是只显示出来的那几条（见 api/transaction.js 的 getAllDailyTotals 注释）。
     */
    allDailyTotals: {},
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
        const [overview, today, recent, daily, allDaily, todayAll] = await Promise.all([
          getOverview(mk),
          listTodayTransactions(20),
          listRecentTransactions(5),
          getDailyTotals(mk),
          // 首页分组金额要用「当日全部流水」的合计，
          // 一次全表按天聚合，条数很少、代价可以忽略
          getAllDailyTotals(),
          // 今日全部流水（不限条数）—— 首页最近收支的新规则要用
          listAllTransactionsOfDay()
        ])
        this.overview = overview
        this.todayList = today
        this.recentList = recent
        this.dailyTotals = daily
        this.allDailyTotals = allDaily
        this.todayAll = todayAll
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
