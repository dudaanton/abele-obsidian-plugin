export function removeLineWithHashtag(text: string, hashtag: string) {
  let regex = new RegExp(`^.*${hashtag}.*(\r?\n|$)`, "gm");
  return text.replace(regex, "").trim();
}

export function getContentExcludingHashtag(text: string, hashtag: string) {
  let regex = new RegExp(`^.*${hashtag}.*`, "gm");
  let match = text.match(regex);
  if (match) {
    return match[0].replace(new RegExp(`${hashtag}`, "g"), "").trim();
  }
  return null;
}

export function processMarkdown(text: string) {
  // Step 1: Remove all multiple line breaks
  text = text.replace(/(\r?\n){2,}/g, "\n");

  // // Step 2: Insert double line breaks above lines containing the #ankicard tag
  // text = text.replace(/(^|\r?\n)([^\r\n]*#ankicard[^\r\n]*)/g, "\n\n$2");

  // Step 3: Insert the imageUrl after the first line
  // if (imageUrl || audio) {
  //   const firstLine = text.split("\n")[0];
  //   const restOfText = text.split("\n").slice(1).join("\n");
  //
  //   text = `${firstLine.trim()}\n${imageUrl}${imageUrl ? "\n" : ""}${audio}${audio ? "\n" : ""}${restOfText.trim()}`;
  // }
  //
  // // Step 4: Remove the #audiosample tag
  // text = removeLineWithHashtag(text, "#audiosample");

  return text.trim();
}

export function replaceTemplate(
  text: string,
  key: string,
  value: string,
): string {
  const pattern = new RegExp(`\\$\\{${key}\\}`, "g");
  return text.replace(pattern, value);
}
