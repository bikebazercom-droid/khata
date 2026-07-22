const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Exclude Clerk's ephemeral temp directories (clerk/backend creates _tmp_NNN
// directories at startup that are cleaned up before Metro finishes crawling).
const originalBlockList = config.resolver?.blockList;
const clerkTmpPattern = /node_modules\/@clerk\/backend_tmp_\d+/;

if (originalBlockList instanceof RegExp) {
  config.resolver.blockList = new RegExp(
    `(${originalBlockList.source})|(${clerkTmpPattern.source})`,
  );
} else {
  const existingPatterns = Array.isArray(originalBlockList)
    ? originalBlockList
    : [];
  config.resolver.blockList = [clerkTmpPattern, ...existingPatterns];
}

module.exports = config;
