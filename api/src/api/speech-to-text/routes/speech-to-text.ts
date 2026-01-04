export default {
  routes: [
    {
      method: "POST",
      path: "/speech-to-text",
      handler: "speech-to-text.speechToText",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
  ],
};
