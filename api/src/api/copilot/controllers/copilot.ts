import { Context } from "koa";

export default {
  async default(ctx: Context) {
    const { prompt, model } = ctx.request.body;

    const url = process.env.OPENROUTER_API_URL;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    const res = await fetch(url, {
      ...options,
      body: JSON.stringify({
        model: model || config.OPENROUTER_ENG_CARD_MODEL,
        prompt,
      }),
    });

    if (!res.ok) {
      ctx.throw(500, "Failed to fetch data from OpenRouter API");
    }

    const data = (await res.json()) as { choices?: { text: string }[] };

    if (!data || !data.choices?.[0]?.text) {
      ctx.throw(500, "Invalid response from OpenRouter API");
    }

    const { text } = data.choices[0];

    return {
      text,
    };
  },
};
