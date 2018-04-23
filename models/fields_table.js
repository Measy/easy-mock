'use strict'

module.exports = {
  group: ['_id', 'name'],
  mock: ['_id', 'url', 'method', 'description', 'mode', 'parameters', 'response_model', 'isCurrent', 'case'],
  user: ['_id', 'name', 'nick_name', 'head_img', 'token'],
  project: ['_id', 'name', 'url', 'description', 'swagger_url',
    'members', 'extend', 'group', 'cases'],
  projectExtend: ['_id', 'is_workbench']
}
