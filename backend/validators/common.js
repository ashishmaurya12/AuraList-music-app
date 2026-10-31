const { z } = require('zod');
const mongoose = require('mongoose');

// MongoDB ObjectId validation schema
const objectIdSchema = z.string({ required_error: 'ID is required.', invalid_type_error: 'ID must be a string.' })
  .refine(
    val => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid ID' }
  );

const SAFE_TRACK_ID_REGEX = /^[a-zA-Z0-9_\-.:@]+$/;

// Track ID (jamendoId or numeric ID coerced to string)
// Rejects null, undefined, empty/whitespace strings, objects, arrays, NaN, Infinity, oversized values (>100 chars), and unsafe characters
const trackIdSchema = z.preprocess(val => {
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return undefined;
    return String(val);
  }
  if (typeof val === 'string') {
    return val.trim();
  }
  return undefined;
}, z.string({ required_error: 'Track ID is required.', invalid_type_error: 'Track ID must be a string or number.' })
  .min(1, 'Track ID cannot be empty.')
  .max(100, 'Track ID exceeds maximum length of 100 characters.')
  .regex(SAFE_TRACK_ID_REGEX, 'Track ID contains invalid characters.'));

// Numeric track duration validator
const durationSchema = z.number({ invalid_type_error: 'Duration must be a valid number.' })
  .finite('Duration must be a finite number.')
  .min(0, 'Duration cannot be negative.')
  .max(86400, 'Duration exceeds 24 hours.')
  .optional()
  .default(0);

module.exports = {
  objectIdSchema,
  trackIdSchema,
  durationSchema
};
