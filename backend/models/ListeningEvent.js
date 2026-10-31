const mongoose = require('mongoose');

const listeningEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  jamendoId: {
    type: String,
    required: true,
    index: true
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
  duration: {
    type: Number,
    default: 0
  },
  listeningSeconds: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  position: {
    type: Number,
    default: 0
  },
  completed: {
    type: Boolean,
    default: false
  },
  sessionId: {
    type: String,
    default: null,
    index: true
  },
  playedAt: {
    type: Date,
    default: Date.now,
    index: true
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
  }
});

// Compound indexes for optimal aggregation performance and concurrency deduplication
listeningEventSchema.index({ userId: 1, playedAt: -1 });
listeningEventSchema.index({ userId: 1, jamendoId: 1, playedAt: -1 });
listeningEventSchema.index(
  { userId: 1, sessionId: 1 },
  { unique: true, partialFilterExpression: { sessionId: { $type: 'string' } } }
);

const ListeningEvent = mongoose.model('ListeningEvent', listeningEventSchema);

// Safe index migration: if legacy non-unique index conflict occurs, sync indexes cleanly
ListeningEvent.on('index', async (err) => {
  if (err && (err.code === 85 || err.codeName === 'IndexOptionsConflict' || /same name as the requested index/i.test(err.message))) {
    try {
      await ListeningEvent.syncIndexes();
    } catch (syncErr) {
      // Ignore if unavailable during teardown
    }
  }
});

module.exports = ListeningEvent;
