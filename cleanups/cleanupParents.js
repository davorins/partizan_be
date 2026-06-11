// cleanupParents.js
require('dotenv').config();
const mongoose = require('mongoose');

// Use your existing .env variable (recommended)
const uri =
  'mongodb+srv://partizanhoops:nrMNUpNv7Zavgfak@partizanhoops.9wh96.mongodb.net/partizanhoops?retryWrites=true&w=majority&appName=partizanhoops';

async function cleanParents() {
  try {
    await mongoose.connect(uri, {});
    const db = mongoose.connection.db;
    const parents = db.collection('parents');

    // Fields to remove
    const fieldsToUnset = {
      playersSeason: '',
      playersYear: '',
      paymentComplete: '',
      registrationComplete: '',
    };

    const result = await parents.updateMany({}, { $unset: fieldsToUnset });

    console.log(`✅ Cleanup complete for 'parents' collection!`);
    console.log(`Modified ${result.modifiedCount} documents.`);
  } catch (err) {
    console.error('❌ Error during cleanup:', err);
  } finally {
    await mongoose.disconnect();
  }
}

cleanParents();
