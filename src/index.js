const fs = require('fs')
const path = require('path')
const readline = require('readline')
const opn = require('opn');
const {google} = require('googleapis')
const {OAuth2Client} = require('google-auth-library')
const {flatten, unflatten} = require('flat')
const debug = require('debug')('trans')
const program = require('commander')
const package = require('./../package')
const prettier = require('prettier')
const util = require('util')

program
  .version(package.version, '-v, --version')
  .option('push', 'Push translations')
  .option('pull', 'Pull translations')
  .parse(process.argv)

const APPLICATION_STORE_DIRNAME = '.sheets-translations'
const CLIENT_SECRET_FILENAME = 'client_secret.json'
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const STORE_PATH = path.join(
  (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE),
  APPLICATION_STORE_DIRNAME
)
const TOKEN_PATH = path.join(STORE_PATH, 'sheets.googleapis.com-sheets-translations.json')
const SECRET_FILE_PATH = path.join(STORE_PATH, CLIENT_SECRET_FILENAME)
const MAIN_LANGUAGE = 'en'
const SETTINGS_FILE_NAME = '.translations-settings.json'
const SETTINGS_FILE_PATH = path.resolve(SETTINGS_FILE_NAME)
let OPTIONS = {
  translationsDir: '',
  spreadsheetId: ''
}

/**
 *
 * Setup
 *
 */
readSettings()
  .then(createStore)
  .then(processClientSecrets)
  .then(authorize)
  .then(doAction)
  .catch(error => {
    console.error(error.message || error)
  })

/**
 * Read settings from project's settings file
 */
function readSettings() {
  return new Promise((resolve, reject) => {
    const settings = require(SETTINGS_FILE_PATH)
    const errors = []
    OPTIONS = {
      ...OPTIONS,
      ...settings,
    }
    OPTIONS.translationsDir = path.resolve(OPTIONS.translationsDir)

    if (!OPTIONS.translationsDir) {
      errors.push(`You have to specify translations dir as "translationsDir" property in your project ${SETTINGS_FILE_NAME}`)
    }

    if (!OPTIONS.spreadsheetId) {
      errors.push(`You have to specify spreadsheet id as "spreadsheetId" in your project ${SETTINGS_FILE_NAME}`)
    }

    if (errors.length) {
      reject(new Error(errors.join('\n')))
      return
    }

    resolve()
  })
}

/**
 * Parse client secrets
 */
function processClientSecrets() {
  return new Promise((resolve, reject) => {
    debug('Secret file path: ', SECRET_FILE_PATH)

    fs.readFile(SECRET_FILE_PATH, (err, content) => {
      if (err) {
        reject(`
        You have to download client_secret.json file from Google Developer Console.
        https://console.developers.google.com/apis/credentials
        
        1. Create credentials for "OAuth Client ID".
        2. Select "Other" as application type.
        3. Type application name, ex. Translations CLI
        4. Click "Ok" in popup and download client keys.
        5. Move it to ~/${APPLICATION_STORE_DIRNAME} and rename to "${CLIENT_SECRET_FILENAME}
        `)
        return
      }

      debug('Credentials file content: ', content.toString())
      resolve(JSON.parse(content))
    })
  })
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 */
function authorize(credentialsFile) {
  return new Promise((resolve, reject) => {
    let credentials = credentialsFile.installed || credentialsFile.web
    debug('Credentials: ', credentials)
    const clientId = credentials.client_id
    const clientSecret = credentials.client_secret
    const redirectUrl = credentials.redirect_uris[0]
    const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl)

    fs.readFile(TOKEN_PATH, function (err, token) {
      if (err) {
        getNewToken(oauth2Client)
          .then(resolve)
          .catch(reject)
        return
      } else {
        oauth2Client.credentials = JSON.parse(token)
        resolve(oauth2Client)
      }
    })
  })
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 *     client.
 */
function getNewToken(oauth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    })
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    console.log('Authorize this app by visiting this url: \n', authUrl)
    opn(authUrl);

    rl.question('Enter the code from that page here: ', (code) => {
      rl.close()

      oauth2Client.getToken(code, (err, token) => {
        if (err) {
          reject(err)
          return
        }
        oauth2Client.credentials = token
        storeToken(token)
        resolve(oauth2Client)
      })
    })
  })
}

/**
 * Create application's store
 */
function createStore() {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(STORE_PATH)
    } catch (err) {
      if (err.code !== 'EEXIST') {
        reject(err)
        return
      }
    }

    debug('Store exists at %s', STORE_PATH)
    resolve()
  })
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  fs.writeFile(TOKEN_PATH, JSON.stringify(token))
  console.log('Token stored to ' + TOKEN_PATH)
}


const translations = {}

function doAction(auth) {
  return new Promise((resolve, reject) => {
    let action
    if (program.pull) {
      action = pullTranslations
    } else if (program.push) {
      action = pushTranslations
    } else {
      reject(new Error(`Unknown action`))
      return
    }

    action(auth)
      .then(resolve)
      .catch(reject)
  })
}
/**
 * Print the names and majors of students in a sample spreadsheet:
 * https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 */
function pullTranslations(auth) {
  return new Promise((resolve, reject) => {
    const sheets = google.sheets('v4')
    sheets.spreadsheets.values.get({
      auth: auth,
      spreadsheetId: OPTIONS.spreadsheetId,
      range: 'Sheet1',
    }, (err, response) => {
      if (err) {
        reject(new Error(`The API returned an error: ${err}`))
        return
      }

      debug(response)
      const rows = response.data.values
      const languages = rows.splice(1, 1)[0]
      languages.splice(0, 1)
      rows.splice(0, 1)
      debug('Found languages', languages)

      rows.forEach(row => {
        parseRow(languages, row)
      })

      const flattenTranslations = unflatten(translations)

      Object.keys(flattenTranslations).forEach(language => {
        saveLanguageTranslation(language, flattenTranslations[language])
      })

      resolve()
    })
  })
}

function pushTranslations(auth) {
  return new Promise((resolve, reject) => {
    fs.readdir(OPTIONS.translationsDir, (err, files) => {
      const translations = {}
      debug('Translations files', files)
      files.forEach(file => {
        try {
          const flatTranslation = flatTranslationFile(path.join(OPTIONS.translationsDir, file))
          const language = file.split('.').shift()
          translations[language] = flatTranslation
        } catch(e) {
          reject(e)
          return
        }
      })

      saveToSheets(auth, translations)
        .then(resolve)
        .catch(reject)
    })
  })
}

function flatTranslationFile(filePath) {
  const file = require(filePath)
  return flatten(file)
}

function saveToSheets(auth, translations) {
  return new Promise((resolve, reject) => {
    const sheets = google.sheets('v4')
    const defaultKeyNames = Object.keys(translations[MAIN_LANGUAGE])
    const keyNames = ['Key Name', ...defaultKeyNames]
    const languages = Object.keys(translations)
    const orderedLanguages = [MAIN_LANGUAGE, ...languages.filter(language => language !== MAIN_LANGUAGE)]
    const preparedTranslations = orderedLanguages
      .map(language => rewriteLanguage(translations, language, defaultKeyNames)
      )
    const values = [ keyNames, ...preparedTranslations]
    sheets.spreadsheets.values.update({
      auth: auth,
      spreadsheetId: OPTIONS.spreadsheetId,
      valueInputOption: 'USER_ENTERED',
      range: 'A2',
      resource: {
        majorDimension: 'COLUMNS',
        values
      }
    }, (err, response) => {
      if (err) {
        reject(new Error(`The API returned an error: ${err}`))
        return
      }
      console.log('Languages %s pushed to Google Sheets document', orderedLanguages.join(', '))
      resolve()
    })
  })
}

function rewriteLanguage(translations, language, defaultKeyNames) {
  return [language, ...defaultKeyNames.map(key => translations[language][key] || '')]
}


function parseRow(languages, row) {
  const translationKey = row.splice(0, 1)[0]
  row.forEach((row, i) => {
    const language = languages[i]
    if (!translations[language]) {
      translations[language] = {}
    }

    translations[language][translationKey] = row
  })
}

async function saveLanguageTranslation(language, languageObject) {
  const filePath = path.join(OPTIONS.translationsDir, `${language}.js`)
  const preparedLanguage = util.inspect(languageObject, { depth: null })
  const content = `module.exports = ${preparedLanguage}`
  debug('file path', filePath)
  debug('prepared language', preparedLanguage)

  await fs.writeFile(filePath, prettier.format(content, {
    singleQuote: true,
    semi: false,
  }), (err) => {
    if (err) throw err
    console.log(`Language ${language} file has been saved!`)
  })
}