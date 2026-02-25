// utils/playerStatusUtils.js
const SeasonUtils = require('./seasonUtils');

class PlayerStatusUtils {
  // Extract base season name from a full season string
  static extractBaseSeason(seasonName) {
    if (!seasonName) return '';

    const lower = seasonName.toLowerCase();

    if (lower.includes('spring')) return 'Spring';
    if (lower.includes('summer')) return 'Summer';
    if (lower.includes('fall')) return 'Fall';
    if (lower.includes('winter')) return 'Winter';

    return seasonName;
  }

  // Check if a season string matches the target season (flexible matching)
  static isSeasonMatch(seasonName, targetSeason) {
    if (!seasonName || !targetSeason) return false;

    const baseSeason = this.extractBaseSeason(seasonName);
    const baseTarget = this.extractBaseSeason(targetSeason);

    return baseSeason === baseTarget;
  }

  // Get next season
  static getNextSeason() {
    const currentSeason = SeasonUtils.getCurrentSeason();
    const seasonOrder = ['Winter', 'Spring', 'Summer', 'Fall'];
    const currentIndex = seasonOrder.indexOf(currentSeason);
    return seasonOrder[(currentIndex + 1) % 4];
  }

  // Get next season year
  static getNextSeasonYear() {
    const currentSeason = SeasonUtils.getCurrentSeason();
    const currentYear = SeasonUtils.getCurrentYear();
    return currentSeason === 'Winter' ? currentYear + 1 : currentYear;
  }

  // Get player status based on seasons
  static getPlayerStatus(player) {
    const currentYear = SeasonUtils.getCurrentYear();
    const currentSeason = SeasonUtils.getCurrentSeason();
    const nextSeason = this.getNextSeason();
    const nextSeasonYear = this.getNextSeasonYear();

    console.log('🔍 [BACKEND] Calculating player status for:', player.fullName);
    console.log('📅 Current:', { season: currentSeason, year: currentYear });
    console.log('⏭️ Next:', { season: nextSeason, year: nextSeasonYear });

    // If player has no seasons array, check top-level fields
    if (
      !player.seasons ||
      !Array.isArray(player.seasons) ||
      player.seasons.length === 0
    ) {
      if (
        this.isSeasonMatch(player.season, currentSeason) &&
        player.registrationYear === currentYear
      ) {
        console.log('✅ Current season match from top-level');
        return player.paymentComplete ? 'active' : 'pending';
      }
      if (
        this.isSeasonMatch(player.season, nextSeason) &&
        player.registrationYear === nextSeasonYear
      ) {
        console.log('⏭️ Next season match from top-level');
        return 'pending';
      }
      return 'inactive';
    }

    // Check seasons array
    console.log('📋 Checking seasons array:', player.seasons);

    // Check for current season
    const currentSeasonReg = player.seasons.find(
      (s) =>
        this.isSeasonMatch(s.season, currentSeason) && s.year === currentYear,
    );

    if (currentSeasonReg) {
      console.log('✅ Found current season registration:', currentSeasonReg);
      return currentSeasonReg.paymentComplete ? 'active' : 'pending';
    }

    // Check for next season
    const nextSeasonReg = player.seasons.find(
      (s) =>
        this.isSeasonMatch(s.season, nextSeason) && s.year === nextSeasonYear,
    );

    if (nextSeasonReg) {
      console.log('⏭️ Found next season registration:', nextSeasonReg);
      return 'pending';
    }

    console.log('❌ No current or next season registration');
    return 'inactive';
  }

  // Check if player is registered for current season
  static isRegisteredForCurrentSeason(player) {
    const currentYear = SeasonUtils.getCurrentYear();
    const currentSeason = SeasonUtils.getCurrentSeason();

    if (player.seasons && Array.isArray(player.seasons)) {
      return player.seasons.some(
        (s) =>
          this.isSeasonMatch(s.season, currentSeason) && s.year === currentYear,
      );
    }

    return (
      this.isSeasonMatch(player.season, currentSeason) &&
      player.registrationYear === currentYear
    );
  }

  // Check if player has paid for current season
  static isPaidForCurrentSeason(player) {
    const currentYear = SeasonUtils.getCurrentYear();
    const currentSeason = SeasonUtils.getCurrentSeason();

    if (player.seasons && Array.isArray(player.seasons)) {
      const currentSeasonReg = player.seasons.find(
        (s) =>
          this.isSeasonMatch(s.season, currentSeason) && s.year === currentYear,
      );
      return currentSeasonReg
        ? currentSeasonReg.paymentComplete === true
        : false;
    }

    if (
      this.isSeasonMatch(player.season, currentSeason) &&
      player.registrationYear === currentYear
    ) {
      return player.paymentComplete === true;
    }

    return false;
  }

  // Get all players with their calculated status
  static async getPlayersWithStatus(players) {
    return players.map((player) => ({
      ...(player.toObject ? player.toObject() : player),
      calculatedStatus: this.getPlayerStatus(player),
    }));
  }
}

module.exports = PlayerStatusUtils;
