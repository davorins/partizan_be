// utils/seasonUtils.js
const SeasonEvent = require('../models/SeasonEvent');

class SeasonUtils {
  // Get current season based on date
  static getCurrentSeason() {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12

    if (month >= 3 && month <= 5) return 'Spring';
    if (month >= 6 && month <= 8) return 'Summer';
    if (month >= 9 && month <= 11) return 'Fall';
    return 'Winter';
  }

  // Get current year
  static getCurrentYear() {
    return new Date().getFullYear();
  }

  // Check if a season is the current season
  static isCurrentSeason(season, year) {
    return season === this.getCurrentSeason() && year === this.getCurrentYear();
  }

  // Get display name for a season
  static async getSeasonDisplayName(season, year) {
    try {
      const seasonEvent = await SeasonEvent.findOne({
        season: { $regex: new RegExp(season, 'i') },
        year: year,
      });

      if (!seasonEvent) {
        return `${season} ${year}`;
      }

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

  // Get all active season events
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
