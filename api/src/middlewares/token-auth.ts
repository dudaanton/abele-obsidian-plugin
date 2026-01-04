import { Context, Next } from "koa";

/**
 * Middleware to authenticate requests using an API token provided in the Authorization header.
 * The 'strapi' instance is automatically passed by Strapi.
 */
export default (config, { strapi }) => {
  return async (ctx: Context, next: Next) => {
    // 1. Check if user is already authenticated (e.g., via admin panel session)
    if (ctx.state.user) {
      // User is already authenticated, proceed without checking token
      return await next();
    }

    // 2. Check for Authorization header (only if user is not already authenticated)
    const authHeader = ctx.request.header.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      // No valid Bearer token header found.
      // If the header exists but is malformed, block it.
      if (authHeader) {
        return ctx.unauthorized(
          "Invalid Authorization header format. Use Bearer <token>.",
        );
      }
      // No header, proceed. Authorization might not be required or handled differently.
      return await next();
    }

    // 3. Attempt token authentication
    const token = authHeader.substring(7).trim();
    if (!token) {
      // This case should technically be caught by the check above, but added for safety
      return ctx.unauthorized("Missing token in Authorization header.");
    }

    try {
      const user = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where: {
            obsidian_tokens: {
              token,
            },
          },
        });

      // Check if the token exists and is associated with a user
      if (!user) {
        // Invalid token provided, deny access
        return ctx.unauthorized("Invalid or inactive API token.");
      }

      // Attach the authenticated user object to the Koa context state
      ctx.state.user = user;

      // Successfully authenticated via token, proceed
    } catch (error) {
      strapi.log.error(`Token Authentication Error: ${error.message}`, error);
      // Use ctx.internalServerError for unexpected errors during the process
      return ctx.internalServerError(
        "An internal error occurred during authentication.",
      );
    }

    await next();
  };
};
