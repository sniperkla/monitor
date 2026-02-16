
async function hammerRateLimit() {
  const url = 'http://localhost:3000/api/connections/test-id/test';
  const payload = { 
    id: 'test-id', 
    connection: { type: 'database', dbProvider: 'mongodb' } 
  };

  console.log('🚀 Starting Rate Limit Test (hammering /api/connections/[id]/test)');
  console.log('Expectation: First 20 should be processed (likely failing connection but returning 200/404/500), then switched to 429 Too Many Requests.');

  const results = {
    success: 0,
    rateLimited: 0,
    otherError: 0
  };

  for (let i = 1; i <= 30; i++) {
    try {
      const res = await fetch(url, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json().catch(() => ({}));
      
      if (res.status === 429) {
        console.log(`[#${i}] 🛡️ 429 Too Many Requests: ${data.error}`);
        results.rateLimited++;
      } else {
        console.log(`[#${i}] Response: ${res.status}`);
        results.success++;
      }
    } catch (err) {
      console.log(`[#${i}] ❌ Other error: ${err.message}`);
      results.otherError++;
    }
  }

  console.log('\n📊 Test Summary:');
  console.log(`- Total Requests: 30`);
  console.log(`- Normal Responses (non-429): ${results.success}`);
  console.log(`- Rate Limited (429): ${results.rateLimited}`);
  console.log(`- Other Errors: ${results.otherError}`);

  if (results.rateLimited > 0) {
    console.log('\n✅ Rate Limit Test PASSED: Server correctly rejected burst traffic.');
  } else {
    console.log('\n❌ Rate Limit Test FAILED: Server did not trigger 429.');
  }
}

hammerRateLimit();
