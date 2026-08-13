const mongoose = require('mongoose')

const systemMigrationSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true, maxlength: 120 },
  completedAt: { type: Date, required: true, default: Date.now },
  details: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true })

module.exports = mongoose.model('SystemMigration', systemMigrationSchema)
