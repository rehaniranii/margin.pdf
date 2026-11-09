import dancingScript from '../assets/fonts/DancingScript.ttf?url'
import greatVibes from '../assets/fonts/GreatVibes-Regular.ttf?url'
import type { HandwritingFont } from '../model/fonts'

// Same files as the @font-face rules in styles.css, so the preview and the PDF use one font.
export const handwritingUrls: Record<HandwritingFont, string> = { 'Dancing Script': dancingScript, 'Great Vibes': greatVibes }
