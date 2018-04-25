const http = require('http')

const app = require('../../app')
const spt = require('../support')
const swaggerDocs = require('../specs/swagger')

describe('test/controllers/project.test.js', () => {
  let docsServer, request, user, soucheUser

  afterAll(() => {
    docsServer.close()
    spt.cleanCollections()
  })

  beforeAll(async () => {
    docsServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(swaggerDocs))
    }).listen(7400)
    user = await spt.createUser()
    soucheUser = await spt.createUser('souche', '123456')
    request = spt.createRequest(app.listen(), user.token)
  })

  describe('create', () => {
    test('参数验证', async () => {
      const res = await request('/api/project/create', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('项目成员不能包含自己', async () => {
      const res = await request('/api/project/create', 'post')
        .send({
          name: 'example',
          url: '/example',
          members: [user._id]
        })

      expect(res.body.message).toBe('项目成员不能包含自己')
    })

    test('无权限操作', async () => {
      const res = await request('/api/project/create', 'post')
        .send({
          name: 'example',
          url: '/example',
          group: '111111111111111111111111'
        })

      expect(res.body.message).toBe('无权限操作')
    })

    test('项目已存在', async () => {
      const res = await request('/api/project/create', 'post')
        .send({
          name: '演示项目',
          url: '/example',
          description: 'example'
        })
      expect(res.body.message).toBe('项目 演示项目 已存在')
    })

    test('创建项目', async () => {
      const res = await request('/api/project/create', 'post')
        .send({
          name: 'demo',
          url: '/demo',
          description: 'demo',
          members: [soucheUser._id],
          swagger_url: 'http://127.0.0.1:7400'
        })
      expect(res.body.success).toBe(true)
    })
  })

  describe('copy', () => {
    test('参数验证', async () => {
      const res = await request('/api/project/copy', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('项目不存在', async () => {
      const res = await request('/api/project/copy', 'post')
        .send({ id: '111111111111111111111111' })

      expect(res.body.message).toBe('项目不存在')
    })

    test('复制项目', async () => {
      let res = await request('/api/project')

      res = await request('/api/project/copy', 'post')
        .send({ id: res.body.data[1]._id })
      res = await request('/api/project')

      const data = res.body.data

      expect(data).toHaveLength(3)
      expect(data[0].url).toBe('/example_copy')
      expect(data[0].name).toBe('演示项目_copy')
    })

    test('项目已存在', async () => {
      let res = await request('/api/project')
        .query({ keywords: '演示项目$' })
      res = await request('/api/project/copy', 'post')
        .send({ id: res.body.data[0]._id })

      expect(res.body.message).toBe('项目 演示项目_copy 已存在')
    })

    test('该项目无接口可复制', async () => {
      let res = await request('/api/project/create', 'post')
        .send({
          name: 'empty',
          url: '/empty',
          description: 'empty'
        })

      const projects = await request('/api/project').then(res => res.body.data)

      res = await request('/api/project/copy', 'post')
        .send({ id: projects[0]._id })
      await request('/api/project/delete', 'post').send({ id: projects[0]._id })
      expect(res.body.message).toBe('该项目无接口可复制')
    })
  })

  describe('updateWorkbench', () => {
    test('参数验证', async () => {
      const res = await request('/api/project/update_workbench', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('无权限操作', async () => {
      const res = await request('/api/project/update_workbench', 'post')
        .send({
          id: '111111111111111111111111',
          status: true
        })

      expect(res.body.message).toBe('无权限操作')
    })

    test('加入工作台', async () => {
      let res = await request('/api/project')

      res = await request('/api/project/update_workbench', 'post')
        .send({
          id: res.body.data[0].extend._id,
          status: true
        })

      expect(res.body.success).toBe(true)
    })
  })

  describe('list', () => {
    test('参数验证', async () => {
      const res = await request('/api/project').query({ type: 'demo' })

      expect(res.body.message).toBe('params error')
    })

    test('我创建的', async () => {
      const res = await request('/api/project').query({ filter_by_author: 1 })
      expect(res.body.data).toHaveLength(3)
    })

    test('我加入的', async () => {
      const res = await request('/api/project', 'get', soucheUser.token)
        .query({ filter_by_author: 2 })

      const data = res.body.data
      expect(data).toHaveLength(1)
      expect(data[0].url).toBe('/demo')
      expect(data[0].name).toBe('demo')
    })

    test('搜索', async () => {
      const res = await request('/api/project')
        .query({ keywords: 'example' })

      const data = res.body.data
      expect(data).toHaveLength(2)
      expect(data[0].url).toBe('/example_copy')
      expect(data[0].name).toBe('演示项目_copy')
      expect(data[1].url).toBe('/example')
      expect(data[1].name).toBe('演示项目')
    })

    test('工作台', async () => {
      const res = await request('/api/project')
        .query({ type: 'workbench' })

      const data = res.body.data

      expect(data).toHaveLength(1)
      expect(data[0].url).toBe('/example_copy')
      expect(data[0].name).toBe('演示项目_copy')
    })

    test('团队项目', async () => {
      await request('/api/group/create', 'post')
        .send({ name: 'souche' })

      let res = await request('/api/group')
      await request('/api/project/create', 'post')
        .send({
          name: 'group',
          url: '/group',
          group: res.body.data[0]._id
        })

      res = await request('/api/project')
        .query({ group: res.body.data[0]._id })

      const data = res.body.data

      expect(data).toHaveLength(1)
      expect(data[0].url).toBe('/group')
      expect(data[0].name).toBe('group')
    })

    test('获取未加入团队的项目', async () => {
      let res = await request('/api/group')
      res = await request('/api/project', 'get', soucheUser.token)
        .query({ group: res.body.data[0]._id })

      const data = res.body.data

      expect(data).toHaveLength(0)
    })
  })

  describe('update', () => {
    test('参数验证', async () => {
      const res = await request('/api/project/update', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('无权限操作', async () => {
      let res = await request('/api/project', 'get', soucheUser.token)
      res = await request('/api/project/update', 'post')
        .send({
          id: res.body.data[1]._id,
          name: 'demo',
          url: '/demo'
        })

      expect(res.body.message).toBe('无权限操作')
    })

    test('项目成员不能包含创建者', async () => {
      let res = await request('/api/project', 'get')
      res = await request('/api/project/update', 'post')
        .send({
          id: res.body.data[0]._id,
          name: 'demo',
          url: '/demo',
          members: [res.body.data[0].user._id]
        })

      expect(res.body.message).toBe('项目成员不能包含创建者')
    })

    test('邀请成员', async () => {
      let res = await request('/api/project', 'get')

      res = await request('/api/project/update', 'post')
        .send({
          id: res.body.data[0]._id,
          name: 'copy',
          url: '/copy',
          members: [soucheUser._id]
        })

      expect(res.body.success).toBe(true)
    })

    test('移除成员', async () => {
      let res = await request('/api/project', 'get')

      res = await request('/api/project/update', 'post')
        .send({
          id: res.body.data[0]._id,
          name: 'copy',
          url: '/copy',
          members: []
        })

      expect(res.body.success).toBe(true)
    })

    test('项目已存在', async () => {
      let res = await request('/api/project', 'get')

      res = await request('/api/project/update', 'post')
        .send({
          id: res.body.data[0]._id,
          name: '演示项目',
          url: '/example'
        })

      expect(res.body.message).toBe('项目 演示项目 已存在')
    })

    test('团队项目', async () => {
      let res = await request('/api/group')
      res = await request('/api/project')
        .query({ group: res.body.data[0]._id })
      res = await request('/api/project/update', 'post')
        .send({
          id: res.body.data[0]._id,
          name: '演示项目',
          url: '/example'
        })

      expect(res.body.success).toBe(true)
    })

    test('非团队成员无法更新项目', async () => {
      let res = await request('/api/group')
      res = await request('/api/project')
        .query({ group: res.body.data[0]._id })
      res = await request('/api/project/update', 'post', soucheUser.token)
        .send({
          id: res.body.data[0]._id,
          name: '演示项目',
          url: '/example'
        })
      expect(res.body.message).toBe('无权限操作')
    })
  })

  describe('syncSwagger', () => {
    test('参数验证', async () => {
      const res = await request('/api/project/sync/swagger', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('无权限操作', async () => {
      let res = await request('/api/project', 'get', soucheUser.token)
      res = await request('/api/project/sync/swagger', 'post')
        .send({ id: res.body.data[1]._id })

      expect(res.body.message).toBe('无权限操作')
    })

    test('请先设置 Swagger 文档地址', async () => {
      let res = await request('/api/project', 'get')
      res = await request('/api/project/sync/swagger', 'post')
        .send({ id: res.body.data[0]._id })

      expect(res.body.message).toBe('请先设置 Swagger 文档地址')
    })

    test('同步 Swagger 文档', async () => {
      let res = await request('/api/project', 'get')
      res = await request('/api/project/sync/swagger', 'post')
        .send({ id: res.body.data[1]._id })

      expect(res.body.success).toBe(true)
    })
  })

  describe('delete', () => {
    test('参数验证', async () => {
      const res = await request('/api/project/delete', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('无权限操作', async () => {
      let res = await request('/api/project', 'get', soucheUser.token)
      res = await request('/api/project/delete', 'post')
        .send({ id: res.body.data[1]._id })

      expect(res.body.message).toBe('无权限操作')
    })

    test('非团队创建者无法删除项目', async () => {
      let res = await request('/api/group')
      res = await request('/api/project')
        .query({ group: res.body.data[0]._id })
      res = await request('/api/project/delete', 'post', soucheUser.token)
        .send({ id: res.body.data[0]._id })

      expect(res.body.message).toBe('无权限操作')
    })

    test('删除项目', async () => {
      let res = await request('/api/project')
      res = await request('/api/project/delete', 'post')
        .send({ id: res.body.data[0]._id })

      expect(res.body.success).toBe(true)
    })
  })

  describe('copyCase', () => {
    test('参数验证', async () => {
      let res = await request('/api/project/case', 'post')

      expect(res.body.message).toBe('params error')
    })

    test('无权限操作', async () => {
      await request('/api/project/create', 'post')
        .send({
          name: 'demoForApiCase',
          url: '/',
          swagger_url: 'http://127.0.0.1:7400'
        })

      let res = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })

      res = await request('/api/project/case', 'post', soucheUser.token)
        .send({
          id: res.body.data[0]._id,
          caseName: 'newCaseTest'
        })

      expect(res.body.message).toBe('无权限操作')
    })

    test('复制自己个人项目下的场景', async () => {
      let projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })
      const projectId = projectsRes.body.data[0]._id
      let res = await request('/api/mock/create', 'post')
        .send({
          project_id: projectId,
          url: '/mockforapicase',
          mode: '{ "currentNo": 0 }',
          method: 'get',
          description: 'mockforapicase'
        })
      expect(res.body.success)
      const mockId = res.body.data.apis[0]._id

      res = await request('/api/project/case', 'post')
        .send({
          id: projectId,
          caseName: 'newCaseTest'
        })
      expect(res.body.success).toBe(true)

      res = await request(`/mock/${projectId}/${user._id}/mockforapicase`)
      expect(res.body.currentNo).toBe(0)

      res = await request('/api/u/project/update', 'put')
        .send({
          projectId: projectId,
          caseName: 'default'
        })
      expect(res.body.success).toBe(true)

      res = await request('/api/mock/update', 'post')
        .send({
          id: mockId,
          url: '/mockforapicase',
          mode: '{ "currentNo": 1 }',
          method: 'get',
          description: 'mockforapicase'
        })
      expect(res.body.success).toBe(true)

      res = await request(`/mock/${projectId}/${user._id}/mockforapicase`)
      expect(res.body.currentNo).toBe(1)

      projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })

      expect(projectsRes.body.data[0].cases).toHaveLength(2)
      expect(projectsRes.body.data[0].cases[0]).toBe('default')
      expect(projectsRes.body.data[0].cases[1]).toBe('newCaseTest')
    })
  })

  describe('deleteCase', () => {
    test('无权限操作', async () => {
      const projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })

      let res = await request(`/api/project/${projectsRes.body.data[0]._id}/case/default`, 'delete', soucheUser.token)

      expect(res.body.message).toBe('无权限操作')
    })

    test('无法删除默认场景', async () => {
      const projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })

      let res = await request(`/api/project/${projectsRes.body.data[0]._id}/case/default`, 'delete')
      expect(res.body.message).toBe('无法删除默认场景')
    })

    test('待删除场景不存在', async () => {
      const projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })

      let res = await request(`/api/project/${projectsRes.body.data[0]._id}/case/notexist`, 'delete')
      expect(res.body.message).toBe('待删除场景不存在')
    })

    test('删除场景，并且删除前有用户选了该场景的', async () => {
      let projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })
      const projectId = projectsRes.body.data[0]._id

      let res = await request(`/mock/${projectId}/${user._id}/mockforapicase`)
      expect(res.body.currentNo).toBe(1)

      res = await request('/api/u/project/update', 'put')
        .send({
          projectId: projectId,
          caseName: 'newCaseTest'
        })

      res = await request(`/mock/${projectId}/${user._id}/mockforapicase`)
      expect(res.body.currentNo).toBe(0)

      res = await request(`/api/project/${projectId}/case/newCaseTest`, 'delete')
      expect(res.body.success).toBe(true)

      res = await request(`/mock/${projectId}/${user._id}/mockforapicase`)
      expect(res.body.currentNo).toBe(1)

      projectsRes = await request('/api/project', 'get')
        .query({
          keywords: 'demoForApiCase'
        })

      expect(projectsRes.body.data[0].cases).toHaveLength(1)
      expect(projectsRes.body.data[0].cases[0]).toBe('default')
    })
  })
})
