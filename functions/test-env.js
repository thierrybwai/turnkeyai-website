// Debug function to check environment variables
exports.handler = async (event) => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      apiKey: apiKey ? "✓ SET" : "✗ NOT SET",
      senderEmail: senderEmail || "default@turnkeyai.com.au",
      envKeys: Object.keys(process.env).filter(k => k.includes('BREVO') || k.includes('SENDER'))
    })
  };
};
