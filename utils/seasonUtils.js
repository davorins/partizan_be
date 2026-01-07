// utils/seasonUtils.js
const SeasonEvent = require('../models/SeasonEvent');

class SeasonUtils {
  // Get display name for a season
  static async getSeasonDisplayName(season, year) {
    try {
      // Find by season and year
      let seasonEvent = await SeasonEvent.findOne({
        season: { $regex: new RegExp(season, 'i') },
        year: year,
      });

      // If not found, find by just the name
      if (!seasonEvent) {
        seasonEvent = await SeasonEvent.findOne({
          season: { $regex: new RegExp(season, 'i') },
        });
      }

      // If still not found, use the provided name
      if (!seasonEvent) {
        return `${season} ${year}`;
      }

      // Return the admin-created season name
      return `${seasonEvent.season} ${seasonEvent.year}`;
    } catch (error) {
      console.error('Error getting season display name:', error);
      return `${season} ${year}`;
    }
  }

  // Get season event by ID
  static async getSeasonEvent(eventId) {
    try {
      return await SeasonEvent.findOne({ eventId });
    } catch (error) {
      console.error('Error getting season event:', error);
      return null;
    }
  }

  // Get all active season events for dropdowns
  static async getActiveSeasonEvents() {
    try {
      return await SeasonEvent.find({ registrationOpen: true }).sort({
        year: -1,
        season: 1,
      });
    } catch (error) {
      console.error('Error getting active season events:', error);
      return [];
    }
  }
}

module.exports = SeasonUtils;
