Gmail to SMS Notifier via Twilio

This project provides a Google Apps Script that connects your Gmail account to Twilio. It automatically sends an SMS notification to your phone when you receive an email that matches a specific sender, subject line, or keyword.
This tool is designed for personal use only, allowing you to create a custom notification system for important emails without needing to host your own server.
How It Works & Your Opt-In Consent
This script runs entirely within your own Google Account. You are in complete control of your data and the notifications you receive.
Regarding Twilio's Policies: By following this guide to set up and configure this script with your own phone number, you are providing explicit, direct consent to receive automated SMS messages from your own system. This is a "self-service" notification tool you are building for yourself. This setup is intended for individual use and complies with carrier policies by ensuring you are the sole sender and recipient.

Setup Guide

Follow these five steps to get your notification system running.
Prerequisites
Google Account: Your personal Gmail address.
Twilio Account: A free or paid account at twilio.com.
Twilio Phone Number: A number purchased from your Twilio account that can send SMS messages.
Step 1: Get Your Twilio Credentials
Log in to your Twilio Console and find the following three values. Keep them ready for Step 3.
Account SID: Your unique account identifier.
Auth Token: Your account's secret key.
Twilio Phone Number: The number you purchased from Twilio.
Step 2: Create the Google Apps Script
Go to script.google.com and click New project.
Delete any existing code in the editor.
Copy the code from the Code.gs file in this repository and paste it into the editor.
Step 3: Configure Your Notifier
Here, you will securely store your credentials and define your watchlist using Google's Script Properties.
In the script editor, click Project Settings (⚙️ icon).
Scroll down to Script Properties and click Add script property.
Add the following properties one by one:
Required Credentials:
Property Name
Value to Enter
TWILIO_ACCOUNT_SID
Your Twilio Account SID
TWILIO_AUTH_TOKEN
Your Twilio Auth Token
TWILIO_PHONE_NUMBER
Your Twilio phone number (e.g., +15017122661)
RECIPIENT_PHONE_NUMBER
Your personal cell phone number (e.g., +15558675309)

Your Watchlist (use commas for multiple entries):
Property Name
Example Value
WATCHLIST_EMAILS
alerts@my-saas.com, boss@example.com
WATCHLIST_SUBJECTS
Urgent, Action Required, System Alert
WATCHLIST_KEYWORDS
critical error, system down

Note: You do not need to use all three watchlist options. Leave any unused property value blank.

Step 4: Set the Automatic Trigger
This tells Google to run the script periodically.
Click Triggers (⏰ icon) on the left.
Click Add Trigger and configure it with these exact settings:
Choose which function to run: checkGmailForNotifications
Choose which deployment should run: Head
Select event source: Time-driven
Select type of time based trigger: Minutes timer
Select minute interval: Every 10 minutes
Click Save.

Step 5: Authorize the Script
When you save the trigger, Google will ask for permission.
A new window will appear. Click Review permissions and select your Google account.
You will see a "Google hasn’t verified this app" warning. This is expected. Click Advanced, then click Go to [Your Project Name] (unsafe).

Review the permissions and click Allow.
That's it! Your notifier is now active. To test it, send yourself an email with a subject or keyword from your watchlist. You should receive an SMS within the time interval you set.
