// API paths are owned by the extension, not user settings. When Karakeep changes its
// API, add or replace an adapter here and keep the saved instance URL and API key intact.
export const KARAKEEP_API_PATHS = Object.freeze({ current: "/api/v1" });

export const buildKarakeepApiUrl = (baseUrl, path) =>
  `${baseUrl.replace(/\/+$/, "")}${KARAKEEP_API_PATHS.current}${path.startsWith("/") ? path : `/${path}`}`;
