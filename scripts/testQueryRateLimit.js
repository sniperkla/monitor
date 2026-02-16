
async function hammerQueryRateLimit() {
  const url = 'http://localhost:3000/api/connections/test-id/schema';
  
  console.log('🚀 Starting Query Rate Limit Test (hammering /api/connections/[id]/schema)');
  console.log('Expectation: First 120 should be processed, then switched to 429 Too Many Requests.');

  const results = {
    success: 0,
    rateLimited: 0,
    otherError: 0
  };

  const totalRequests = 150;

  for (let i = 1; i <= totalRequests; i++) {
    try {
      const res = await fetch(url, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          connection: { host: 'localhost', port: 27017, dbProvider: 'mongodb' } 
        })
      });
      
      const data = await res.json().catch(() => ({}));
      
      if (res.status === 429) {
        console.log(`[#${i}] 🛡️ 429 Too Many Requests: ${data.error}`);
        results.rateLimited++;
      } else {
        if (i % 20 === 0) console.log(`[#${i}] Response: ${res.status}`);
        results.success++;
      }
    } catch (err) {
      console.log(`[#${i}] ❌ Other error: ${err.message}`);
      results.otherError++;
    }
  }

  console.log('\n📊 Test Summary:');
  console.log(`- Total Requests: ${totalRequests}`);
  console.log(`- Normal Responses (non-429): ${results.success}`);
  console.log(`- Rate Limited (429): ${results.rateLimited}`);
  console.log(`- Other Errors: ${results.otherError}`);

  if (results.rateLimited > 0) {
    console.log('\n✅ Rate Limit Test PASSED: Server correctly rejected high-frequency traffic.');
  } else {
    console.log('\n❌ Rate Limit Test FAILED: Server did not trigger 429.');
  }
}

hammerQueryRateLimit();
