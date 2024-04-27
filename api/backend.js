// Form submission handling
const twilio = require("twilio");

module.exports = async (req, res) => {
  if (req.method === "POST") {
    const { name, email, mobile, service, note } = req.body;
    if (!name || !email || !mobile || !service) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Send SMS notification using Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const client = twilio(accountSid, authToken);

    try {
      const message = await client.messages.create({
        body: `RESEAL CANADA QUOTE REQUEST: \n
        Name: ${name} \n
        Email: ${email} \n
        Phone: ${mobile} \n
        Service: ${service} \n
        Note: ${note || "None provided"}`,
        messagingServiceSid: "MGee1f6ef3f1c345d73bcf6729097705c7",
        to: "+16474718184",
      });

      console.log("SMS sent:", message.sid);
      res.status(200).json({ message: "Quote request submitted successfully!" });
    } catch (error) {
      console.error("Error sending SMS:", error);
      res.status(500).json({ error: "Error sending SMS notification." });
    }
  } else {
    res.status(404).json({ error: "Not found." });
  }
};
