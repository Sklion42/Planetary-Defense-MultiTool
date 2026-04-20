# WharfKit browser package

`../index2.html` imports this folder through `./package/wharfkit.js`.

The current wrapper pins these browser ESM builds from `esm.sh`:

- `@wharfkit/session@1.6.1`
- `@wharfkit/web-renderer@1.4.3`
- `@wharfkit/wallet-plugin-cloudwallet@1.5.0`
- `@wharfkit/wallet-plugin-wombat@1.5.1`

For a fully vendored build later, replace the CDN imports in `wharfkit.js` with local bundled files generated from these npm packages.
