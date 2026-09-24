/**
 * Builds the URL of a file from `public/`, such as `images/it/flour.png`.
 *
 * The app is served from a sub-path on some hosts (for example a Bilibili toy
 * preview at `/toy/preview/preview_xxx/index.html`), so paths which start with
 * `/` would point outside of it. `import.meta.env.BASE_URL` is `./` there and
 * such a URL is then resolved against the directory of `index.html`.
 */
export function assetUrl(path: string) {
    return import.meta.env.BASE_URL + path.replace(/^\/+/, '')
}
