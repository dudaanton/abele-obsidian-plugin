// Types for PolicyContext and Policy might not be directly exported.
// We rely on the structure passed by Strapi.

/**
 * Policy to authenticate requests using an API token provided in the Authorization header.
 * Applied specifically to routes that require this authentication method.
 */
export default async (policyContext, config, { strapi }) => {
  // Remove explicit types
  const { state, request, unauthorized, internalServerError } = policyContext;

  // 1. Check if user is already authenticated (e.g., via admin panel session)
  // Policies run after authentication middleware, so ctx.state.user might already be set.
  if (state.user) {
    // User is already authenticated, allow access.
    return true;
  }

  // 2. Check for Authorization header
  const authHeader = request.header.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    // No valid Bearer token header found.
    // Since this policy is applied specifically to routes *requiring* token auth,
    // the absence of a valid header means unauthorized access.
    return unauthorized("Authorization header with Bearer token is required.");
  }

  // 3. Attempt token authentication
  const token = authHeader.substring(7).trim();
  if (!token) {
    return unauthorized("Missing token in Authorization header.");
  }

  try {
    // Find the API token entity by the provided token value, populating the user
    const apiTokenEntry = await strapi.db
      .query("api::api-token.api-token")
      .findOne({
        where: { token: token },
        populate: { user: true }, // Populate the user relation
      });

    // Check if the token exists and is associated with a user
    if (!apiTokenEntry || !apiTokenEntry.user) {
      // Invalid token provided, deny access
      return unauthorized("Invalid or inactive API token.");
    }

    // Attach the authenticated user object to the Koa context state
    // Note: Modifying state directly in a policy might be needed but use with caution.
    // It's better if subsequent code relies on the policy having passed.
    // For consistency with the previous middleware approach, we'll set it here.
    state.user = apiTokenEntry.user;

    // Successfully authenticated via token, allow access
    return true;
  } catch (error) {
    strapi.log.error(
      `Token Authentication Policy Error: ${error.message}`,
      error,
    );
    // Use internalServerError helper from policyContext
    return internalServerError(
      "An internal error occurred during authentication.",
    );
  }
};
