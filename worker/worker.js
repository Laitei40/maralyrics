export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ============================
    // API Routes
    // ============================
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // ============================
    // Admin dashboard SPA
    // ============================
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/html")) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = "/admin/index.html";
        return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
      }
    }

    // ============================
    // Serve Static Assets
    // ============================
    return env.ASSETS.fetch(request);
  }
};

/**
 * API Handler
 */
async function handleApi(request, env) {
  const url = new URL(request.url);

  switch (url.pathname) {
    case "/api/ping":
      return Response.json({
        success: true,
        message: "Mara Lyrics API is running."
      });

    default:
      return Response.json(
        {
          success: false,
          error: "API endpoint not found."
        },
        {
          status: 404
        }
      );
  }
}