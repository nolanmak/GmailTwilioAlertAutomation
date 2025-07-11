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
 * Shows a configuration sidebar in Gmail
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Gmail Alerts')
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
  SpreadsheetApp.getUi().showSidebar(html);
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
    
    // Store service-specific configurations
    if (config.alertType === 'discord') {
      scriptProperties.setProperty('discordWebhookUrl', config.discordWebhookUrl || '');
    } else if (config.alertType === 'twilio') {
      scriptProperties.setProperty('twilioAccountSid', config.twilioAccountSid || '');
      scriptProperties.setProperty('twilioAuthToken', config.twilioAuthToken || '');
      scriptProperties.setProperty('twilioFromNumber', config.twilioFromNumber || '');
      scriptProperties.setProperty('twilioToNumber', config.twilioToNumber || '');
    }
    
    // Store general settings
    scriptProperties.setProperty('checkFrequency', config.checkFrequency || 5);
    scriptProperties.setProperty('lastCheckedTime', config.lastCheckedTime || '0');
    
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
  const scriptProperties = PropertiesService.getUserProperties();
  
  try {
    CONFIG = {
      keywords: JSON.parse(scriptProperties.getProperty('keywords') || '[]'),
      senders: JSON.parse(scriptProperties.getProperty('senders') || '[]'),
      alertType: scriptProperties.getProperty('alertType') || 'none',
      discordWebhookUrl: scriptProperties.getProperty('discordWebhookUrl') || '',
      twilioAccountSid: scriptProperties.getProperty('twilioAccountSid') || '',
      twilioAuthToken: scriptProperties.getProperty('twilioAuthToken') || '',
      twilioFromNumber: scriptProperties.getProperty('twilioFromNumber') || '',
      twilioToNumber: scriptProperties.getProperty('twilioToNumber') || '',
      checkFrequency: parseInt(scriptProperties.getProperty('checkFrequency') || '5', 10),
      lastCheckedTime: scriptProperties.getProperty('lastCheckedTime') || '0'
    };
    
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
  const lastCheckedTime = new Date(parseInt(CONFIG.lastCheckedTime, 10));
  query.push(`after:${lastCheckedTime.toISOString()}`);
  query.push('is:unread');
  
  return query.join(' ');
}

/**
 * Main function to process emails and send alerts
 */
function processEmails() {
  loadConfig();
  
  // Check if configured
  if (!isConfigValid()) {
    Logger.log('Configuration is not valid or complete');
    return;
  }
  
  const query = buildGmailQuery();
  const threads = GmailApp.search(query, 0, 100); // Limit to 100 threads for performance
  const alertMessages = [];
  
  // Process each thread
  threads.forEach(thread => {
    const subject = thread.getFirstMessageSubject();
    const sender = thread.getMessages()[0].getFrom();
    const snippet = thread.getMessages()[0].getPlainBody().substring(0, 200); 
    
    // Add to alert messages
    alertMessages.push({
      subject: subject,
      sender: sender,
      snippet: snippet,
      date: thread.getLastMessageDate(),
      threadId: thread.getId()
    });
  });
  
  // Send alerts if there are any messages to notify about
  if (alertMessages.length > 0) {
    sendAlerts(alertMessages);
  }
  
  // Update the last checked time
  const scriptProperties = PropertiesService.getUserProperties();
  scriptProperties.setProperty('lastCheckedTime', Date.now().toString());
  
  return alertMessages.length;
}

/**
 * Checks if the current configuration is valid for alert processing
 * @return {boolean} True if configuration is valid
 */
function isConfigValid() {
  // Need at least one keyword or sender, and a configured alert method
  const hasSearchCriteria = 
    (CONFIG.keywords && CONFIG.keywords.length > 0) || 
    (CONFIG.senders && CONFIG.senders.length > 0);
    
  // Check if the selected alert method is properly configured
  let alertMethodConfigured = false;
  
  if (CONFIG.alertType === 'discord') {
    alertMethodConfigured = Boolean(CONFIG.discordWebhookUrl);
  } else if (CONFIG.alertType === 'twilio') {
    alertMethodConfigured = Boolean(
      CONFIG.twilioAccountSid && 
      CONFIG.twilioAuthToken && 
      CONFIG.twilioFromNumber && 
      CONFIG.twilioToNumber
    );
  }
  
  return hasSearchCriteria && alertMethodConfigured;
}

/**
 * Sends alerts through the configured channel
 * @param {Array} messages - Array of email message objects to notify about
 */
function sendAlerts(messages) {
  if (!messages || messages.length === 0) return;
  
  if (CONFIG.alertType === 'discord') {
    sendDiscordAlert(messages);
  } else if (CONFIG.alertType === 'twilio') {
    sendTwilioAlert(messages);
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
    return;
  }
  
  // Format the message
  const smsBody = `📬 You have ${messages.length} new important email(s):\n\n` + 
    messages.slice(0, 3).map(message => {
      return `From: ${message.sender}\nSubject: ${message.subject}`;
    }).join('\n\n');
  
  // Additional emails notice if there are more than 3
  const additionalMsg = messages.length > 3 ? 
    `\n\n+${messages.length - 3} more emails...` : '';
  
  // Prepare the Twilio API request
  const twilioApiUrl = `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.twilioAccountSid}/Messages.json`;
  
  const payload = {
    To: CONFIG.twilioToNumber,
    From: CONFIG.twilioFromNumber,
    Body: smsBody + additionalMsg
  };
  
  const options = {
    method: 'post',
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.twilioAccountSid + ':' + CONFIG.twilioAuthToken)
    },
    payload: payload
  };
  
  try {
    UrlFetchApp.fetch(twilioApiUrl, options);
    Logger.log(`Successfully sent Twilio alert for ${messages.length} emails`);
  } catch (error) {
    Logger.log('Error sending Twilio alert: ' + error.toString());
  }
}

/**
 * Sets up a time-based trigger to run the email check automatically
 */
function setupTrigger() {
  // Clear existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  loadConfig();
  const frequency = CONFIG.checkFrequency || 5;
  
  // Create new trigger
  ScriptApp.newTrigger('processEmails')
    .timeBased()
    .everyMinutes(frequency)
    .create();
    
  return `Trigger set to check emails every ${frequency} minutes`;
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
    checkFrequency: config.checkFrequency
  };
}