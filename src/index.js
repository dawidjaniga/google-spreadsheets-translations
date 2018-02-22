const fs = require('fs')
const path = require('path')
const readline = require('readline')
const {google} = require('googleapis')
const {OAuth2Client} = require('google-auth-library')
const {unflatten} = require('flat')
const debug = require('debug')('trans')
const program = require('commander')

program
  .version('0.1.0')
  .option('push', 'Push translations')
  .option('pull', 'Pull translations')
  .option('-d, --dir []', 'Translations dir')
  .parse(process.argv)

const APPLICATION_STORE_DIRNAME = '.sheets-translations'
const CLIENT_SECRET_FILENAME = 'client_secret.json'
const TRANSLATIONS_DIR = program.dir
const SPREADSHEET_ID = '1d5SMBsu_a5CtjfK2cvdzPn-w1ONwhMFvDY11--ZfA-s'
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
const STORE_PATH = path.join(
  (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE),
  APPLICATION_STORE_DIRNAME
)
const TOKEN_PATH = path.join(STORE_PATH, 'sheets.googleapis.com-nodejs-quickstart.json')
const SECRET_FILE_PATH = path.join(STORE_PATH, CLIENT_SECRET_FILENAME)

/**
 *
 * Setup
 *
 */
checkParams()
  .then(createStore)
  .then(processClientSecrets)
  .then(authorize)
  .then(doAction)
  .catch(error => console.error(error))

/**
 * Check params passed to lib
 */
function checkParams() {
  return new Promise((resolve, reject) => {
    if (!program.dir) {
      reject(new Error('You have to specify translations dir with option -d or --dir'))
    }

    resolve()
  })
}

/**
 * Parse client secrets
 */
function processClientSecrets() {
  return new Promise((resolve, reject) => {
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

    rl.question('Enter the code from that page here: ', (code) => {
      rl.close()

      oauth2Client.getToken(code, (err, token) => {
        if (err) {
          reject(err)
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
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1',
    }, (err, response) => {
      if (err) {
        reject(new Error(`The API returned an error: ${err}`))
      }
      const rows = response.data.values
      const languages = rows.splice(1, 1)[0]
      languages.splice(0, 1)
      rows.splice(0, 2)
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
  const filePath = path.join(__dirname, TRANSLATIONS_DIR, `${language}.js`)
  const content =
`module.exports = ${JSON.stringify(languageObject, null, '  ')}`
  debug('file path', filePath)

  await fs.writeFile(filePath, content, (err) => {
    if (err) throw err
    console.log(`Language ${language} file has been saved!`)
  })
}