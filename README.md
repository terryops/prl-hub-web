# Pearl Hub Web

The open-source Web frontend for [Pearl Hub](https://prl.tools.video): PRL market data,
pool comparison, worker monitoring, GPU economics, alerts and optional account settings.
It supports 16 interface languages, light/dark appearance and mobile layouts.

Dates and times follow each visitor's browser/device time zone. Interface language
controls the display format independently. This applies to market/pool updates,
charts, Real Cost measurement periods, worker/block/transaction timestamps and
account dates. UTC timestamps in API data and HTML metadata identify the original
instant; visible times are converted locally.

## Run locally

Use Node.js 22.6 or newer.

```sh
npm ci
npm run dev
```

The development server proxies `/v1` to `http://127.0.0.1:8787`. Point that proxy
in `vite.config.ts` at your compatible backend when testing API-dependent features.
The hosted service, native apps and browser wallet extension are maintained separately;
they are not part of this repository. The Wallet page links to the official extension download.

## Build and test

```sh
npm test
npm run build
```

The production frontend is generated in `dist/` and expects `/v1` API endpoints on
the same origin. Unit tests use public sample data and require no private repositories,
account credentials, mail delivery, payments or push subscriptions.

## Project layout

- `src/`: React/TypeScript frontend, localized copy and shared calculation models.
- `public/`: app icons, PWA manifest, push service worker and icon license.
- `test/`: frontend unit tests and standalone reference fixtures.
- `content/privacy.html`: the published privacy policy bundled by Vite.
- `ICONS.md`: Ionicons provenance and the selected icon mapping.

## License

The frontend code is available under the [MIT license](LICENSE).
Bundled Ionicons retain their own MIT notice in `public/licenses/ionicons.txt`.
The Pearl Hub name and branding images in `public/icon-*.png` remain the publisher's
branding assets and are not licensed under the MIT code license.

Support: [Pearl Hub community](https://t.me/prl_hub).
