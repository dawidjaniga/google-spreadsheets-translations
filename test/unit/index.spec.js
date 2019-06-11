/* global jest, describe, it, beforeEach, expect */
import path from 'path'
import {
  OPTIONS,
  SETTINGS_FILE_NAME,
  SETTINGS_FILE_PATH,
  readSettings
} from './../../src/index'

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
})
