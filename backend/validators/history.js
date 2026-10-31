const { z } = require('zod');
const { trackIdSchema, durationSchema } = require('./common');

const SAFE_SESSION_ID_REGEX = /^[a-zA-Z0-9_\-.:@]+$/;

const historyBodySchema = z.object({
  jamendoId: trackIdSchema,
  title: z.string({ required_error: 'Title is required.' }).trim().min(1, 'Title is required.').max(200, 'Title exceeds max length.'),
  artist: z.string({ required_error: 'Artist is required.' }).trim().min(1, 'Artist is required.').max(200, 'Artist exceeds max length.'),
  coverUrl: z.string().trim().max(2000, 'Cover URL exceeds max length.').optional().or(z.literal('')),
  audioUrl: z.string().trim().max(2000, 'Audio URL exceeds max length.').optional().or(z.literal('')),
  duration: durationSchema,
  position: z.number().finite('Position must be a finite number.').min(0, 'Position cannot be negative.').max(86400, 'Position exceeds max limit.').optional(),
  listenDuration: z.number().finite('Listen duration must be a finite number.').min(0, 'Listen duration cannot be negative.').max(86400, 'Listen duration exceeds max limit.').optional(),
  sessionId: z.string().trim().max(100, 'Session ID exceeds max length.').regex(SAFE_SESSION_ID_REGEX, 'Session ID contains invalid characters.').optional(),
  completed: z.boolean().optional()
}).strict();

const historyPositionSchema = z.object({
  jamendoId: trackIdSchema,
  position: z.number({ required_error: 'Position is required.' }).finite('Position must be a finite number.').min(0, 'Position cannot be negative.').max(86400, 'Position exceeds max limit.'),
  listenDuration: z.number().finite('Listen duration must be a finite number.').min(0, 'Listen duration cannot be negative.').max(86400, 'Listen duration exceeds max limit.').optional(),
  sessionId: z.string().trim().max(100, 'Session ID exceeds max length.').regex(SAFE_SESSION_ID_REGEX, 'Session ID contains invalid characters.').optional(),
  completed: z.boolean().optional()
}).strict().superRefine((data, ctx) => {
  if (process.env.NODE_ENV === 'production') {
    if (!data.sessionId || typeof data.sessionId !== 'string' || !data.sessionId.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Session ID is required.',
        path: ['sessionId']
      });
    }
  }
});

const historySessionSchema = z.object({
  jamendoId: trackIdSchema,
  duration: durationSchema.optional(),
  startedAt: z.number().finite('Started at must be a finite number.').optional(),
  sessionId: z.string().trim().max(100, 'Session ID exceeds max length.').regex(SAFE_SESSION_ID_REGEX, 'Session ID contains invalid characters.').optional()
}).strict();

module.exports = {
  historyBodySchema,
  historyPositionSchema,
  historySessionSchema
};
