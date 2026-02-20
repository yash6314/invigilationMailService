const axios = require("axios");

const tenantId = process.env.TENANT_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const sender = process.env.MAIL_USER;

async function getAccessToken() {
  try {
    console.log("Getting access token...");

    const response = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    console.log("Token received ✅");
    return response.data.access_token;
  } catch (error) {
    console.error("TOKEN ERROR:", error.response?.data || error.message);
    process.exit(1);
  }
}

async function sendMail() {
  try {
    const accessToken = await getAccessToken();

    console.log("Sending mail...");

    const response = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${sender}/sendMail`,
      {
        message: {
          subject: "Test Email from QTap",
          body: {
            contentType: "HTML",
            content: "<b>This is a test email from QTap system</b>",
          },
          toRecipients: [
            {
              emailAddress: {
                address: "yashwanth.somalaraju@duodecimal.in",
              },
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Graph Response Status:", response.status);
    console.log("Email sent successfully ✅");
  } catch (error) {
    console.error("MAIL ERROR:", error.response?.data || error.message);
  }
}

sendMail();
