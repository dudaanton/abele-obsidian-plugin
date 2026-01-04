import { Context, Next } from "koa";
import jwt from "jsonwebtoken";
import parse from "cookie";

export default (config, { strapi }) => {
  return async (ctx: Context, next: Next) => {
    if (ctx.path.startsWith("/uploads")) {
      // Read cookies from header
      const cookieHeader = ctx.request.header.cookie;
      const cookies = cookieHeader ? parse.parse(cookieHeader) : {};

      const token = cookies.jwtToken; // Admin panel JWT is stored in cookie named 'token'

      if (!token) {
        return ctx.unauthorized("Missing admin token");
      }

      try {
        // Verify admin panel token (uses its own secret)
        const decoded: any = jwt.verify(
          token,
          strapi.config.get("admin.auth.secret"), // important: admin secret is different!
        );

        console.log(decoded);

        // Can check role or id if needed
        if (!decoded.id) {
          return ctx.unauthorized("Invalid admin token");
        }
      } catch (err) {
        return ctx.unauthorized("Invalid admin token");
      }
    }

    await next();
  };
};
