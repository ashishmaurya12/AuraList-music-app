const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
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
    default: ''
  },
  duration: {
    type: Number,
    default: 0
  },
  position: {
    type: Number,
    default: 0
  },
  listenDuration: {
    type: Number,
    default: 0
  },
  sessionId: {
    type: String,
    default: null,
    index: true
  },
  playedAt: {
    type: Date,
    default: Date.now
  }
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

// Index for efficient sorting by playedAt per user
historySchema.index({ userId: 1, playedAt: -1 });
historySchema.index({ userId: 1, sessionId: 1 });

module.exports = mongoose.model('History', historySchema);
