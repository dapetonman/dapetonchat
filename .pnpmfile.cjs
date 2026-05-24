module.exports = {
  hooks: {
    readPackage(pkg) {
      // 1. Replicates your top-level pnpm override: "esbuild": ">=0.25.0"
      if (pkg.dependencies && pkg.dependencies['esbuild']) {
        pkg.dependencies['esbuild'] = '>=0.25.0';
      }
      if (pkg.devDependencies && pkg.devDependencies['esbuild']) {
        pkg.devDependencies['esbuild'] = '>=0.25.0';
      }

      // 2. Replicates your "drizzle-kit" nested override
      if (pkg.name === 'drizzle-kit') {
        if (!pkg.dependencies) pkg.dependencies = {};
        pkg.dependencies['@esbuild-kit/esm-loader'] = 'npm:tsx@^4.20.4';
      }

      return pkg;
    }
  }
};