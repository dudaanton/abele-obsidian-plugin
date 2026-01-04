export default {
  routes: [
    {
      method: "POST",
      path: "/language-card",
      handler: "language-card.preview",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
    {
      method: "POST",
      path: "/language-card/explain",
      handler: "language-card.explain",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
    {
      method: "POST",
      path: "/language-card/audio",
      handler: "language-card.audio",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
    {
      method: "POST",
      path: "/language-card/image",
      handler: "language-card.image",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
  ],
};
