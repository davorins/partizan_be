// utils/parentStatusUtils.js
const PlayerStatusUtils = require('./playerStatusUtils');
const SeasonUtils = require('./seasonUtils');

class ParentStatusUtils {
  // Get parent status based on their players
  static getParentStatus(parent) {
    // Coaches are always active
    if (parent.isCoach) return 'active';

    const players = parent.players || [];

    if (!players || players.length === 0) {
      return 'inactive';
    }

    let hasActivePlayer = false;
    let hasPendingPlayer = false;

    for (const player of players) {
      const playerStatus = PlayerStatusUtils.getPlayerStatus(player);

      if (playerStatus === 'active') {
        hasActivePlayer = true;
      } else if (playerStatus === 'pending') {
        hasPendingPlayer = true;
      }
    }

    // Active if at least one player is active
    if (hasActivePlayer) return 'active';

    // Pending if at least one player is pending
    if (hasPendingPlayer) return 'pending';

    // Inactive if no players registered for current season
    return 'inactive';
  }

  // Get payment status for parent
  static getPaymentStatus(parent) {
    const players = parent.players || [];

    if (!players || players.length === 0) return null;

    const currentYear = SeasonUtils.getCurrentYear();
    const currentSeason = SeasonUtils.getCurrentSeason();

    // Check current season players
    const currentSeasonPlayers = players.filter((player) => {
      if (player.seasons && Array.isArray(player.seasons)) {
        return player.seasons.some(
          (s) =>
            PlayerStatusUtils.isSeasonMatch(s.season, currentSeason) &&
            s.year === currentYear,
        );
      }
      return (
        PlayerStatusUtils.isSeasonMatch(player.season, currentSeason) &&
        player.registrationYear === currentYear
      );
    });

    if (currentSeasonPlayers.length === 0) {
      // Check any player for payment status
      const anyPaid = players.some((p) => p.paymentComplete === true);
      return anyPaid ? 'paid' : 'notPaid';
    }

    const allPaid = currentSeasonPlayers.every((player) => {
      if (player.seasons && Array.isArray(player.seasons)) {
        const currentSeasonReg = player.seasons.find(
          (s) =>
            PlayerStatusUtils.isSeasonMatch(s.season, currentSeason) &&
            s.year === currentYear,
        );
        return currentSeasonReg
          ? currentSeasonReg.paymentComplete === true
          : false;
      }
      return player.paymentComplete === true;
    });

    return allPaid ? 'paid' : 'notPaid';
  }

  // Get parents with calculated statuses
  static async getParentsWithStatus(parents) {
    return parents.map((parent) => ({
      ...(parent.toObject ? parent.toObject() : parent),
      calculatedStatus: this.getParentStatus(parent),
      calculatedPaymentStatus: this.getPaymentStatus(parent),
    }));
  }

  // Filter parents by status
  static filterParentsByStatus(parents, status) {
    return parents.filter((parent) => this.getParentStatus(parent) === status);
  }
}

module.exports = ParentStatusUtils;
