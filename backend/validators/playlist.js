const { z } = require('zod');
const { objectIdSchema, trackIdSchema, durationSchema } = require('./common');

const createPlaylistSchema = z.object({
  name: z.string({ required_error: 'Playlist name is required.' })
    .trim()
    .min(1, 'Playlist name is required.')
    .max(100, 'Playlist name must not exceed 100 characters.')
}).strict();

const renamePlaylistSchema = z.object({
  name: z.string({ required_error: 'Playlist name is required.' })
    .trim()
    .min(1, 'Playlist name is required.')
    .max(100, 'Playlist name must not exceed 100 characters.')
}).strict();

const playlistIdParamSchema = z.object({
  id: objectIdSchema
});

const addTrackSchema = z.object({
  jamendoId: trackIdSchema,
  title: z.string({ required_error: 'Title is required.' }).trim().min(1, 'Title is required.').max(200, 'Title exceeds max length.'),
  artist: z.string({ required_error: 'Artist is required.' }).trim().min(1, 'Artist is required.').max(200, 'Artist exceeds max length.'),
  coverUrl: z.string().trim().max(2000, 'Cover URL exceeds max length.').optional().or(z.literal('')),
  audioUrl: z.string({ required_error: 'Audio URL is required.' }).trim().min(1, 'Audio URL is required.').max(2000, 'Audio URL exceeds max length.'),
  duration: durationSchema
}).strict();

const removeTrackParamSchema = z.object({
  id: objectIdSchema,
  jamendoId: trackIdSchema
});

module.exports = {
  createPlaylistSchema,
  renamePlaylistSchema,
  playlistIdParamSchema,
  addTrackSchema,
  removeTrackParamSchema
};
