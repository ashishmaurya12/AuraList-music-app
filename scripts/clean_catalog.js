const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { deduplicateCatalog } = require('../backend/services/catalogDedupe');

const CATALOG_FILE = path.join(__dirname, '../data/catalog.json');
const BACKUP_FILE = path.join(__dirname, '../data/catalog.backup.json');
const REPORT_FILE = path.join(__dirname, '../data/dedupe_report.json');

const isDryRun = !process.argv.includes('--apply') && !process.argv.includes('--write');
const isDbUpdateEnabled = process.argv.includes('--update-db');
const explicitReportFile = process.argv.find(arg => arg.startsWith('--report-file='))?.split('=')[1];
const shouldWriteReport = !isDryRun || process.argv.includes('--report') || process.argv.includes('--write-report') || Boolean(explicitReportFile);

const targetReportFile = explicitReportFile || (isDryRun
  ? path.join(__dirname, '../data/audit_report.json')
  : REPORT_FILE);

console.log(`[Mode] Catalog Audit Mode: ${isDryRun ? (shouldWriteReport ? `DRY-RUN / AUDIT-ONLY (Catalog/DB untouched; writing report to ${path.basename(targetReportFile)})` : 'DRY-RUN / AUDIT-ONLY (No files or database records will be modified. Use --report to save file)') : 'APPLY (Modifications enabled)'}`);
if (!isDbUpdateEnabled) {
  console.log(`[Database] Database updates: DISABLED (Use --update-db to opt in)`);
}

// Source of truth is always the active catalog file
const sourceFile = CATALOG_FILE;
console.log(`[Source] Reading active catalog data from: ${sourceFile}`);

const originalCatalog = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
console.log(`[Start] Initial catalog count: ${originalCatalog.length}`);

// Perform robust, Unicode-safe deduplication
const result = deduplicateCatalog(originalCatalog);

console.log(`[Summary]`);
console.log(`- Original catalog count: ${result.inputCount}`);
console.log(`- Alternate versions removed: ${result.alternateVersionsRemovedCount}`);
console.log(`- Duplicate uploads removed: ${result.duplicateUploadsRemovedCount}`);
console.log(`- Invalid entries removed: ${result.invalidEntriesRemovedCount}`);
console.log(`- Ambiguous entries reviewed & preserved: ${result.ambiguousEntriesReviewedCount}`);
console.log(`- Final catalog count: ${result.finalCount}`);
console.log(`- Total reduction: ${result.totalRemoved}`);
console.log(`- Mathematical reconciliation: ${result.reconciles ? '✓ PERFECT (Zero unexplained loss)' : '❌ FAILED'}`);

if (!result.reconciles) {
  console.error(`❌ RECONCILIATION ERROR: Process aborted without writing corrupted data.`);
  process.exit(1);
}

// Write cleaned catalog to data/catalog.json only if explicit apply mode is set
if (isDryRun) {
  console.log(`[Audit] Dry-run audit complete. data/catalog.json was NOT modified.`);
} else {
  // Create safety backup before overwriting
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const timestampBackup = path.join(__dirname, `../data/catalog.backup.${timestamp}.json`);
  fs.copyFileSync(CATALOG_FILE, timestampBackup);
  console.log(`[Backup] Created safety backup at ${timestampBackup}`);

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(result.finalCatalog, null, 2), 'utf8');
  console.log(`[Catalog] Successfully wrote cleaned catalog to ${CATALOG_FILE}`);
}

// Save detailed report
const report = {
  timestamp: new Date().toISOString(),
  auditMode: isDryRun ? 'dry-run' : 'apply',
  dbUpdatesEnabled: isDbUpdateEnabled,
  originalCount: result.inputCount,
  finalCount: result.finalCount,
  alternateVersionsRemovedCount: result.alternateVersionsRemovedCount,
  duplicateUploadsRemovedCount: result.duplicateUploadsRemovedCount,
  invalidEntriesRemovedCount: result.invalidEntriesRemovedCount,
  ambiguousEntriesReviewedCount: result.ambiguousEntriesReviewedCount,
  reconciles: result.reconciles,
  alternateRemovals: result.alternateRemovals.map(a => ({ id: a.track?.id, title: a.track?.title, artist: a.track?.artist, type: a.type })),
  duplicateRemovals: result.duplicateRemovals.map(d => ({
    removedId: d.dupeTrack?.id,
    removedTitle: d.dupeTrack?.title,
    keptId: d.keptTrack?.id,
    keptTitle: d.keptTrack?.title,
    artist: d.keptTrack?.artist
  })),
  invalidRemovals: result.invalidRemovals.map(i => ({ id: i.track?.id, title: i.track?.title, reason: i.reason })),
  ambiguousEntries: result.ambiguousEntries.map(a => ({ id: a.track?.id, title: a.track?.title, artist: a.track?.artist, reason: a.reason }))
};

if (shouldWriteReport) {
  fs.writeFileSync(targetReportFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[Report] Saved detailed report to ${targetReportFile}`);
} else {
  console.log(`[Report] Audit report generated in memory (no report file written; pass --report to save)`);
}

// Update MongoDB references safely (explicit opt-in only)
(async () => {
  if (!isDbUpdateEnabled) {
    return;
  }
  if (process.env.MONGODB_URI && result.idRedirectMap.size > 0) {
    try {
      console.log(`[Database] Connecting to MongoDB to update saved references...`);
      await mongoose.connect(process.env.MONGODB_URI);
      const Like = require('../backend/models/Like');
      const Playlist = require('../backend/models/Playlist');
      const History = require('../backend/models/History');

      let likesUpdated = 0;
      let historyUpdated = 0;
      let playlistTracksUpdated = 0;

      for (const [oldId, newId] of result.idRedirectMap.entries()) {
        const likeUpdate = await Like.updateMany({ jamendoId: oldId }, { $set: { jamendoId: newId } });
        likesUpdated += likeUpdate.modifiedCount;

        const histUpdate = await History.updateMany({ jamendoId: oldId }, { $set: { jamendoId: newId } });
        historyUpdated += histUpdate.modifiedCount;

        const playlists = await Playlist.find({ 'tracks.jamendoId': oldId });
        for (const pl of playlists) {
          pl.tracks.forEach(t => {
            if (t.jamendoId === oldId) t.jamendoId = newId;
          });
          await pl.save();
          playlistTracksUpdated++;
        }
      }

      console.log(`[Database] Reference migration complete:`);
      console.log(`  - Likes updated: ${likesUpdated}`);
      console.log(`  - History updated: ${historyUpdated}`);
      console.log(`  - Playlist tracks updated: ${playlistTracksUpdated}`);
      await mongoose.disconnect();
    } catch (err) {
      console.error(`[Database] Note: DB update error: ${err.message}`);
    }
  }
})();
