const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    category: { type: String, required: true },
    questions: { type: [String], required: true },
    answers: { type: [String], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    _id: false,
  },
);

module.exports = mongoose.model('FAQ', faqSchema);
