/**
 * Gmail Twilio Alert Automation
 * 
 * A modular system to monitor Gmail for specific keywords or senders
 * and send alerts via Discord or Twilio.
 * 
 * @OnlyCurrentDoc
 */

// Required Gmail API scopes
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/script.external_request'
];

// Configuration object - will be populated from user properties
let CONFIG = {};

/**
 * Shows a configuration sidebar in Gmail or Drive
 */
function onOpen() {
  // Try to get the appropriate UI based on context
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    try {
      ui = DocumentApp.getUi();
    } catch (e2) {
      // Fallback - this might be running in a different context
      return;
    }
  }
  
  ui.createMenu('Gmail Alerts')
    .addItem('Configure', 'showConfigSidebar')
    .addItem('Run Now', 'processEmails')
    .addToUi();
}

/**
 * Shows the configuration sidebar
 */
function showConfigSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('ConfigSidebar')
    .setTitle('Gmail Alert Configuration')
    .setWidth(400);
  
  // Try to get the appropriate UI based on context
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    try {
      ui = DocumentApp.getUi();
    } catch (e2) {
      // Fallback to Apps Script UI
      ui = HtmlService.createHtmlOutput(html.getContent());
      return;
    }
  }
  
  ui.showSidebar(html);
}

/**
 * Saves user configuration to script properties
 * @param {Object} config - Configuration object with user settings
 */
function saveConfig(config) {
  const scriptProperties = PropertiesService.getUserProperties();
  
  // Validate and save config
  try {
    // Store each property individually
    scriptProperties.setProperty('keywords', JSON.stringify(config.keywords || []));
    scriptProperties.setProperty('senders', JSON.stringify(config.senders || []));
    scriptProperties.setProperty('alertType', config.alertType || 'none');
    scriptProperties.setProperty('alertTypes', JSON.stringify(config.alertTypes || []));
    
    // Store service-specific configurations
    if (config.alertTypes && config.alertTypes.includes('discord')) {
      scriptProperties.setProperty('discordWebhookUrl', config.discordWebhookUrl || '');
    }
    if (config.alertTypes && config.alertTypes.includes('twilio')) {
      scriptProperties.setProperty('twilioAccountSid', config.twilioAccountSid || '');
      scriptProperties.setProperty('twilioAuthToken', config.twilioAuthToken || '');
      scriptProperties.setProperty('twilioFromNumber', config.twilioFromNumber || '');
      scriptProperties.setProperty('twilioToNumber', config.twilioToNumber || '');
    }
    
    // Backward compatibility: if alertType is set but alertTypes is not, use alertType
    if (!config.alertTypes && config.alertType && config.alertType !== 'none') {
      scriptProperties.setProperty('alertTypes', JSON.stringify([config.alertType]));
      if (config.alertType === 'discord') {
        scriptProperties.setProperty('discordWebhookUrl', config.discordWebhookUrl || '');
      } else if (config.alertType === 'twilio') {
        scriptProperties.setProperty('twilioAccountSid', config.twilioAccountSid || '');
        scriptProperties.setProperty('twilioAuthToken', config.twilioAuthToken || '');
        scriptProperties.setProperty('twilioFromNumber', config.twilioFromNumber || '');
        scriptProperties.setProperty('twilioToNumber', config.twilioToNumber || '');
      }
    }
    
    // Store general settings
    scriptProperties.setProperty('checkFrequency', config.checkFrequency || 5);
    
    // Only update lastCheckedTime if it's explicitly provided in config
    // This prevents resetting the timestamp when just updating keywords/senders
    if (config.lastCheckedTime !== undefined) {
      scriptProperties.setProperty('lastCheckedTime', config.lastCheckedTime);
    }
    
    return { success: true, message: 'Configuration saved successfully!' };
  } catch (error) {
    return { success: false, message: 'Error saving configuration: ' + error.toString() };
  }
}

/**
 * Loads configuration from script properties
 * @return {Object} The configuration object
 */
function loadConfig() {
  Logger.log('Loading configuration from script properties...');
  const scriptProperties = PropertiesService.getUserProperties();
  
  try {
    CONFIG = {
      keywords: JSON.parse(scriptProperties.getProperty('keywords') || '[]'),
      senders: JSON.parse(scriptProperties.getProperty('senders') || '[]'),
      alertType: scriptProperties.getProperty('alertType') || 'none',
      alertTypes: JSON.parse(scriptProperties.getProperty('alertTypes') || '[]'),
      discordWebhookUrl: scriptProperties.getProperty('discordWebhookUrl') || '',
      twilioAccountSid: scriptProperties.getProperty('twilioAccountSid') || '',
      twilioAuthToken: scriptProperties.getProperty('twilioAuthToken') || '',
      twilioFromNumber: scriptProperties.getProperty('twilioFromNumber') || '',
      twilioToNumber: scriptProperties.getProperty('twilioToNumber') || '',
      checkFrequency: parseInt(scriptProperties.getProperty('checkFrequency') || '5', 10),
      lastCheckedTime: scriptProperties.getProperty('lastCheckedTime') || '0'
    };
    
    // Backward compatibility: if alertTypes is empty but alertType is set, use alertType
    if (CONFIG.alertTypes.length === 0 && CONFIG.alertType !== 'none') {
      CONFIG.alertTypes = [CONFIG.alertType];
    }
    
    Logger.log('Configuration loaded successfully');
    Logger.log('Alert type: ' + CONFIG.alertType);
    Logger.log('Keywords count: ' + CONFIG.keywords.length);
    Logger.log('Senders count: ' + CONFIG.senders.length);
    Logger.log('Last checked time: ' + CONFIG.lastCheckedTime + ' (' + new Date(parseInt(CONFIG.lastCheckedTime || '0')).toISOString() + ')');
    
    return CONFIG;
  } catch (error) {
    Logger.log('Error loading configuration: ' + error.toString());
    return {};
  }
}

/**
 * Creates a Gmail search query based on user configuration
 * @return {string} Gmail search query
 */
function buildGmailQuery() {
  loadConfig();
  const query = [];
  
  // Add keyword search terms for subject
  if (CONFIG.keywords && CONFIG.keywords.length > 0) {
    const keywordQueries = CONFIG.keywords.map(keyword => `subject:"${keyword}"`);
    query.push(`(${keywordQueries.join(' OR ')})`); 
  }
  
  // Add sender filters
  if (CONFIG.senders && CONFIG.senders.length > 0) {
    const senderQueries = CONFIG.senders.map(sender => `from:(${sender})`);
    if (query.length > 0) {
      query.push('OR');
    }
    query.push(`(${senderQueries.join(' OR ')})`); 
  }
  
  // Only get unread messages newer than the last check time
  const lastCheckedTime = parseInt(CONFIG.lastCheckedTime, 10);
  if (lastCheckedTime > 0) {
    // Use Gmail's date format (YYYY/MM/DD) but subtract a small buffer to avoid missing emails
    const lastDate = new Date(lastCheckedTime - 60000); // 1 minute buffer
    const year = lastDate.getFullYear();
    const month = String(lastDate.getMonth() + 1).padStart(2, '0');
    const day = String(lastDate.getDate()).padStart(2, '0');
    query.push(`after:${year}/${month}/${day}`);
    Logger.log(`Searching for emails after: ${year}/${month}/${day} (with 1min buffer)`);
  } else {
    // If no last check time, look for emails from the last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const year = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day = String(yesterday.getDate()).padStart(2, '0');
    query.push(`after:${year}/${month}/${day}`);
    Logger.log(`First run - searching for emails after: ${year}/${month}/${day} (last 24 hours)`);
  }
  
  query.push('is:unread');
  
  return query.join(' ');
}

/**
 * Main function to process emails and send alerts
 */
function processEmails() {
  Logger.log('=== STARTING EMAIL PROCESSING ===');
  try {
    Logger.log('Loading configuration...');
    loadConfig();
    Logger.log('Configuration loaded: ' + JSON.stringify(CONFIG, null, 2));
    
    // Check if configured
    Logger.log('Checking if configuration is valid...');
    if (!isConfigValid()) {
      Logger.log('Configuration validation failed');
      Logger.log('Keywords: ' + JSON.stringify(CONFIG.keywords));
      Logger.log('Senders: ' + JSON.stringify(CONFIG.senders));
      Logger.log('Alert Type: ' + CONFIG.alertType);
      throw new Error('Configuration is not valid. Please check your settings.');
    }
    Logger.log('Configuration is valid');
    
    const query = buildGmailQuery();
    Logger.log('Gmail search query: ' + query);
    
    Logger.log('Searching Gmail for matching threads...');
    const threads = GmailApp.search(query, 0, 100); // Limit to 100 threads for performance
    Logger.log(`Found ${threads.length} matching threads`);
    
    // Get previously alerted message IDs to avoid duplicates
    const scriptProperties = PropertiesService.getUserProperties();
    let alertedMessageIds = JSON.parse(scriptProperties.getProperty('alertedMessageIds') || '[]');
    
    // Legacy migration: if we have old threadIds but no messageIds, clear the old data
    const oldThreadIds = scriptProperties.getProperty('alertedThreadIds');
    if (oldThreadIds && alertedMessageIds.length === 0) {
      Logger.log('Migrating from thread-based to message-based tracking - clearing old data');
      scriptProperties.deleteProperty('alertedThreadIds');
    }
    
    Logger.log(`Previously alerted messages: ${alertedMessageIds.length}`);
    
    const alertMessages = [];
    const newAlertedMessageIds = [];
    
    // Process each thread
    Logger.log('Processing threads...');
    threads.forEach((thread, index) => {
      Logger.log(`Processing thread ${index + 1}/${threads.length}`);
      const threadId = thread.getId();
      const messages = thread.getMessages();
      const lastMessage = messages[messages.length - 1];
      const lastMessageId = lastMessage.getId();
      
      // Skip if we've already alerted about this specific message
      if (alertedMessageIds.includes(lastMessageId)) {
        Logger.log(`  Skipping message ${lastMessageId} in thread ${threadId} - already alerted`);
        return;
      }
      
      const subject = thread.getFirstMessageSubject();
      const sender = lastMessage.getFrom();
      const snippet = lastMessage.getPlainBody().substring(0, 200); 
      
      Logger.log(`  NEW MESSAGE - Subject: ${subject}`);
      Logger.log(`  Sender: ${sender}`);
      Logger.log(`  Date: ${thread.getLastMessageDate()}`);
      Logger.log(`  Thread ID: ${threadId}`);
      Logger.log(`  Message ID: ${lastMessageId}`);
      
      // Add to alert messages
      alertMessages.push({
        subject: subject,
        sender: sender,
        snippet: snippet,
        date: thread.getLastMessageDate(),
        threadId: threadId,
        messageId: lastMessageId
      });
      
      // Track this message ID
      newAlertedMessageIds.push(lastMessageId);
    });
    
    Logger.log(`Prepared ${alertMessages.length} messages for alerting`);
    
    // Send alerts if there are any messages to notify about
    if (alertMessages.length > 0) {
      Logger.log('Sending alerts...');
      sendAlerts(alertMessages);
      Logger.log(`Successfully processed ${alertMessages.length} emails`);
    } else {
      Logger.log('No matching emails found - no alerts to send');
    }
    
    // Update the last checked time and alerted thread IDs
    Logger.log('Updating last checked time and thread tracking...');
    const newTime = Date.now().toString();
    scriptProperties.setProperty('lastCheckedTime', newTime);
    Logger.log('Last checked time updated to: ' + new Date(parseInt(newTime)).toISOString());
    
    // Update the list of alerted message IDs (keep last 1000 to prevent infinite growth)
    const updatedAlertedMessageIds = [...alertedMessageIds, ...newAlertedMessageIds].slice(-1000);
    scriptProperties.setProperty('alertedMessageIds', JSON.stringify(updatedAlertedMessageIds));
    Logger.log(`Updated alerted message IDs list: ${updatedAlertedMessageIds.length} total messages tracked`);
    
    Logger.log('=== EMAIL PROCESSING COMPLETED ===');
    return alertMessages.length;
  } catch (error) {
    Logger.log('=== ERROR IN EMAIL PROCESSING ===');
    Logger.log('Error: ' + error.toString());
    Logger.log('Stack: ' + error.stack);
    throw error;
  }
}

/**
 * Checks if the current configuration is valid for alert processing
 * @return {boolean} True if configuration is valid
 */
function isConfigValid() {
  Logger.log('Validating configuration...');
  
  // Need at least one keyword or sender, and a configured alert method
  const hasKeywords = CONFIG.keywords && CONFIG.keywords.length > 0;
  const hasSenders = CONFIG.senders && CONFIG.senders.length > 0;
  const hasSearchCriteria = hasKeywords || hasSenders;
  
  Logger.log('Has keywords: ' + hasKeywords + ' (count: ' + (CONFIG.keywords?.length || 0) + ')');
  Logger.log('Has senders: ' + hasSenders + ' (count: ' + (CONFIG.senders?.length || 0) + ')');
  Logger.log('Has search criteria: ' + hasSearchCriteria);
    
  // Check if the selected alert method is properly configured
  let alertMethodConfigured = false;
  
  Logger.log('Alert types: ' + JSON.stringify(CONFIG.alertTypes));
  Logger.log('Legacy alert type: ' + CONFIG.alertType);
  
  // Check if at least one alert method is properly configured
  let discordConfigured = false;
  let twilioConfigured = false;
  
  if (CONFIG.alertTypes.includes('discord')) {
    discordConfigured = Boolean(CONFIG.discordWebhookUrl);
    Logger.log('Discord webhook configured: ' + discordConfigured);
  }
  
  if (CONFIG.alertTypes.includes('twilio')) {
    const hasSid = Boolean(CONFIG.twilioAccountSid);
    const hasToken = Boolean(CONFIG.twilioAuthToken);
    const hasFromNumber = Boolean(CONFIG.twilioFromNumber);
    const hasToNumber = Boolean(CONFIG.twilioToNumber);
    
    Logger.log('Twilio Account SID: ' + hasSid);
    Logger.log('Twilio Auth Token: ' + hasToken);
    Logger.log('Twilio From Number: ' + hasFromNumber + ' (' + CONFIG.twilioFromNumber + ')');
    Logger.log('Twilio To Number: ' + hasToNumber + ' (' + CONFIG.twilioToNumber + ')');
    
    twilioConfigured = hasSid && hasToken && hasFromNumber && hasToNumber;
    Logger.log('Twilio fully configured: ' + twilioConfigured);
  }
  
  alertMethodConfigured = discordConfigured || twilioConfigured;
  
  if (CONFIG.alertTypes.length === 0) {
    Logger.log('No alert types selected');
  }
  
  const isValid = hasSearchCriteria && alertMethodConfigured;
  Logger.log('Configuration is valid: ' + isValid);
  
  return isValid;
}

/**
 * Sends alerts through the configured channel
 * @param {Array} messages - Array of email message objects to notify about
 */
function sendAlerts(messages) {
  if (!messages || messages.length === 0) {
    Logger.log('No messages to send alerts for');
    return;
  }
  
  Logger.log(`Sending alerts for ${messages.length} messages via: ${JSON.stringify(CONFIG.alertTypes)}`);
  
  // Send to all configured alert methods
  if (CONFIG.alertTypes.includes('discord')) {
    Logger.log('Sending Discord alert...');
    sendDiscordAlert(messages);
  }
  
  if (CONFIG.alertTypes.includes('twilio')) {
    Logger.log('Sending Twilio SMS alert...');
    sendTwilioAlert(messages);
  }
  
  if (CONFIG.alertTypes.length === 0) {
    Logger.log('No alert methods configured');
  }
}

/**
 * Sends alerts to Discord using webhook
 * @param {Array} messages - Array of email message objects to notify about
 */
function sendDiscordAlert(messages) {
  if (!CONFIG.discordWebhookUrl) return;
  
  // Create Discord message content
  const embeds = messages.map(message => {
    return {
      title: `New Email: ${message.subject}`,
      description: `From: ${message.sender}\n\n${message.snippet}`,
      color: 5814783, // Blue color
      timestamp: message.date.toISOString()
    };
  });
  
  const payload = {
    content: `📬 You have ${messages.length} new important email(s)`,
    embeds: embeds.slice(0, 10) // Discord limits to 10 embeds per message
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };
  
  try {
    UrlFetchApp.fetch(CONFIG.discordWebhookUrl, options);
    Logger.log(`Successfully sent Discord alert for ${messages.length} emails`);
  } catch (error) {
    Logger.log('Error sending Discord alert: ' + error.toString());
  }
}

/**
 * Sends alerts via Twilio SMS
 * @param {Array} messages - Array of email message objects to notify about
 */
function sendTwilioAlert(messages) {
  if (!CONFIG.twilioAccountSid || !CONFIG.twilioAuthToken || 
      !CONFIG.twilioFromNumber || !CONFIG.twilioToNumber) {
    Logger.log('Missing Twilio configuration');
    return;
  }
  
  Logger.log(`Attempting to send Twilio SMS to ${CONFIG.twilioToNumber}`);
  
  // Format the message
  const smsBody = `📬 You have ${messages.length} new important email(s):\n\n` + 
    messages.slice(0, 3).map(message => {
      return `From: ${message.sender}\nSubject: ${message.subject}`;
    }).join('\n\n');
  
  // Additional emails notice if there are more than 3
  const additionalMsg = messages.length > 3 ? 
    `\n\n+${messages.length - 3} more emails...` : '';
  
  const finalBody = smsBody + additionalMsg;
  
  // Prepare the Twilio API request
  const twilioApiUrl = `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.twilioAccountSid}/Messages.json`;
  
  const payload = {
    To: CONFIG.twilioToNumber,
    From: CONFIG.twilioFromNumber,
    Body: finalBody
  };
  
  const options = {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(CONFIG.twilioAccountSid + ':' + CONFIG.twilioAuthToken),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: Object.keys(payload).map(key => `${key}=${encodeURIComponent(payload[key])}`).join('&')
  };
  
  try {
    Logger.log(`Sending SMS with body: ${finalBody.substring(0, 100)}...`);
    const response = UrlFetchApp.fetch(twilioApiUrl, options);
    const responseText = response.getContentText();
    const responseCode = response.getResponseCode();
    
    Logger.log(`Twilio API Response Code: ${responseCode}`);
    Logger.log(`Twilio API Response: ${responseText}`);
    
    if (responseCode === 201) {
      Logger.log(`Successfully sent Twilio alert for ${messages.length} emails`);
    } else {
      Logger.log(`Twilio API error: ${responseCode} - ${responseText}`);
    }
  } catch (error) {
    Logger.log('Error sending Twilio alert: ' + error.toString());
    Logger.log('Stack trace: ' + error.stack);
  }
}

/**
 * Sets up a time-based trigger to run the email check automatically
 */
function setupTrigger() {
  try {
    // Clear existing triggers
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processEmails') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    
    loadConfig();
    const frequency = CONFIG.checkFrequency || 5;
    
    // Validate frequency is within allowed range (1-60 minutes)
    if (frequency < 1 || frequency > 60) {
      throw new Error('Check frequency must be between 1 and 60 minutes');
    }
    
    // Create new trigger
    ScriptApp.newTrigger('processEmails')
      .timeBased()
      .everyMinutes(frequency)
      .create();
      
    Logger.log(`Trigger set to check emails every ${frequency} minutes`);
    return `Trigger set to check emails every ${frequency} minutes`;
  } catch (error) {
    Logger.log('Error setting up trigger: ' + error.toString());
    throw error;
  }
}

/**
 * Test function to verify configuration
 */
function testConfiguration() {
  const config = loadConfig();
  return {
    configLoaded: Object.keys(config).length > 0,
    alertType: config.alertType,
    keywordsCount: (config.keywords || []).length,
    sendersCount: (config.senders || []).length,
    checkFrequency: config.checkFrequency,
    isValid: isConfigValid(),
    query: buildGmailQuery()
  };
}

/**
 * Debug function to test email processing without sending alerts
 */
function debugEmailCheck() {
  try {
    loadConfig();
    
    if (!isConfigValid()) {
      return {
        error: 'Configuration is not valid. Please check your settings.',
        config: CONFIG
      };
    }
    
    const query = buildGmailQuery();
    Logger.log('Gmail query: ' + query);
    
    const threads = GmailApp.search(query, 0, 10); // Limit to 10 for debugging
    const emailInfo = threads.map(thread => ({
      subject: thread.getFirstMessageSubject(),
      sender: thread.getMessages()[0].getFrom(),
      date: thread.getLastMessageDate(),
      threadId: thread.getId()
    }));
    
    return {
      query: query,
      threadsFound: threads.length,
      emails: emailInfo,
      config: {
        keywords: CONFIG.keywords,
        senders: CONFIG.senders,
        alertType: CONFIG.alertType,
        lastCheckedTime: CONFIG.lastCheckedTime
      }
    };
  } catch (error) {
    return {
      error: error.toString(),
      config: CONFIG
    };
  }
}

/**
 * Test function to send a test SMS via Twilio - call this manually to test
 */
function testTwilioSMS() {
  Logger.log('=== TESTING TWILIO SMS ===');
  try {
    loadConfig();
    
    if (!CONFIG.twilioAccountSid || !CONFIG.twilioAuthToken || 
        !CONFIG.twilioFromNumber || !CONFIG.twilioToNumber) {
      Logger.log('Missing Twilio configuration');
      return false;
    }
    
    // Send test message
    const testMessage = [{
      subject: 'Test Email Alert',
      sender: 'test@example.com',
      snippet: 'This is a test message to verify your Twilio SMS configuration is working.',
      date: new Date(),
      threadId: 'test123'
    }];
    
    Logger.log('Sending test SMS...');
    sendTwilioAlert(testMessage);
    Logger.log('Test SMS function completed - check logs above for results');
    return true;
  } catch (error) {
    Logger.log('Error in testTwilioSMS: ' + error.toString());
    return false;
  }
}

/**
 * Clear the alert history - useful if you want to re-alert about old emails
 * Call this manually if needed
 */
function clearAlertHistory() {
  Logger.log('=== CLEARING ALERT HISTORY ===');
  try {
    const scriptProperties = PropertiesService.getUserProperties();
    const alertedMessageIds = JSON.parse(scriptProperties.getProperty('alertedMessageIds') || '[]');
    
    Logger.log(`Clearing ${alertedMessageIds.length} previously alerted message IDs`);
    scriptProperties.setProperty('alertedMessageIds', '[]');
    scriptProperties.deleteProperty('alertedThreadIds'); // Clear legacy data too
    scriptProperties.setProperty('lastCheckedTime', '0');
    
    Logger.log('Alert history cleared - next run will check all recent emails');
    return true;
  } catch (error) {
    Logger.log('Error clearing alert history: ' + error.toString());
    return false;
  }
}