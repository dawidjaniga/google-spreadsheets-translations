/* global jest, describe, it, beforeEach, expect */
import path from 'path'
import {
  OPTIONS,
  SETTINGS_FILE_NAME,
  SETTINGS_FILE_PATH,
  STORE_PATH,
  readSettings,
  createStore
} from './../../src/index'
const fs = require('fs')
jest.mock('fs')
describe('index', () => {
  beforeEach(() => {
    jest.resetModules()
  })
  describe('readSettings()', () => {
    it('should have empty options', () => {
      expect(OPTIONS.translationsDir).toEqual('')
      expect(OPTIONS.spreadsheetId).toEqual('')
    })

    it('should read settings from file', async () => {
      const translationsDir = 'custom'
      const spreadsheetId = 'xyz'
      jest.doMock(SETTINGS_FILE_PATH, () => ({
        translationsDir: translationsDir,
        spreadsheetId: spreadsheetId
      }))
      await readSettings()
      expect(OPTIONS.translationsDir).toEqual(path.resolve(translationsDir))
      expect(OPTIONS.spreadsheetId).toEqual(spreadsheetId)
    })

    it('should return errors array when options are not specified', async () => {
      const translationsDir = ''
      const spreadsheetId = ''
      jest.doMock(SETTINGS_FILE_PATH, () => ({
        translationsDir: translationsDir,
        spreadsheetId: spreadsheetId
      }))
      try {
        await readSettings()
      } catch (e) {
        const errors = `You have to specify spreadsheet id as "spreadsheetId" in your project ${SETTINGS_FILE_NAME}`
        expect(e.message).toEqual(errors)
      }
    })
  })

  describe('createStore()', () => {
    const errorMessage = 'Custom error'
    it('should create store', async () => {
      await createStore()
      expect(fs.mkdirSync).toHaveBeenCalledWith(STORE_PATH)
    })

    it('should reject on error different than directory exists', async () => {
      try {
        fs.mkdirSync.mockImplementation(() => {
          const error = new Error(errorMessage)
          error.code = 'CUSTOM'
          throw error
        })
        await createStore()
      } catch (e) {
        expect(e.message).toEqual(errorMessage)
      }
    })

    it('should resolve on directory exists error', async () => {
      fs.mkdirSync.mockImplementation(() => {
        const error = new Error(errorMessage)
        error.code = 'EEXIST'
        throw error
      })
      await expect(createStore()).resolves.toBeUndefined()
    })
  })
})
