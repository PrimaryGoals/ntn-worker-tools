function readPackage(pkg) {
  // Force patched versions of fast-uri to address security vulnerabilities
  if (pkg.dependencies?.['fast-uri']) {
    const version = pkg.dependencies['fast-uri']
    if (version.includes('3.') || version === '3.1.4') {
      pkg.dependencies['fast-uri'] = '3.1.5'
    }
  }
  if (pkg.peerDependencies?.['fast-uri']) {
    const version = pkg.peerDependencies['fast-uri']
    if (version.includes('3.') || version === '3.1.4') {
      pkg.peerDependencies['fast-uri'] = '3.1.5'
    }
  }
  return pkg
}

module.exports = {
  hooks: {
    readPackage,
  },
}
