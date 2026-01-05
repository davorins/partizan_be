const mongoose = require('mongoose');
const Event = require('../models/Event');
const CalendarDateGenerator = require('../utils/calendarDateGenerator');
const moment = require('moment');

async function initCalendarEvents() {
  try {
    console.log('🎯 Initializing calendar with important dates for 2026...');

    // FIRST: Clean up any existing system events to start fresh
    await Event.deleteMany({
      source: 'system',
      isPredefined: true,
    });
    console.log('🧹 Cleaned up existing system events');

    const generator = new CalendarDateGenerator(2026);
    const importantDates = generator.getImportantDates();

    // Create a system user ID
    const systemUserId = new mongoose.Types.ObjectId(
      '000000000000000000000000'
    );

    let createdCount = 0;
    let skippedCount = 0;

    for (const dateEvent of importantDates) {
      // Create event with PROPER all-day formatting
      const eventStart = moment(dateEvent.date).startOf('day').toDate();
      const eventEnd = dateEvent.endDate
        ? moment(dateEvent.endDate).endOf('day').toDate()
        : moment(dateEvent.date).endOf('day').toDate();

      const event = new Event({
        title: dateEvent.title,
        start: eventStart,
        end: eventEnd,
        category: dateEvent.category,
        backgroundColor: dateEvent.backgroundColor,
        isPredefined: true,
        source: 'system',
        recurrence: 'yearly',
        originalDate: dateEvent.date,
        createdBy: systemUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await event.save();
      createdCount++;
      console.log(
        `✅ Created: ${dateEvent.title} (${moment(eventStart).format('MMM D')})`
      );
    }

    console.log(`🎉 Calendar initialization complete!`);
    console.log(`📊 Created: ${createdCount} events`);
    return { createdCount, skippedCount: 0, total: importantDates.length };
  } catch (error) {
    console.error('❌ Error initializing calendar events:', error);
    throw error;
  }
}

// If run directly
if (require.main === module) {
  require('dotenv').config();

  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/sportsapp';

  mongoose
    .connect(mongoUri)
    .then(() => {
      console.log('🔗 Connected to MongoDB');
      return initCalendarEvents();
    })
    .then(() => {
      console.log('🏁 Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('💥 Failed:', err);
      process.exit(1);
    });
}

module.exports = initCalendarEvents;
