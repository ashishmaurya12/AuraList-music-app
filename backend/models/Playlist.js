const mongoose = require('mongoose');

const trackSchema = new mongoose.Schema({
  jamendoId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  artist: {
    type: String,
    required: true
  },
  coverUrl: {
    type: String,
    default: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop'
  },
  audioUrl: {
    type: String,
    required: true
  },
  duration: {
    type: Number,
    default: 0
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const playlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  tracks: [trackSchema]
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id.toString();
      if (ret.userId && typeof ret.userId === 'object' && ret.userId._id) {
        ret.userId = ret.userId._id.toString();
      } else if (ret.userId) {
        ret.userId = ret.userId.toString();
      }
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id.toString();
      if (ret.userId && typeof ret.userId === 'object' && ret.userId._id) {
        ret.userId = ret.userId._id.toString();
      } else if (ret.userId) {
        ret.userId = ret.userId.toString();
      }
      delete ret.__v;
      return ret;
    }
  }
});

// Compound index to optimize sorted playlist listing by creation time
playlistSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Playlist', playlistSchema);
