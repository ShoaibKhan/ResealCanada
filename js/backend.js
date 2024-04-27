// Form submission handling
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = 3000;
app.use(cors());

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

app.post("/submit-quote", (req, res) => {
  const { name, email, mobile, service, note } = req.body;
  if (!name || !email || !mobile || !service) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Send SMS notification using Twilio
  client.messages
    .create({
      body: `RESEAL CANADA QUOTE REQUEST: \n
      Name: ${name} \n
      Email: ${email} \n
      Phone: ${mobile} \n
      Service: ${service} \n
      Note: ${note || 'None provided'}`,
      messagingServiceSid: 'MGee1f6ef3f1c345d73bcf6729097705c7',
      to: "+16474718184",
    })
    .then((message) => {
      console.log("SMS sent:", message.sid);
      res.status(200).json({ message: "Quote request submitted successfully!" });
    })
    .catch((error) => {
      console.error("Error sending SMS:", error);
      res.status(500).json({ error: "Error sending SMS notification." });
    });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
