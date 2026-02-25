require('dotenv').config();
const axios = require('axios');

const APP_ID = 'PR8SG1S9G3TK6';
const APP_SECRET = 'fc5fc997-6569-fd1e-1fd8-6f07dc09d785';
const MERCHANT_ID = '329150289992';
const BASE_URL = 'https://sandbox.dev.clover.com'; // switch to production later

async function getAccessToken() {
  const res = await axios.post(
    'https://www.clover.com/oauth/token',
    new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      grant_type: 'client_credentials',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return res.data.access_token;
}

async function testMerchant() {
  const token = await getAccessToken();
  const res = await axios.get(`${BASE_URL}/v3/merchants/${MERCHANT_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(res.data);
}

testMerchant();
