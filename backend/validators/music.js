const { z } = require('zod');
const { trackIdSchema } = require('./common');

const strictInteger = (fieldName, defaultValue, { min, max, positive } = {}) => {
  let numSchema = z.number({ invalid_type_error: `${fieldName} must be a valid integer` })
    .int(`${fieldName} must be an integer`)
    .finite(`${fieldName} must be a finite number`);

  if (positive) {
    numSchema = numSchema.positive(`${fieldName} must be a positive integer`);
  }
  if (min !== undefined) {
    numSchema = numSchema.min(min, `${fieldName} cannot be less than ${min}`);
  }
  if (max !== undefined) {
    numSchema = numSchema.max(max, `${fieldName} cannot exceed ${max}`);
  }

  return z.preprocess(val => {
    if (val === undefined || val === null || val === '') {
      return defaultValue;
    }
    if (typeof val === 'number') {
      return val;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        return NaN;
      }
      return Number(trimmed);
    }
    return NaN;
  }, numSchema);
};

const searchQuerySchema = z.object({
  q: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(200, 'Search query is too long.').optional().or(z.literal(''))
  ),
  genre: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(100, 'Genre tag is too long.').optional().or(z.literal(''))
  ),
  artist: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(150, 'Artist query is too long.').optional().or(z.literal(''))
  ),
  type: z.preprocess(
    val => (typeof val === 'string' ? val.trim().toLowerCase() : val),
    z.enum(['all', 'song', 'track', 'artist']).optional()
  ),
  limit: strictInteger('limit', 40, { positive: true, max: 100 }),
  offset: strictInteger('offset', 0, { min: 0, max: 10000 }),
  page: strictInteger('page', 1, { positive: true, max: 1000 }),
  grouped: z.preprocess(
    val => (typeof val === 'string' ? val.trim().toLowerCase() : val),
    z.enum(['true', 'false']).optional()
  )
});

const suggestionsQuerySchema = z.object({
  q: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().min(1, 'Search query is required.').max(200, 'Search query is too long.')
  ),
  limit: strictInteger('limit', 8, { positive: true, max: 20 })
});

const catalogQuerySchema = z.object({
  page: strictInteger('page', 1, { positive: true, max: 1000 }),
  limit: strictInteger('limit', 40, { positive: true, max: 100 })
});

const collectionQuerySchema = z.object({
  limit: strictInteger('limit', 60, { min: 1, max: 100, positive: true })
});

const musicIdParamSchema = z.object({
  id: trackIdSchema
});

const moodParamSchema = z.object({
  mood: z.enum(['chill', 'focus', 'workout', 'romantic', 'party', 'night-drive', 'nightdrive', 'energize', 'feel-good', 'sad', 'sleep'])
});

const artistParamSchema = z.object({
  artist: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().min(1, 'Artist query is required.').max(150, 'Artist query is too long.')
  )
});

const radioStationQuerySchema = z.object({
  name: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(100, 'Station name is too long.').optional().or(z.literal(''))
  ),
  country: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(100, 'Country name is too long.').optional().or(z.literal(''))
  ),
  language: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(100, 'Language name is too long.').optional().or(z.literal(''))
  ),
  tag: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().max(100, 'Tag is too long.').optional().or(z.literal(''))
  ),
  limit: strictInteger('limit', 30, { positive: true, max: 100 }),
  offset: strictInteger('offset', 0, { min: 0, max: 10000 }),
  page: strictInteger('page', 1, { positive: true, max: 1000 }),
  httpsOnly: z.preprocess(
    val => (typeof val === 'string' ? val.trim().toLowerCase() : val),
    z.enum(['true', 'false', '1', '0']).optional()
  )
});

const RADIO_UUID_REGEX = /^(radio_)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const radioUuidParamSchema = z.object({
  uuid: z.preprocess(
    val => (typeof val === 'string' ? val.trim() : val),
    z.string().min(1, 'Station UUID is required.').regex(RADIO_UUID_REGEX, 'Invalid radio station UUID format.')
  )
});

const providerParamSchema = z.object({
  provider: z.preprocess(
    val => (typeof val === 'string' ? val.trim().toLowerCase() : val),
    z.enum(['local', 'jiosaavn', 'audius', 'jamendo', 'radiobrowser'])
  )
});

module.exports = {
  searchQuerySchema,
  suggestionsQuerySchema,
  catalogQuerySchema,
  collectionQuerySchema,
  musicIdParamSchema,
  moodParamSchema,
  artistParamSchema,
  radioStationQuerySchema,
  radioUuidParamSchema,
  providerParamSchema
};


