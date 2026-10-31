/**
 * Archive Protection & Verification Script
 * Validates file exclusion rules for distributable packages to ensure no .env,
 * .git, logs, coverage, or credentials can ever be packaged into a ZIP archive.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Strict patterns that must NEVER be packaged into a distributable archive
const EXCLUDED_PATTERNS = [
  /^\.git(\/|\\|$)/i,
  /^\.env(\..+)?$/i, // Matches .env, .env.local, .env.production (allows .env.example)
  /^node_modules(\/|\\|$)/i,
  /^coverage(\/|\\|$)/i,
  /^\.nyc_output(\/|\\|$)/i,
  /\.log$/i,
  /\.(zip|tar|gz|tgz|rar|7z)$/i,
  /^\.vscode(\/|\\|$)/i,
  /^\.idea(\/|\\|$)/i,
  /^\.gemini(\/|\\|$)/i,
  /^\.system_generated(\/|\\|$)/i,
  /^\.agents(\/|\\|$)/i,
  /^dist(\/|\\|$)/i,
  /^build(\/|\\|$)/i,
  /^scratch(\/|\\|$)/i,
  /\.(pem|key|cert|crt|pfx)$/i,
  /^data[\/\\](users|history|likes|playlists)\.json$/i,
  /(\.DS_Store|Thumbs\.db)$/i
];

function isSafeForArchive(relativePath) {
  // Specifically permit .env.example
  if (relativePath === '.env.example' || relativePath === path.join('.', '.env.example')) {
    return true;
  }

  const normalized = relativePath.replace(/\\/g, '/');

  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(path.basename(normalized))) {
      return false;
    }
  }

  return true;
}

function scanDirectory(dir, baseDir = ROOT_DIR) {
  const safeFiles = [];
  const blockedFiles = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    if (!isSafeForArchive(relPath)) {
      blockedFiles.push(relPath);
      // If it's an excluded directory (like .git or node_modules), don't recurse into it
      continue;
    }

    if (entry.isDirectory()) {
      const sub = scanDirectory(fullPath, baseDir);
      safeFiles.push(...sub.safeFiles);
      blockedFiles.push(...sub.blockedFiles);
    } else {
      safeFiles.push(relPath);
    }
  }

  return { safeFiles, blockedFiles };
}

function inspectExistingArchives() {
  console.log('\nScanning for existing ZIP / tar archives...');
  const { execSync } = require('child_process');

  function findArchives(dir) {
    const archives = [];
    if (!fs.existsSync(dir)) return archives;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        archives.push(...findArchives(full));
      } else if (/\.(zip|tar\.gz|tgz)$/i.test(e.name)) {
        archives.push(full);
      }
    }
    return archives;
  }

  const archives = findArchives(ROOT_DIR);
  if (archives.length === 0) {
    console.log('✓ No stray archives found in workspace root.');
    return;
  }

  for (const archivePath of archives) {
    console.log(`Inspecting archive: ${path.relative(ROOT_DIR, archivePath)}`);
    try {
      const listOutput = execSync(`tar -tf "${archivePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const files = listOutput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const leaks = files.filter(f => {
        const norm = f.replace(/\\/g, '/');
        const isGit = norm === '.git' || norm === './.git' || norm.startsWith('.git/') || norm.startsWith('./.git/') || norm.includes('/.git/');
        const isEnv = (norm === '.env' || norm === './.env' || norm.startsWith('.env.') || norm.startsWith('./.env.') || norm.includes('/.env') || norm.includes('/.env.')) && !norm.includes('.env.example');
        const isNodeModules = norm.includes('node_modules');
        return isGit || isEnv || isNodeModules;
      });

      if (leaks.length > 0) {
        console.warn(`⚠️  NOTICE: Workspace archive "${archivePath}" contains secret/repo data: ${leaks.join(', ')}. (Not deleting automatically; please review).`);
      } else {
        console.log(`✓ Archive "${path.basename(archivePath)}" is clean.`);
      }
    } catch (e) {
      console.warn(`Could not inspect archive ${archivePath}: ${e.message}`);
    }
  }
}

function verifyArchiveSafety() {
  console.log('=== Distribution Archive Protection Audit ===');
  console.log(`Auditing workspace directory: ${ROOT_DIR}`);

  const { safeFiles, blockedFiles } = scanDirectory(ROOT_DIR);

  console.log(`\nScan Summary:`);
  console.log(`- Permitted files for distribution: ${safeFiles.length}`);
  console.log(`- Excluded items correctly blocked from packaging: ${blockedFiles.length}`);

  // Critical verification: ensure .env and .git are blocked
  const gitBlocked = blockedFiles.some(f => f.startsWith('.git'));
  const envBlocked = blockedFiles.some(f => f === '.env' || f.startsWith('.env.'));
  const envExampleAllowed = safeFiles.includes('.env.example');

  console.log(`\nSecurity Guard Checks:`);
  console.log(`- .git folder blocked: ${gitBlocked ? '✓ PASS' : '✓ (No .git folder in scan path)'}`);
  console.log(`- .env credentials blocked: ${envBlocked || !fs.existsSync(path.join(ROOT_DIR, '.env')) ? '✓ PASS' : '❌ FAIL'}`);
  console.log(`- .env.example template allowed: ${envExampleAllowed ? '✓ PASS' : '❌ FAIL'}`);

  const hasLeak = safeFiles.some(f => {
    const b = path.basename(f);
    return b === '.env' || (b.startsWith('.env.') && b !== '.env.example') || b.endsWith('.key') || b.endsWith('.pem');
  });

  if (hasLeak) {
    console.error('❌ CRITICAL SECURITY ERROR: Secret file found in safe files list!');
    process.exit(1);
  }

  inspectExistingArchives();

  console.log('\n✓ AUDIT PASSED: Distribution package exclusion rules verified.');
}

function createCleanArchiveZip() {
  const { execSync } = require('child_process');
  console.log('\n=== Creating Clean Distributable Archive ===');

  const distDir = path.join(ROOT_DIR, 'dist');
  const stagingDir = path.join(distDir, 'staging_auralist');
  const zipPath = path.join(distDir, 'AuraList-clean.zip');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Clean staging
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  const { safeFiles } = scanDirectory(ROOT_DIR);
  console.log(`Copying ${safeFiles.length} safe files to temporary staging...`);

  for (const relFile of safeFiles) {
    const src = path.join(ROOT_DIR, relFile);
    const dest = path.join(stagingDir, relFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // Verify .env.example exists in staging
  if (!fs.existsSync(path.join(stagingDir, '.env.example')) && fs.existsSync(path.join(ROOT_DIR, '.env.example'))) {
    fs.copyFileSync(path.join(ROOT_DIR, '.env.example'), path.join(stagingDir, '.env.example'));
  }

  // Remove previous zip if exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log(`Packaging staging folder into ${path.basename(zipPath)}...`);
  try {
    execSync(`tar -a -cf "${zipPath}" -C "${stagingDir}" .`, { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (err) {
    execSync(`powershell -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'inherit' });
  }

  // Clean staging directory
  fs.rmSync(stagingDir, { recursive: true, force: true });

  console.log(`✓ Archive created at: ${zipPath}`);

  // Verify created archive
  console.log('\n--- Verifying Created Distribution Archive ---');
  const listOutput = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf8' });
  const archivedFiles = listOutput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const forbiddenLeaks = archivedFiles.filter(f => {
    const norm = f.replace(/\\/g, '/');
    const isGitDir = norm === '.git' || norm === './.git' || norm.startsWith('.git/') || norm.startsWith('./.git/') || norm.includes('/.git/');
    const isEnvFile = (norm === '.env' || norm === './.env' || norm.startsWith('.env.') || norm.startsWith('./.env.') || norm.includes('/.env') || norm.includes('/.env.')) && !norm.includes('.env.example');
    const isNodeModules = norm.includes('node_modules');
    return isGitDir || isEnvFile || isNodeModules;
  });

  if (forbiddenLeaks.length > 0) {
    console.error('❌ CRITICAL ERROR: Archive contains forbidden files:', forbiddenLeaks);
    fs.unlinkSync(zipPath);
    process.exit(1);
  }

  const hasEnvExample = archivedFiles.some(f => f.includes('.env.example'));
  const hasServerJs = archivedFiles.some(f => f.includes('server.js'));

  if (!hasEnvExample || !hasServerJs) {
    console.error('❌ Required files missing from archive!');
    process.exit(1);
  }

  console.log(`✓ Verification PASSED: ${archivedFiles.length} files bundled.`);
  console.log('✓ Verified: 0 real secrets, 0 .git metadata, 0 node_modules.');
  console.log('✓ Verified: .env.example placeholder included.');
}

if (require.main === module) {
  verifyArchiveSafety();
  createCleanArchiveZip();
}

module.exports = { isSafeForArchive, verifyArchiveSafety, createCleanArchiveZip, inspectExistingArchives, inspectAndCleanExistingArchives: inspectExistingArchives, EXCLUDED_PATTERNS };
