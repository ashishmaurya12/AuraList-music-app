const { z } = require('zod');
const { trackIdSchema, durationSchema } = require('./common');

const likeParamSchema = z.object({
  jamendoId: trackIdSchema
});

const likeBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  artist: z.string().trim().min(1).max(200).optional(),
  coverUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  audioUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  duration: durationSchema
}).strict();

module.exports = {
  likeParamSchema,
  likeBodySchema
};
