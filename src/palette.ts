/**
 * pi's logo palette (`pi-logo.js` in pi-coding-agent). The logo keeps these fixed colors on every theme;
 * everything else takes its colors from the theme (`themes/pi-dark.json` and `themes/pi-light.json` map the
 * same three hues onto `accent`, `border` and `mdHeading`).
 */
import { rgbColor } from "@earendil-works/pi-tui";

export const CORAL = rgbColor(228, 138, 122);
export const BLUE = rgbColor(79, 142, 179);
export const YELLOW = rgbColor(234, 182, 93);
