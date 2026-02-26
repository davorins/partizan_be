// scripts/fixCoachRoles.js
const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

const fixCoachRoles = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');

    // Find all users who are coaches but have role 'user'
    const result = await mongoose.connection.collection('parents').updateMany(
      {
        isCoach: true,
        role: 'user',
      },
      {
        $set: { role: 'coach' },
      },
    );

    console.log(
      `✅ Updated ${result.modifiedCount} users from 'user' to 'coach' role`,
    );

    // Also check for users with role 'coach' but isCoach false (inconsistent)
    const inconsistent = await mongoose.connection
      .collection('parents')
      .updateMany(
        {
          role: 'coach',
          isCoach: { $ne: true },
        },
        {
          $set: { isCoach: true },
        },
      );

    console.log(
      `✅ Fixed ${inconsistent.modifiedCount} inconsistent coach records`,
    );

    // Show counts by role
    const counts = await mongoose.connection
      .collection('parents')
      .aggregate([
        {
          $group: {
            _id: { role: '$role', isCoach: '$isCoach' },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    console.log('\n📊 User counts after update:');
    counts.forEach((item) => {
      console.log(
        `  Role: ${item._id.role}, isCoach: ${item._id.isCoach}, Count: ${item.count}`,
      );
    });
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from database');
  }
};

fixCoachRoles();
