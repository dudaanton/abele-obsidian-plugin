export default {
  async verify(ctx) {
    // If the request reaches here, Strapi's API token authentication was successful.
    // No need to check the token manually.
    ctx.send({ success: true });
  },
};
