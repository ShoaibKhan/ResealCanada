// Form submission handling
const functions = require("firebase-functions");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const twilio = require("twilio");

// Initialize Twilio client
const client = twilio(functions.config().twilio.account_sid, functions.config().twilio.auth_token);

// Setup Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors({ origin: true })); // Allow all origins

app.post("/submit-quote", async (req, res) => {
  const { name, email, mobile, service, note } = req.body;
  if (!name || !email || !mobile || !service) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    // Send SMS notification using Twilio
    const message = await client.messages.create({
      body: `RESEAL CANADA QUOTE REQUEST: \n
        Name: ${name} \n
        Email: ${email} \n
        Phone: ${mobile} \n
        Service: ${service} \n
        Note: ${note || "None provided"}`,
      messagingServiceSid: "MGee1f6ef3f1c345d73bcf6729097705c7",
      to: "+12505747325",
    });
    console.log("SMS sent:", message.sid);
    res.status(200).json({ message: "Quote request submitted successfully!" });
  } catch (error) {
    console.error("Error sending SMS:", error);
    res.status(500).json({ error: "Error sending SMS notification." });
  }
});

// Export the Express app as a single Cloud Function
exports.api = functions.https.onRequest(app);
