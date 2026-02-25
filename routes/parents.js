const express = require('express');
const router = express.Router();
const Parent = require('../models/Parent');
const Player = require('../models/Player');

// Helper function to extract base season name
function extractBaseSeason(seasonName) {
  if (!seasonName) return '';

  const lower = seasonName.toLowerCase();

  if (lower.includes('spring')) return 'Spring';
  if (lower.includes('summer')) return 'Summer';
  if (lower.includes('fall')) return 'Fall';
  if (lower.includes('winter')) return 'Winter';

  return seasonName;
}

// Helper function to check if season matches (flexible matching)
function isSeasonMatch(seasonName, targetSeason) {
  if (!seasonName || !targetSeason) return false;

  const baseSeason = extractBaseSeason(seasonName);
  const baseTarget = extractBaseSeason(targetSeason);

  return baseSeason === baseTarget;
}

// Helper function to get current season
function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'Spring';
  if (month >= 6 && month <= 8) return 'Summer';
  if (month >= 9 && month <= 11) return 'Fall';
  return 'Winter';
}

// Helper function to get next season
function getNextSeason() {
  const currentSeason = getCurrentSeason();
  const seasons = ['Winter', 'Spring', 'Summer', 'Fall'];
  const currentIndex = seasons.indexOf(currentSeason);
  return seasons[(currentIndex + 1) % 4];
}

// Helper function to get next season year
function getNextSeasonYear() {
  const currentSeason = getCurrentSeason();
  const currentYear = new Date().getFullYear();
  return currentSeason === 'Winter' ? currentYear + 1 : currentYear;
}

// Enhanced registration status endpoint
router.get('/:id/registration-status', async (req, res) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) {
      return res.status(404).json({ message: 'Parent not found' });
    }

    const players = await Player.find({ parentId: req.params.id });
    const currentSeason = getCurrentSeason();
    const currentYear = new Date().getFullYear();
    const nextSeason = getNextSeason();
    const nextSeasonYear = getNextSeasonYear();

    console.log('🔍 Registration Status Check:', {
      parentId: req.params.id,
      currentSeason,
      currentYear,
      nextSeason,
      nextSeasonYear,
      playerCount: players.length,
    });

    // Filter players for current season and year using flexible matching
    const currentSeasonPlayers = players.filter(
      (p) =>
        isSeasonMatch(p.season, currentSeason) &&
        p.registrationYear === currentYear,
    );

    // Filter players for next season using flexible matching
    const nextSeasonPlayers = players.filter(
      (p) =>
        isSeasonMatch(p.season, nextSeason) &&
        p.registrationYear === nextSeasonYear,
    );

    // Calculate statuses
    const parentRegistered = parent.registrationComplete || false;
    const parentPaid = parent.paymentComplete || false;

    const allCurrentSeasonPlayersRegistered =
      currentSeasonPlayers.length > 0 &&
      currentSeasonPlayers.every((p) => p.registrationComplete);

    const allCurrentSeasonPlayersPaid =
      currentSeasonPlayers.length > 0 &&
      currentSeasonPlayers.every((p) => p.paymentComplete);

    const allNextSeasonPlayersRegistered =
      nextSeasonPlayers.length > 0 &&
      nextSeasonPlayers.every((p) => p.registrationComplete);

    // Determine overall status
    let overallStatus = 'inactive';
    if (currentSeasonPlayers.length > 0) {
      if (allCurrentSeasonPlayersPaid) {
        overallStatus = 'active';
      } else {
        overallStatus = 'pending';
      }
    } else if (nextSeasonPlayers.length > 0) {
      overallStatus = 'pending';
    }

    res.json({
      // Parent status
      parentRegistered,
      parentPaid,

      // Season info
      currentSeason,
      currentYear,
      nextSeason,
      nextSeasonYear,

      // Players summary
      totalPlayers: players.length,
      currentSeasonPlayers: currentSeasonPlayers.length,
      nextSeasonPlayers: nextSeasonPlayers.length,

      // Players registration status
      hasPlayers: players.length > 0,
      hasCurrentSeasonPlayers: currentSeasonPlayers.length > 0,
      hasNextSeasonPlayers: nextSeasonPlayers.length > 0,

      allCurrentSeasonPlayersRegistered,
      allCurrentSeasonPlayersPaid,
      allNextSeasonPlayersRegistered,

      // Overall status
      overallStatus,
      fullyRegistered:
        parentRegistered &&
        (allCurrentSeasonPlayersRegistered || allNextSeasonPlayersRegistered),
      fullyPaid: parentPaid && allCurrentSeasonPlayersPaid,
      readyForSeason:
        parentRegistered &&
        parentPaid &&
        allCurrentSeasonPlayersRegistered &&
        allCurrentSeasonPlayersPaid,

      // Detailed player info
      players: players.map((player) => {
        const isCurrentSeason =
          isSeasonMatch(player.season, currentSeason) &&
          player.registrationYear === currentYear;
        const isNextSeason =
          isSeasonMatch(player.season, nextSeason) &&
          player.registrationYear === nextSeasonYear;

        let playerStatus = 'inactive';
        if (isCurrentSeason) {
          playerStatus = player.paymentComplete ? 'active' : 'pending';
        } else if (isNextSeason) {
          playerStatus = 'pending';
        }

        return {
          id: player._id,
          name: player.fullName,
          season: player.season,
          year: player.registrationYear,
          registered: player.registrationComplete || false,
          paid: player.paymentComplete || false,
          paymentStatus: player.paymentStatus,
          isCurrentSeason,
          isNextSeason,
          status: playerStatus,
          // Include raw season for debugging
          rawSeason: player.season,
          baseSeason: extractBaseSeason(player.season),
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching registration status:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// Endpoint to mark parent registration as complete
router.post('/:id/mark-registration-complete', async (req, res) => {
  try {
    const parent = await Parent.findByIdAndUpdate(
      req.params.id,
      { registrationComplete: true },
      { new: true },
    );

    if (!parent) {
      return res.status(404).json({ message: 'Parent not found' });
    }

    res.json({
      success: true,
      parentId: parent._id,
      registrationComplete: parent.registrationComplete,
    });
  } catch (error) {
    console.error('Error marking registration complete:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// Endpoint to mark parent payment as complete
router.post('/:id/mark-payment-complete', async (req, res) => {
  try {
    const parent = await Parent.findByIdAndUpdate(
      req.params.id,
      { paymentComplete: true },
      { new: true },
    );

    if (!parent) {
      return res.status(404).json({ message: 'Parent not found' });
    }

    res.json({
      success: true,
      parentId: parent._id,
      paymentComplete: parent.paymentComplete,
    });
  } catch (error) {
    console.error('Error marking payment complete:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// Endpoint to update player statuses for a parent
router.post('/:id/update-player-statuses', async (req, res) => {
  try {
    const players = await Player.find({ parentId: req.params.id });
    const currentSeason = getCurrentSeason();
    const currentYear = new Date().getFullYear();
    const nextSeason = getNextSeason();
    const nextSeasonYear = getNextSeasonYear();

    const updates = [];

    for (const player of players) {
      const isCurrentSeason =
        isSeasonMatch(player.season, currentSeason) &&
        player.registrationYear === currentYear;
      const isNextSeason =
        isSeasonMatch(player.season, nextSeason) &&
        player.registrationYear === nextSeasonYear;

      let newStatus = 'inactive';
      if (isCurrentSeason) {
        newStatus = player.paymentComplete ? 'active' : 'pending';
      } else if (isNextSeason) {
        newStatus = 'pending';
      }

      // You could store this status in the player document if needed
      // For now, just return it
      updates.push({
        playerId: player._id,
        name: player.fullName,
        status: newStatus,
        isCurrentSeason,
        isNextSeason,
      });
    }

    res.json({
      success: true,
      parentId: req.params.id,
      currentSeason,
      currentYear,
      nextSeason,
      nextSeasonYear,
      playerStatuses: updates,
    });
  } catch (error) {
    console.error('Error updating player statuses:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

module.exports = router;
