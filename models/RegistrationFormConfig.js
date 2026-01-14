// models/RegistrationFormConfig.js
const mongoose = require('mongoose');

const PricingPackageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
});

const RegistrationFormConfigSchema = new mongoose.Schema(
  {
    // Reference the SeasonEvent by eventId
    eventId: {
      type: String,
      required: true,
      ref: 'SeasonEvent',
    },
    // Backward compatibility and easier querying
    season: { type: String, required: true },
    year: { type: Number, required: true },
    isActive: { type: Boolean, default: false },
    requiresPayment: { type: Boolean, default: true },
    requiresQualification: { type: Boolean, default: false },
    description: { type: String, default: '' },
    pricing: {
      basePrice: { type: Number, default: 0 },
      packages: [PricingPackageSchema],
    },
  },
  {
    timestamps: true,
  }
);

// Unique index on eventId
RegistrationFormConfigSchema.index({ eventId: 1 }, { unique: true });
// Season-year index for backward compatibility
RegistrationFormConfigSchema.index({ season: 1, year: 1 }, { unique: false });

module.exports = mongoose.model(
  'RegistrationFormConfig',
  RegistrationFormConfigSchema
);
