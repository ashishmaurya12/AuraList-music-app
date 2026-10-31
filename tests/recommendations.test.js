const recommendationService = require('../backend/services/recommendationService');
const musicProvider = require('../backend/services/musicProvider');

describe('Rule-Based Smart Music Recommendations (recommendationService)', () => {
  it('extracts artist tokens cleanly from multi-artist strings', () => {
    const tokens1 = recommendationService.extractArtistTokens('Arijit Singh, Pritam & Shashwat Sachdev');
    expect(tokens1).toContain('arijit singh');
    expect(tokens1).toContain('pritam');
    expect(tokens1).toContain('shashwat sachdev');

    const tokens2 = recommendationService.extractArtistTokens('Taylor Swift feat. Ed Sheeran');
    expect(tokens2).toContain('taylor swift');
    expect(tokens2).toContain('ed sheeran');

    expect(recommendationService.extractArtistTokens('')).toEqual([]);
    expect(recommendationService.extractArtistTokens(null)).toEqual([]);
  });

  it('provides diverse cold-start discovery for new or unauthenticated users', async () => {
    const recommendations = await recommendationService.getRecommendations(null, { limit: 15 });

    expect(Array.isArray(recommendations)).toBe(true);
    expect(recommendations.length).toBe(15);
    // Every track must include a recommendationReason
    expect(recommendations.every(t => typeof t.recommendationReason === 'string' && t.recommendationReason.length > 0)).toBe(true);
    expect(recommendations[0].isPersonalized).toBe(false);
  });

  it('excludes duplicate versions and non-original cuts from recommendations', async () => {
    const recommendations = await recommendationService.getRecommendations(null, { limit: 30 });
    
    // No lofi/slowed/unofficial remixes
    for (const track of recommendations) {
      expect(track.title).not.toMatch(/\b(slowed\s*\+?\s*reverb|8d\s*audio|speed\s*up)\b/i);
    }
  });

  it('ranks tracks matching user favorite artists higher with transparent reasons', async () => {
    const Like = require('../backend/models/Like');
    const History = require('../backend/models/History');

    const mockCatalog = [
      { id: 't1', jamendoId: 't1', title: 'Song By Other', artist: 'Unknown Singer', audioUrl: 'https://example.com/1.mp3', category: 'indian' },
      { id: 't2', jamendoId: 't2', title: 'Soulful Melody', artist: 'Arijit Singh', audioUrl: 'https://example.com/2.mp3', category: 'indian' },
      { id: 't3', jamendoId: 't3', title: 'Another Track', artist: 'Random Band', audioUrl: 'https://example.com/3.mp3', category: 'indian' }
    ];

    jest.spyOn(musicProvider, 'getLocalCatalog').mockReturnValue({ tracks: mockCatalog, totalSongs: 3 });

    // Mock Like.find to return a like with Arijit Singh
    jest.spyOn(Like, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ jamendoId: 'heard_track', title: 'Old Song', artist: 'Arijit Singh' }])
      })
    });

    // Mock History.find
    jest.spyOn(History, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([])
          })
        })
      })
    });

    const res = await recommendationService.getRecommendations('mock_user_123', { limit: 3 });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].id).toBe('t2'); // Arijit Singh track ranked highest
    expect(res[0].isPersonalized).toBe(true);
    expect(res[0].recommendationReason).toMatch(/Because you (enjoy|listen to) Arijit Singh/i);

    musicProvider.getLocalCatalog.mockRestore();
    Like.find.mockRestore();
    History.find.mockRestore();
  });
});
