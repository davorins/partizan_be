// fix-indexes.js (run this once)
const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

async function fixIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/partizan',
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      },
    );

    console.log('✅ Connected to MongoDB');

    // Drop the entire PageLayout model to recreate it with correct indexes
    try {
      await mongoose.connection.db.dropCollection('pagelayouts');
      console.log('✅ Dropped old pagelayouts collection');
    } catch (err) {
      console.log('ℹ️ Collection might not exist yet or already dropped');
    }

    // Recreate the model by requiring it
    const PageLayout = require('./models/PageLayout');

    // Force index creation
    await PageLayout.createIndexes();
    console.log('✅ Created indexes for PageLayout');

    // Verify indexes
    const indexes = await mongoose.connection.db
      .collection('pagelayouts')
      .indexes();
    console.log('\n📊 Current indexes:');
    indexes.forEach((idx, i) => {
      console.log(
        `${i + 1}. ${idx.name}:`,
        idx.key,
        idx.unique ? '(unique)' : '',
      );
    });

    console.log('\n✅ All indexes fixed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

fixIndexes();
