/** Public base URL for links in emails. APP_URL wins; on Render, RENDER_EXTERNAL_URL is set automatically. */
export const appUrl = () => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
