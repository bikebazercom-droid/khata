const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...config.watchFolders, workspaceRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Exclude:
//   1. Clerk's ephemeral temp directories (_tmp_NNN dirs deleted before crawl ends)
//   2. Replit's .local/skills ephemeral dirs (deleted while Metro is still watching)
//   3. pnpm's transient store directories (removed while Metro is watching)
const originalBlockList = config.resolver?.blockList;
const blockPatterns = [
  /node_modules\/@clerk\/backend_tmp_\d+/,
  /\/\.local\/skills\//,
  /\/\.local\/skills\b/,
  /\/\.local\/share\/pnpm\/_tmp_[^/]+/,
];

if (originalBlockList instanceof RegExp) {
  config.resolver.blockList = [originalBlockList, ...blockPatterns];
} else {
  const existingPatterns = Array.isArray(originalBlockList)
    ? originalBlockList
    : [];
  config.resolver.blockList = [...blockPatterns, ...existingPatterns];
}

module.exports = config;
