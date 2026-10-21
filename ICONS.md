# Web interface icons

All 50 functional icon names use the original selected SVG drawings from
[Ionicons 8.1.0](https://www.npmjs.com/package/ionicons/v/8.1.0),
[upstream repository](https://github.com/ionic-team/ionicons). The outlined family
provides a consistent iOS-style appearance for the cross-platform website.
These are Ionicons, not Apple SF Symbols. App branding and data charts are separate.

`src/icon-symbols.tsx` contains the SVG children on the original 512 × 512 grid.
`src/Icons.tsx` keeps the shared 24 px wrapper, inherited text color, decorative
accessibility attributes and existing CSS size/animation hooks. Shapes, stroke
widths and joins are preserved from the source package. Selected drawings are
bundled locally; no CDN, system font, platform detection or icon runtime is needed.

The MIT copyright and full license are retained in
`public/licenses/ionicons.txt`, which is copied into every production build.
Apple SF Symbols exports are not added to the Web bundle.

The browser wallet (`extension/`) uses the same drawings: `extension/src/icon-symbols.tsx`
spreads this table and adds four wallet-only shapes from the same package, `create`
(`add-circle-outline.svg`), `restore` (`download-outline.svg`), `backup` (`key-outline.svg`)
and `options` (`options-outline.svg`). The extension ships the license as
`extension/public/licenses/ionicons.txt`; it contains no SF Symbols either.

| Interface name | Ionicons source |
| --- | --- |
| `market` | `analytics-outline.svg` |
| `workers` | `hardware-chip-outline.svg` |
| `pools` | `pie-chart-outline.svg` |
| `calculator` | `calculator-outline.svg` |
| `wallet` | `wallet-outline.svg` |
| `alerts` | `notifications-outline.svg` |
| `app` | `phone-portrait-outline.svg` |
| `mac` | `desktop-outline.svg` |
| `settings` | `settings-outline.svg` |
| `appearance` | `color-palette-outline.svg` |
| `refresh` | `refresh-outline.svg` |
| `qr` | `qr-code-outline.svg` |
| `send` | `paper-plane-outline.svg` |
| `history` | `time-outline.svg` |
| `plus` | `add-outline.svg` |
| `minus` | `remove-outline.svg` |
| `more` | `ellipsis-horizontal.svg` |
| `copy` | `copy-outline.svg` |
| `external` | `open-outline.svg` |
| `edit` | `create-outline.svg` |
| `rename` | `pencil-outline.svg` |
| `pause` | `pause-outline.svg` |
| `play` | `play-outline.svg` |
| `delete` | `trash-outline.svg` |
| `up` | `arrow-up-outline.svg` |
| `down` | `arrow-down-outline.svg` |
| `received` | `arrow-down-outline.svg` |
| `sent` | `arrow-up-outline.svg` |
| `check` | `checkmark-outline.svg` |
| `close` | `close-outline.svg` |
| `warning` | `warning-outline.svg` |
| `change` | `swap-vertical-outline.svg` |
| `reach` | `chevron-expand-outline.svg` |
| `right` | `arrow-forward-outline.svg` |
| `lock` | `lock-closed-outline.svg` |
| `account` | `person-circle-outline.svg` |
| `chevron` | `chevron-down-outline.svg` |
| `shield` | `shield-checkmark-outline.svg` |
| `key` | `key-outline.svg` |
| `card` | `card-outline.svg` |
| `eyeOff` | `eye-off-outline.svg` |
| `cube` | `cube-outline.svg` |
| `server` | `server-outline.svg` |
| `code` | `code-slash-outline.svg` |
| `globe` | `globe-outline.svg` |
| `sparkles` | `sparkles-outline.svg` |
| `cloudOff` | `cloud-offline-outline.svg` |
| `cards` | `albums-outline.svg` |
| `compact` | `list-outline.svg` |
| `search` | `search-outline.svg` |

To update the drawings, retrieve the pinned Ionicons npm package and select
`dist/svg/<source>.svg` using the mapping above. Preserve all child shapes and
attributes; React uses camelCase names for hyphenated SVG attributes. Retain
the package LICENSE in the public license file.
