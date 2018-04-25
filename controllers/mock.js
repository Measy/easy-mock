'use strict'

const _ = require('lodash')
const { VM } = require('vm2')
const nodeURL = require('url')
const JSZip = require('jszip')
const Mock = require('mockjs')
const axios = require('axios')
const config = require('config')
const pathToRegexp = require('path-to-regexp')

const util = require('../util')
const ft = require('../models/fields_table')
const { MockProxy, ProjectProxy, UserGroupProxy, UserProjectProxy } = require('../proxy')

const redis = util.getRedis()
const defPageSize = config.get('pageSize')

async function checkByMockId (mockId, uid) { // 检查接口是否存在并进行权限校验
  const api = await MockProxy.getById(mockId)

  if (!api) return '接口不存在'
  const project = await checkByProjectId(api.project.id, uid)

  if (typeof project === 'string') return project
  return { api, project }
}

async function checkByProjectId (projectId, uid) {
  const project = await ProjectProxy.getById(uid, projectId)

  if (project) {
    const group = project.group
    if (group) {
      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })
      if (!userGroup) return '无权限操作'
    } else if (project.user.id !== uid) {
      /* istanbul ignore else */
      if (!_.find(project.members, ['id', uid])) return '无权限操作'
    }
    return project
  }

  return '项目不存在'
}

async function checkByCaseName (projectId, uid, caseName) {
  const project = await ProjectProxy.findOne({ _id: projectId })

  if (project) {
    const group = project.group
    if (group) {
      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })
      if (!userGroup) return '无权限操作'
    } else if (project.user.id !== uid) {
      /* istanbul ignore else */
      if (!_.find(project.members, ['id', uid])) return '无权限操作'
    } else if (!project.cases.includes(caseName)) {
      return '场景不存在'
    }
    return project
  }

  return '项目不存在'
}

module.exports = class MockController {
  /**
   * 创建接口
   * @param Object ctx
   */

  static async create (ctx) {
    const uid = ctx.state.user.id
    const mode = ctx.checkBody('mode').notEmpty().value
    const projectId = ctx.checkBody('project_id').notEmpty().value
    const description = ctx.checkBody('description').notEmpty().value
    const url = ctx.checkBody('url').notEmpty().match(/^\/.*$/i, 'URL 必须以 / 开头').value
    const method = ctx.checkBody('method').notEmpty().toLow().in(['get', 'post', 'put', 'delete', 'patch']).value
    const apiCase = ctx.checkBody('api_case').value || 'default' // 属于的场景

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByCaseName(projectId, uid, apiCase)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    // 2.查重, url，method。
    // 新改动，不需要查重了，因为要支持同一个场景下同一个接口的不同返回值
    const mock = await MockProxy.findOne({
      project: projectId,
      url,
      method,
      case: apiCase,
      isCurrent: true
    })

    let hasCurrent = false
    if (mock && mock.isCurrent) {
      hasCurrent = true
    }

    // 保存
    const apis = await MockProxy.newAndSave({
      project: projectId,
      case: apiCase,
      isCurrent: !hasCurrent,
      description,
      method,
      url,
      mode
    })

    await redis.del('project:' + projectId)
    ctx.body = ctx.util.resuccess({
      apis
    })
  }

  /**
   * 获取接口列表
   * @param Object ctx
   */

  static async list (ctx) {
    const uid = ctx.state.user.id
    const keywords = ctx.query.keywords
    const projectId = ctx.checkQuery('project_id').notEmpty().value
    const pageSize = ctx.checkQuery('page_size').empty().toInt().gt(0).default(defPageSize).value
    const pageIndex = ctx.checkQuery('page_index').empty().toInt().gt(0).default(1).value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    let project = await checkByProjectId(projectId, uid)
    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    // 选取用户当前处于的场景
    const userProject = await UserProjectProxy.findOne({
      user: uid,
      project: projectId
    })
    let apiCase = 'default'

    if (project.cases.includes(userProject.currentCase)) {
      apiCase = userProject.currentCase
    } else {
      userProject.currentCase = 'default' // 此处为矫正场景被删除后用户默认选中重置的情况
      await UserProjectProxy.updateCurrentCase(userProject)
    }

    const opt = {
      skip: (pageIndex - 1) * pageSize,
      limit: pageSize,
      sort: '-url'
    }

    const where = {
      project: projectId,
      case: apiCase
    }

    if (keywords) {
      const keyExp = new RegExp(keywords)
      where.$or = [{
        url: keyExp
      }, {
        description: keyExp
      }, {
        method: keyExp
      }, {
        mode: keyExp
      }]
    }

    let mocks = await MockProxy.find(where, opt)

    /* istanbul ignore else */
    if (project) {
      project.members = project.members.map(o => _.pick(o, ft.user))
      project.extend = _.pick(project.extend, ft.projectExtend)
      project.group = _.pick(project.group, ft.group)
      project.user = _.pick(project.user, ft.user)
      project = _.pick(project, ['user'].concat(ft.project))
    }

    mocks = mocks.map(o => _.pick(o, ft.mock))
    ctx.body = ctx.util.resuccess({ project: project || {}, mocks, apiCase })
  }

  /**
   * 更新接口
   * @param Object ctx
   */

  static async update (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value
    const mode = ctx.checkBody('mode').notEmpty().value
    const description = ctx.checkBody('description').notEmpty().value
    const url = ctx.checkBody('url').notEmpty().match(/^\/.*$/i, 'URL 必须以 / 开头').value
    const method = ctx.checkBody('method').notEmpty().toLow().in(['get', 'post', 'put', 'delete', 'patch']).value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const result = await checkByMockId(id, uid)

    if (typeof result === 'string') {
      ctx.body = ctx.util.refail(result)
      return
    }

    const { api, project } = result
    const keepOrginal = (api.url === url) && (api.method === method) // 只要方法和url一致，就认为是同一个接口

    const apiUpdated = {
      ..._.pick(api, ft.mock),
      url,
      mode,
      method,
      description,
      isCurrent: keepOrginal ? api.isCurrent : true,
      id: api.id
    }

    const existMock = await MockProxy.findOne({ // 本质上不存在同一场景下该接口变更为其他接口的操作，如果需要请用接口复制功能
      _id: { $ne: apiUpdated.id },
      project: project.id,
      url: apiUpdated.url,
      method: apiUpdated.method,
      case: apiUpdated.case
    })

    if (!keepOrginal && existMock) { // 不是更改同一个接口，并且新的接口已经存在
      ctx.body = ctx.util.refail('接口已经存在')
      return
    }

    await MockProxy.updateById(apiUpdated)
    await redis.del('project:' + project.id)
    ctx.body = ctx.util.resuccess()
  }

  /**
   * 获取 Mock 接口
   * @param {*} ctx
   */
  static async getMockAPI (ctx) {
    const { query, body } = ctx.request
    const method = ctx.method.toLowerCase()
    const jsonpCallback = query.jsonp_param_name && (query[query.jsonp_param_name] || 'callback')
    let { projectId, mockURL, uid } = ctx.pathNode
    const redisKey = 'project:' + projectId
    let apiData, apis, api

    let project = await checkByProjectId(projectId, uid)
    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    // 选取用户当前处于的场景
    const userProject = await UserProjectProxy.findOne({
      user: uid,
      project: projectId
    })
    let caseName = userProject.currentCase
    if (!project.cases.includes(caseName)) { // 此处为矫正场景被删除后用户默认选中重置的情况
      userProject.currentCase = 'default'
      caseName = 'default'
      await UserProjectProxy.updateCurrentCase(userProject)
    }

    apis = await redis.get(redisKey)

    if (apis) {
      apis = JSON.parse(apis)
    } else {
      apis = await MockProxy.find({ project: projectId })
      if (apis[0]) await redis.set(redisKey, JSON.stringify(apis), 'EX', 60 * 30)
    }

    if (apis[0] && apis[0].project.url !== '/') {
      mockURL = mockURL.replace(apis[0].project.url, '') || '/'
    }

    api = apis.filter((item) => {
      const url = item.url.replace(/{/g, ':').replace(/}/g, '') // /api/{user}/{id} => /api/:user/:id
      return pathToRegexp(url).test(mockURL) && item.isCurrent && item.case === caseName && item.method === method // 选择当前激活的
    })[0]

    if (!api) ctx.throw(404)

    Mock.Handler.function = function (options) {
      const mockUrl = api.url.replace(/{/g, ':').replace(/}/g, '') // /api/{user}/{id} => /api/:user/:id
      options.Mock = Mock
      options._req = ctx.request
      options._req.params = util.params(mockUrl, mockURL)
      options._req.cookies = ctx.cookies.get.bind(ctx)
      return options.template.call(options.context.currentContext, options)
    }

    if (/^http(s)?/.test(api.mode)) { // 代理模式
      const url = nodeURL.parse(api.mode.replace(/{/g, ':').replace(/}/g, ''), true)
      const params = util.params(api.url.replace(/{/g, ':').replace(/}/g, ''), mockURL)
      const pathname = pathToRegexp.compile(url.pathname)(params)
      try {
        apiData = await axios({
          method: method,
          url: url.protocol + '//' + url.host + pathname,
          params: _.assign({}, url.query, query),
          data: body,
          timeout: 3000
        }).then(res => res.data)
      } catch (error) {
        ctx.body = ctx.util.refail(error.message || '接口请求失败')
        return
      }
    } else {
      const vm = new VM({
        timeout: 1000,
        sandbox: {
          Mock: Mock,
          mode: api.mode,
          template: new Function(`return ${api.mode}`) // eslint-disable-line
        }
      })

      vm.run('Mock.mock(new Function("return " + mode)())') // 数据验证，检测 setTimeout 等方法
      apiData = vm.run('Mock.mock(template())') // 解决正则表达式失效的问题

      /* istanbul ignore else */
      if (apiData._res) { // 自定义响应 Code
        let _res = apiData._res
        ctx.status = _res.status || /* istanbul ignore next */ 200
        /* istanbul ignore else */
        if (_res.cookies) {
          for (let i in _res.cookies) {
            /* istanbul ignore else */
            if (_res.cookies.hasOwnProperty(i)) ctx.cookies.set(i, _res.cookies[i])
          }
        }
        /* istanbul ignore next */
        if (_res.headers) {
          for (let i in _res.headers) {
            /* istanbul ignore next */
            if (_res.headers.hasOwnProperty(i)) ctx.set(i, _res.headers[i])
          }
        }
        /* istanbul ignore next */
        if (_res.status && parseInt(_res.status, 10) !== 200 && _res.data) apiData = _res.data
        delete apiData['_res']
      }
    }

    await redis.lpush('mock.count', api._id)
    if (jsonpCallback) {
      ctx.type = 'text/javascript'
      ctx.body = `${jsonpCallback}(${JSON.stringify(apiData, null, 2)})`
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029') // JSON parse vs eval fix. https://github.com/rack/rack-contrib/pull/37
    } else {
      ctx.body = apiData
    }
  }

  /**
   * 激活接口
   * @param Object ctx
   */

  static async setCurrent (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkParams('id').value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const result = await checkByMockId(id, uid) // 资源和权限校验
    if (typeof result === 'string') {
      ctx.body = ctx.util.refail(result)
      return
    }

    const { api, project } = result

    // 改变原先的选择的接口的isCurrent为false
    const originalCurrent = await MockProxy.findOne({
      project: project._id,
      url: api.url,
      method: api.method,
      case: api.case,
      isCurrent: true
    })
    if (originalCurrent) {
      originalCurrent.isCurrent = false
      await MockProxy.updateById(originalCurrent)
    }

    // 更新新选择的mock的isCurrent为true
    api.isCurrent = true
    await MockProxy.updateById(api)
    await redis.del('project:' + project._id)
    ctx.body = ctx.util.resuccess()
  }

  /**
   * Easy Mock CLI 依赖该接口获取接口数据
   * @param Object ctx
   */

  static async getAPIByProjectIds (ctx) {
    let projectIds = ctx.checkQuery('project_ids').notEmpty().value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    projectIds = projectIds.split(',')

    const apis = await MockProxy.find({
      project: {
        $in: projectIds
      }
    })

    const projects = await ProjectProxy.findByIds(projectIds)

    const result = {}

    projects.forEach((project) => {
      const projectId = project.id
      let newMocks = apis.filter(o => (o.project.id === projectId))
      let newProject = projects.filter(o => (o.id === projectId))[0]

      newProject.members = newProject.members.map(o => _.pick(o, ft.user))
      newProject.user = _.pick(newProject.user, ft.user)
      newProject = _.pick(newProject, ['user'].concat(ft.project))
      newMocks = newMocks.map(o => _.pick(o, ft.mock))

      result[projectId] = {
        project: newProject,
        mocks: newMocks
      }
    })

    ctx.body = ctx.util.resuccess(result)
  }

  /**
   * 接口导出
   * @param Object ctx
   */

  static async exportAPI (ctx) {
    const zip = new JSZip()
    const ids = ctx.checkBody('ids').empty().type('array').value
    const projectId = ctx.checkBody('project_id').empty().value
    let apis

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    if (projectId) {
      apis = await MockProxy.find({ project: projectId })
    } else if (!_.isEmpty(ids)) {
      apis = await MockProxy.find({
        _id: {
          $in: ids
        }
      })
    } else {
      ctx.body = ctx.util.refail('参数不能为空')
      return
    }

    if (_.isEmpty(apis)) {
      ctx.body = ctx.util.refail('没有可导出的接口')
      return
    }

    apis.forEach((api) => {
      zip.file(`${api.project.url}${api.url}.json`, api.mode)
    })

    const content = await zip.generateAsync({ type: 'nodebuffer' })

    ctx.set('Content-disposition', 'attachment; filename=Easy-Mock-API.zip')
    ctx.body = content
  }

  /**
   * 删除接口
   * @param Object ctx
   */

  static async delete (ctx) {
    const uid = ctx.state.user.id
    const projectId = ctx.checkBody('project_id').notEmpty().value
    const ids = ctx.checkBody('ids').notEmpty().type('array').value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(projectId, uid)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    // 筛选出哪些是current的被删除掉了，如果存在多个同接口mock的，则重新设置isCurrent
    const isCurrentMocks = await MockProxy.find({
      _id: {
        $in: ids
      },
      project: projectId,
      isCurrent: true
    })

    await MockProxy.delByIds(ids)

    // mongodb单机版本的不支持事务，这种分批次操作的，感觉容易出问题，看看是不是后面替换下数据库
    await Promise.all(isCurrentMocks.map(async mock => {
      // 之所以用find而不用findOne，是怕这边删除的瞬间有另一个人更新了isCurrent的mock，就删除的已经部署isCurrent的了
      const mockRemainder = await MockProxy.find({
        url: mock.url,
        method: mock.method,
        case: mock.case
      }, {
        sort: '-isCurrent'
      })
      if (mockRemainder.length > 0 && !mockRemainder[0].isCurrent) {
        const needSetMock = mockRemainder[0]
        needSetMock.isCurrent = true
        await MockProxy.updateById(needSetMock)
      }
    }))

    await redis.del('project:' + projectId)
    ctx.body = ctx.util.resuccess()
  }
}
