'use strict'

const _ = require('lodash')
const config = require('config')

const util = require('../util')
const ft = require('../models/fields_table')
const SwaggerUtil = require('../util/swagger')
const { MockProxy, ProjectProxy, UserProxy, UserProjectProxy, UserGroupProxy } = require('../proxy')

const redis = util.getRedis()
const defPageSize = config.get('pageSize')

async function checkByProjectId (projectId, uid, creater) {
  const project = await ProjectProxy.getById(uid, projectId)

  if (project) {
    const group = project.group
    if (group) {
      if (creater && group.user.toString() !== uid) return '无权限操作'
      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })
      if (!userGroup) return '无权限操作'
    } else if (project.user.id !== uid) {
      if (creater) return '无权限操作'
      /* istanbul ignore else */
      if (!_.find(project.members, ['id', uid])) return '无权限操作'
    }
    return project
  }

  return '项目不存在'
}

async function checkByCaseName (projectId, uid, caseName, srcCase) {
  const project = await ProjectProxy.findOne({ _id: projectId })

  if (project) {
    const group = project.group
    if (group) {
      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })
      if (!userGroup) return '无权限操作'
    } else if (project.user.id !== uid) {
      /* istanbul ignore else */
      if (!_.find(project.members, ['id', uid])) return '无权限操作'
    } else if (srcCase) {
      if (project.cases.includes(caseName)) return '待新增场景已存在'
      if (!project.cases.includes(srcCase)) return '源场景不存在'
    } else if (!srcCase) {
      if (!project.cases.includes(caseName)) return '待删除场景不存在'
      if (caseName === 'default') return '无法删除默认场景'
    }
    return project
  }

  return '项目不存在'
}

async function getCaseMockList (projectId, caseName, uid) {
  const opt = {
    limit: defPageSize,
    sort: 'url'
  }

  const where = {
    project: projectId,
    case: caseName
  }

  let mocks = await MockProxy.find(where, opt)
  let project = await ProjectProxy.getById(uid, projectId)

  /* istanbul ignore else */
  if (project) {
    project.members = project.members.map(o => _.pick(o, ft.user))
    project.extend = _.pick(project.extend, ft.projectExtend)
    project.group = _.pick(project.group, ft.group)
    project.user = _.pick(project.user, ft.user)
    project = _.pick(project, ['user'].concat(ft.project))
  }

  mocks = mocks.map(o => _.pick(o, ft.mock))

  return { project: project || {}, mocks }
}

module.exports = class ProjectController {
  /**
   * 创建项目
   * @param Object ctx
   */

  static async create (ctx) {
    const uid = ctx.state.user.id
    const group = ctx.request.body.group
    const description = ctx.request.body.description
    const name = ctx.checkBody('name').notEmpty().value
    const memberIds = ctx.checkBody('members').empty().type('array').value
    const url = ctx.checkBody('url').notEmpty().match(/^\/.*$/i, 'URL 必须以 / 开头').value
    const swaggerUrl = ctx.checkBody('swagger_url').empty().isUrl(null, { allow_underscores: true, require_protocol: true }).value
    const findQuery = { name }
    const saveQuery = {
      name,
      url,
      swagger_url: swaggerUrl,
      description: description || name,
      cases: ['default'] // 所有用户第一次关联上项目场景的时候在mock的list方法里面
    }

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    if (_.includes(memberIds, uid)) {
      ctx.body = ctx.util.refail('项目成员不能包含自己')
      return
    }

    if (group) {
      findQuery.group = group
      saveQuery.group = group

      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })

      if (!userGroup) {
        ctx.body = ctx.util.refail('无权限操作')
        return
      }
    } else {
      findQuery.user = uid
      saveQuery.user = uid
      saveQuery.members = memberIds
    }

    const project = await ProjectProxy.findOne(findQuery)

    if (project && project.name === name) {
      ctx.body = ctx.util.refail(`项目 ${name} 已存在`)
      return
    }

    const projects = await ProjectProxy.newAndSave(saveQuery)

    if (swaggerUrl) {
      await SwaggerUtil.create(projects[0])
    }

    ctx.body = ctx.util.resuccess()
  }

  /**
   * 复制项目
   * @param Object ctx
   */

  static async copy (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(id, uid)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    const apis = await MockProxy.find({ project: id })

    if (apis.length === 0) {
      ctx.body = ctx.util.refail('该项目无接口可复制')
      return
    }

    const newUrl = project.url + '_copy'
    const newName = project.name + '_copy'
    const query = { user: uid, name: newName }
    const checkProject = await ProjectProxy.findOne(query)

    if (checkProject) {
      ctx.body = ctx.util.refail(`项目 ${newName} 已存在`)
      return
    }

    const projects = await ProjectProxy.newAndSave({
      user: uid,
      name: newName,
      url: newUrl,
      description: project.description,
      swagger_url: project.swagger_url,
      cases: project.cases
    })

    const newAPIs = apis.map(item => ({
      project: projects[0].id,
      description: item.description,
      method: item.method,
      isCurrent: item.isCurrent,
      case: item.case,
      url: item.url,
      mode: item.mode
    }))

    await MockProxy.newAndSave(newAPIs)

    ctx.body = ctx.util.resuccess()
  }

  /**
   * 获取项目列表
   * @param Object ctx
   */

  static async list (ctx) {
    const uid = ctx.state.user.id
    const group = ctx.query.group
    const keywords = ctx.query.keywords
    const type = ctx.checkQuery('type').empty().toLow().in([ 'workbench' ]).value
    const pageIndex = ctx.checkQuery('page_index').empty().toInt().gt(0).default(1).value
    const pageSize = ctx.checkQuery('page_size').empty().toInt().gt(0).default(defPageSize).value
    const filterByAuthor = ctx.checkQuery('filter_by_author').empty().toInt().default(0).value // 0：全部、1：我创建的、2：我加入的

    let projects, baseWhere

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const opt = {
      skip: (pageIndex - 1) * pageSize,
      limit: pageSize,
      sort: '-create_at'
    }

    if (group) {
      const userGroup = await UserGroupProxy.findOne({ user: uid, group: group })
      if (!userGroup) {
        ctx.body = ctx.util.resuccess([])
        return
      }
      baseWhere = [{ group }]
    } else {
      if (filterByAuthor === 0) {
        baseWhere = [
          { user: uid },
          // If you specify only a single <query> condition in the $elemMatch expression, you do not need to use $elemMatch.
          // { members: { $elemMatch: { $eq: uid } } }
          { members: uid }
        ]
      } else if (filterByAuthor === 1) {
        baseWhere = [{ user: uid }]
      } else {
        baseWhere = [
          // { members: { $elemMatch: { $eq: uid } } }
          { members: uid }
        ]
      }
    }

    let where = { $or: baseWhere }

    if (keywords) {
      const keyExp = new RegExp(keywords, 'i')
      where = {
        $and: [
          { $or: baseWhere },
          {
            $or: [
              { url: keyExp },
              { description: keyExp },
              { name: keyExp }]
          }
        ]
      }
    }

    switch (type) {
      case 'workbench':
        projects = await UserProjectProxy.find({
          user: uid,
          is_workbench: true
        })
        projects = projects.map(item => item.project)
        projects = await ProjectProxy.find(uid, {
          _id: { $in: projects }
        })
        break
      default:
        projects = await ProjectProxy.find(uid, where, opt)
    }

    projects = _.map(projects, (item) => {
      item.members = item.members.map(item => _.pick(item, ft.user))
      item.extend = _.pick(item.extend, ft.projectExtend)
      item.user = _.pick(item.user, ft.user)
      return _.pick(item, ['user'].concat(ft.project))
    })

    ctx.body = ctx.util.resuccess(projects)
  }

  /**
   * 更新工作台
   * @param Object ctx
   */

  static async updateWorkbench (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value
    const status = ctx.checkBody('status').notEmpty().type('boolean').value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const userProjectDocs = await UserProjectProxy.findOne({ _id: id, user: uid })

    if (!userProjectDocs) {
      ctx.body = ctx.util.refail('无权限操作')
      return
    }

    userProjectDocs.is_workbench = status

    await UserProjectProxy.updateWorkbench(userProjectDocs)

    ctx.body = ctx.util.resuccess()
  }

  /**
   * 更新项目
   * @param Object ctx
   */

  static async update (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value
    const name = ctx.checkBody('name').notEmpty().value
    const description = ctx.request.body.description || ''
    const memberIds = ctx.checkBody('members').empty().type('array').value
    const url = ctx.checkBody('url').notEmpty().match(/^\/.*$/i, 'URL 必须以 / 开头').value
    const swaggerUrl = ctx.checkBody('swagger_url').empty().isUrl(null, { allow_underscores: true, require_protocol: true }).value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(id, uid)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    if (project.user && _.includes(memberIds, project.user.id)) {
      ctx.body = ctx.util.refail('项目成员不能包含创建者')
      return
    }

    // 获取操作状态 添加 or 移除
    const addMembers = _.difference(memberIds, project.members)
    const delMembers = _.difference(project.members, memberIds)

    project.url = url
    project.name = name
    project.members = memberIds || []
    project.swagger_url = swaggerUrl
    project.description = description

    const existQuery = {
      _id: { $ne: project.id },
      name: project.name
    }

    if (project.group) {
      existQuery.group = project.group.id
    } else {
      existQuery.user = project.user.id
    }

    // 查重, 同一项目空间只需要控制项目名不要相同就好，提供更高的灵活度
    const existProject = await ProjectProxy.findOne(existQuery)

    if (existProject) {
      ctx.body = ctx.util.refail(`项目 ${project.name} 已存在`)
      return
    }

    if (delMembers.length > 0) {
      await UserProjectProxy.del({
        project: project.id,
        user: { $in: delMembers }
      })
    }

    if (addMembers.length > 0) {
      await UserProjectProxy.newAndSave(addMembers.map(userId => ({
        user: userId,
        project: project.id
      })))
    }

    await ProjectProxy.updateById(project)
    await redis.del('project:' + id)
    ctx.body = ctx.util.resuccess()
  }

  /**
   * 同步 Swagger 文档
   * @param Object ctx
   */

  static async syncSwagger (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(id, uid)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    if (!project.swagger_url) {
      ctx.body = ctx.util.refail('请先设置 Swagger 文档地址')
      return
    }

    await SwaggerUtil.create(project)
    await redis.del('project:' + id)
    ctx.body = ctx.util.resuccess()
  }

  /**
   * 删除项目
   * @param Object ctx
   */

  static async delete (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByProjectId(id, uid, true)

    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }

    // 暂时先不对user里面的projects数据进行变更；后续可能采用其他数据结构，暂且保留冗余数据
    await ProjectProxy.delById(id)
    await redis.del('project:' + id)
    ctx.body = ctx.util.resuccess()
  }

  static async copyCase (ctx) {
    const uid = ctx.state.user.id
    const id = ctx.checkBody('id').notEmpty().value
    const caseName = ctx.checkBody('caseName').notEmpty().value
    const srcCase = ctx.checkBody('srcCase').value || 'default'

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByCaseName(id, uid, caseName, srcCase)
    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }
    // 获取待复制项目指定场景下所有 mock
    const apis = await MockProxy.find({ project: id, case: srcCase })
    if (apis.length === 0) {
      ctx.body = ctx.util.refail('复制场景失败，该场景下无 Mock 数据')
      return
    }

    const projectUpdated = {
      ..._.pick(project, ft.project),
      cases: [...project.cases, caseName],
      id: project.id
    }
    await ProjectProxy.updateById(projectUpdated)
    await MockProxy.newAndSave(apis.map(item => {
      const api = {
        ..._.pick(item, ft.mock),
        case: caseName,
        project: project.id
      }
      delete api._id
      return api
    }))

    // 往user表里面更新关联的project的currentCase信息
    const userProject = await UserProjectProxy.findOne({
      user: uid,
      project: project.id
    })
    userProject.currentCase = caseName
    await UserProjectProxy.updateCurrentCase(userProject)

    const body = await getCaseMockList(project.id, caseName, uid)
    ctx.body = ctx.util.resuccess(body)
  }

  // 删除某个项目下的api场景
  static async deleteCase (ctx) {
    const uid = ctx.state.user.id
    const projectId = ctx.checkParams('projectId').value
    const caseName = ctx.checkParams('caseName').value

    if (ctx.errors) {
      ctx.body = ctx.util.refail(null, 10001, ctx.errors)
      return
    }

    const project = await checkByCaseName(projectId, uid, caseName)
    if (typeof project === 'string') {
      ctx.body = ctx.util.refail(project)
      return
    }
    // 获取待复制项目指定场景下所有 mock
    const mocks = await MockProxy.find({ project: projectId, case: caseName })
    const mockIds = mocks.map(mockItem => mockItem.id)

    // 更新项目的case列表，除去删掉的case,
    // 已选择该场景的用户在再次获取该场景数据发现不存在的时候重置为default,
    //    -mock的list接口
    //    -mock的getMockAPI接口
    const projectUpdated = {
      ..._.pick(project, ft.project),
      cases: project.cases.filter(el => el !== caseName),
      id: project.id
    }
    await ProjectProxy.updateById(projectUpdated)
    await MockProxy.delByIds(mockIds)

    ctx.body = ctx.util.resuccess()
  }
}
