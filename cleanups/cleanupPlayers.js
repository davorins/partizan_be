// cleanupPlayers.js
const mongoose = require('mongoose');

// 🔧 Replace this with your MongoDB Atlas connection string
const uri =
  'mongodb+srv://partizan:7ykGhss7VGk78ozy@cluster0.2uaqsib.mongodb.net/?appName=Cluster0';

async function cleanPlayers() {
  try {
    await mongoose.connect(uri, {});

    const db = mongoose.connection.db;
    const players = db.collection('players');

    // Fields to remove
    const fieldsToUnset = {
      season: '',
      registrationYear: '',
      registrationComplete: '',
      paymentComplete: '',
      lastPaymentDate: '',
    };

    const result = await players.updateMany({}, { $unset: fieldsToUnset });

    console.log(`✅ Cleanup complete!`);
    console.log(`Modified ${result.modifiedCount} documents.`);
  } catch (err) {
    console.error('❌ Error during cleanup:', err);
  } finally {
    await mongoose.disconnect();
  }
}

cleanPlayers();
