// A phone shows a tapped image fit to a portrait screen of about 1:2, so a card taller than twice
// its width shrinks below full width there. The 3000 px ceiling keeps a wide card readable in the
// desktop viewer, which fits the image to a landscape window.
export const MAX_HEIGHT_TO_WIDTH = 2;
export const MAX_CARD_HEIGHT_PX = 3000;

export function maxCardHeight(widthPx) {
  return Math.min(MAX_HEIGHT_TO_WIDTH * widthPx, MAX_CARD_HEIGHT_PX);
}

export function cardTooTallMessage(widthPx, heightPx) {
  const limit = maxCardHeight(widthPx);
  if (heightPx <= limit) return null;
  return `the card would be ${widthPx}x${heightPx} px, over the ${limit} px height limit for a ${widthPx} px wide `
    + 'card, so it is too tall to read inline in chat. No card was written. Make the full sheet instead '
    + '(design-spec, Step 4: Build the Full Sheet).';
}
