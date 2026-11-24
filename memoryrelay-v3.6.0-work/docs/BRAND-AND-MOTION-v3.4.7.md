# MemoryRelay brand and motion system · v3.4.7

## Design inputs

Used connected MemoryRelay MCP skill selection for `logo-design`, `design`, `design-taste-frontend`, `unslop`, `mobile-native`, `animation-performance` and related web skills. Their production-relevant guidance was applied rather than installing a different framework. Brand constraints from earlier RIVNA, Milvayo and Cographide work: restrained premium interface, branded but quiet colors, safe opaque Android/PWA icons, spacious mobile layouts, clear navigation, polished purposeful animations.

## Brand mark

- Concept: a single interwoven memory-to-relay ribbon, forming an M without the old separate top dot.
- Image concept generated with image generation, then resized and padded for production PNGs. `icon.svg` is a compact geometric vector fallback (not a pixel-identical tracing of the generated concept).
- Web favicon: 32 px and 48 px PNG plus vector SVG.
- Home screen: regular 192 px and 512 px PNG; maskable 192 px and 512 px PNG with generous safe-area padding.
- iOS Safari: 180 px opaque touch icon.
- Identity in React: `Logo.jsx` renders the same 192 px icon across toolbar, gate and welcome.
- The installed PWA launcher may cache the old icon. A new service worker cannot forcibly replace Chrome's pinned launcher icon on every device; browser metadata refresh or reinstall can be necessary.

## Motion rules applied

1. One initial welcome gesture; 650 ms emblem entrance and 500 ms wordmark fade/rise, overlapping by design.
2. No animated dot or spinner. The welcome footer is static; reduced-motion users skip the hold and enter immediately when authentication permits.
3. Limit motion to compositor-friendly `transform` and `opacity`, with no animation of card height or position in document flow.
4. Dashboard lists, filters and high-frequency menus no longer stagger their children. Primary screen header can enter once; repeated menu opening is ~150 ms.
5. The app does not add heavy motion dependencies or change the underlying React 18 / Vite stack.

## Accessibility and mobile QA

- Full viewport respects `100dvh` and safe-area bottom in the splash.
- Welcome has `role=status` and `aria-busy` during authentication load.
- Actual phone interaction, icon refresh in installed PWA, and full production build remain to be verified on the owner's Android device.
- Headless Chromium screenshots are **CSS visual fixtures with sample data**, not running authenticated app captures.
