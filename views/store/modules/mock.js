import iView from 'iview'
import * as api from '../../api'
import Vue from 'vue'

export default {
  namespaced: true,
  state: {
    list: [],
    project: {},
    page: {
      description: '',
      title: ''
    },
    keywords: '',
    pageIndex: 1,
    apiCase: 'default'
  },
  mutations: {
    SET_VALUE (state, payload) {
      state.list = state.pageIndex === 1
        ? payload.mocks
        : state.list.concat(payload.mocks)
      state.project = payload.project
    },
    INIT_REQUEST (state) {
      state.keywords = ''
      state.pageIndex = 1
      state.project = {}
      state.list = []
    },
    SET_REQUEST_PARAMS (state, payload) {
      state.keywords = payload.keywords || state.keywords
      state.pageIndex = payload.pageIndex || state.pageIndex
    },
    SET_PAGE (state, payload) {
      state.page = payload
    },
    SET_API_CASE (state, payload) {
      state.apiCase = payload
    },
    SET_API_CASE_CREATED (state, payload) {
      state.list = payload.mocks
      state.project = payload.project
      Vue.nextTick(() => { // select组件只有先更新options之后再去改变v-model才有效，不然v-model失效；所以需要nexttrick去控制options和v-model的改变顺序
        state.apiCase = payload.caseName
      })
    }
  },
  actions: {
    FETCH ({commit, state, rootState}, route) {
      return api.mock.getList({
        params: {
          project_id: route.params.id,
          page_size: 2000, // 不考虑接口分页
          page_index: state.pageIndex,
          keywords: state.keywords
        }
      }).then((res) => {
        if (res.data.success) {
          commit('SET_VALUE', res.data.data)
          state.pageIndex += 1
          commit('SET_REQUEST_PARAMS', { pageIndex: state.pageIndex })
          commit('SET_API_CASE', res.data.data.apiCase || 'default')
          return res.data.data
        }
      })
    },
    async FETCH_BY_PROJECTID ({commit, state, rootState}, projectId) { // 懒得传上面FETCH的route参数，copy了新的传projectId的方法
      const res = await api.mock.getList({
        params: {
          project_id: projectId,
          page_size: 2000, // 不考虑接口分页
          page_index: state.pageIndex,
          keywords: state.keywords,
          api_case: state.apiCase
        }
      })
      if (res.data.success) {
        commit('SET_VALUE', res.data.data)
        state.pageIndex += 1
        commit('SET_REQUEST_PARAMS', { pageIndex: state.pageIndex })
      }
      return res
    },
    CREATE ({commit, dispatch}, {route, mode, description, url, method, api_case}) {
      return api.mock.create({
        data: {
          mode,
          url,
          method,
          description,
          api_case,
          project_id: route.params.id
        }
      }).then((res) => {
        if (res.data.success) {
          iView.Message.success('创建成功')
          commit('SET_REQUEST_PARAMS', {pageIndex: 1})
          dispatch('FETCH', route)
        }
        return res
      })
    },
    async CHOSE_CASE ({commit, dispatch}, {caseName, projectId}) {
      return api.mock.choseCase({
        data: {
          caseName,
          projectId
        }
      }).then(async res => {
        iView.Message.success(`已切换到${caseName}成功`)
        commit('SET_API_CASE', caseName)
        commit('SET_REQUEST_PARAMS', {pageIndex: 1})
        await dispatch('FETCH_BY_PROJECTID', projectId)
        return res
      })
    },
    COPY_CASE ({commit, dispatch}, {caseName, id, srcCase}) {
      return api.project.copyCase({
        data: {
          caseName,
          id,
          srcCase
        }
      }).then(res => {
        if (res.data.success) {
          commit('SET_REQUEST_PARAMS', { pageIndex: 1 })
          commit('SET_API_CASE_CREATED', {...res.data.data, caseName})
          iView.Message.success(`创建${caseName}成功`)
        }
        return res
      })
    },
    DELETE_CASE ({commit, dispatch}, {caseName, projectId}) {
      api.project.deleteCase({
        caseName,
        projectId
      }).then(async res => {
        if (res.data.success) {
          iView.Message.success('删除场景成功')
          commit('SET_REQUEST_PARAMS', { pageIndex: 1 })
          commit('SET_API_CASE', 'default')
          await dispatch('FETCH_BY_PROJECTID', projectId)
        }
        return res
      })
    }
  }
}
