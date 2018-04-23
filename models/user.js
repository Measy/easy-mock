'use strict'

const mongoose = require('mongoose')

const Schema = mongoose.Schema
const schema = new Schema({
  nick_name: String,
  head_img: String,
  name: String,
  password: String,
  create_at: {
    type: Date,
    default: Date.now
  },
  projects: [{
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project'
    },
    currentCase: {
      type: String,
      default: 'default'
    }
  }]
})

schema.index({ name: 1 }, { unique: true })

module.exports = mongoose.model('User', schema)
