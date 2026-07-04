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