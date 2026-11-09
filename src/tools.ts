import type { UtilityTab } from './components/UtilityPanel'

export type Tool = { id: string; name: string; blurb: string; category: Category; icon: string; tab?: UtilityTab; accepts: 'pdf' | 'image'; intro?: string }
export type Category = 'Edit' | 'Organize' | 'Convert' | 'Stamp' | 'Protect'
export const categories: { id: Category; note: string }[] = [
  { id: 'Edit', note: 'Change what is on the page' },
  { id: 'Organize', note: 'Pages in, pages out' },
  { id: 'Stamp', note: 'Mark every page at once' },
  { id: 'Convert', note: 'Change format or file size' },
  { id: 'Protect', note: 'Passwords, and what should not be shared' },
]

// `tab` tools run on their own page; the others open the editor.
export const tools: Tool[] = [
  { id: 'edit', name: 'Edit text', category: 'Edit', accepts: 'pdf', blurb: 'Retype existing text where it sits.', icon: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4' },
  { id: 'annotate', name: 'Annotate', category: 'Edit', accepts: 'pdf', blurb: 'Highlight, draw, box and add notes.', icon: 'M4 20l4-1 11-11-3-3L5 16zM14 20h6' },
  { id: 'add', name: 'Add text & images', category: 'Edit', accepts: 'pdf', blurb: 'Place new text, a logo or a signature image.', icon: 'M12 5v14M5 12h14' },
  { id: 'fill-sign', tab: 'fill', name: 'Fill and sign', category: 'Edit', accepts: 'pdf', blurb: 'Fill in form fields and add your signature.', intro: 'Type into the PDF’s own form fields, then type, draw or upload a signature and click where it goes.', icon: 'M3 17c3-4 5-4 6-1s3 3 5-1M14 4l6 6-8 8H6v-6z' },
  { id: 'merge', tab: 'merge', name: 'Merge', category: 'Organize', accepts: 'pdf', blurb: 'Join several PDFs, in the order you set.', intro: 'Add two or more PDFs, put them in order, and get one file back.', icon: 'M6 4v6a4 4 0 0 0 4 4h4M18 4v6a4 4 0 0 1-4 4M12 14v6' },
  { id: 'split', tab: 'extract', name: 'Split & extract', category: 'Organize', accepts: 'pdf', blurb: 'Pull out a range, or one file per page.', intro: 'Choose the pages you want as a new PDF, or split every page into its own file.', icon: 'M12 4v6M12 10l-6 10M12 10l6 10' },
  { id: 'organize', tab: 'organize', name: 'Organize pages', category: 'Organize', accepts: 'pdf', blurb: 'Reorder, rotate and remove pages.', intro: 'Move pages up or down, turn them, or drop the ones you do not need.', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'crop', tab: 'crop', name: 'Crop pages', category: 'Organize', accepts: 'pdf', blurb: 'Trim margins off the pages you choose.', intro: 'Set how much to trim from each side, in points (72 points = 1 inch), and choose the pages.', icon: 'M6 2v16h16M2 6h16v16' },
  { id: 'watermark', tab: 'watermark', name: 'Watermark', category: 'Stamp', accepts: 'pdf', blurb: 'Stamp a word like DRAFT across pages.', intro: 'Set the text, size, colour and opacity, then choose which pages get it.', icon: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z' },
  { id: 'page-numbers', tab: 'numbers', name: 'Page numbers', category: 'Stamp', accepts: 'pdf', blurb: '“Page 3 of 12”, bottom or centre.', intro: 'Number the pages you choose, starting from any number.', icon: 'M6 3h12v18H6zM10 17h4M12 7v6' },
  { id: 'images-to-pdf', tab: 'from-images', name: 'Images to PDF', category: 'Convert', accepts: 'image', blurb: 'Bundle JPG and PNG files into one PDF.', intro: 'Add images in the order you want them, pick a paper size, and download.', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01' },
  { id: 'compress', tab: 'compress', name: 'Compress', category: 'Convert', accepts: 'pdf', blurb: 'Make a PDF small enough to email.', intro: 'Repack the file and shrink oversized photos. Text and drawings stay sharp.', icon: 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5' },
  { id: 'redact', tab: 'redact', name: 'Redact', category: 'Protect', accepts: 'pdf', blurb: 'Permanently delete names, emails, numbers.', intro: 'Find words, phrases, emails or phone numbers and remove them from the file for good, not just cover them.', icon: 'M4 6h16M4 18h16M4 12h4M10 10h10v4H10z' },
  { id: 'sanitize', tab: 'sanitize', name: 'Remove hidden data', category: 'Protect', accepts: 'pdf', blurb: 'Strip metadata, scripts, attachments and comments.', intro: 'Get a copy without author and editing details, scripts, attachments, links or bookmarks. Comments and filled-in forms are flattened into the page, so it looks the same.', icon: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 20 20 4' },
  { id: 'protect', tab: 'protect', name: 'Protect with password', category: 'Protect', accepts: 'pdf', blurb: 'Lock a PDF so it needs a password to open.', intro: 'Set a password and get an AES-256 encrypted copy. Without the password the file cannot be opened.', icon: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3' },
  { id: 'unlock', tab: 'unlock', name: 'Unlock', category: 'Protect', accepts: 'pdf', blurb: 'Remove the password from a PDF you can open.', intro: 'Enter the PDF’s password once and get a copy that opens without it. Editing and printing restrictions are removed too.', icon: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2' },
  { id: 'pdf-to-images', tab: 'to-images', name: 'PDF to images', category: 'Convert', accepts: 'pdf', blurb: 'Save pages as PNG or JPG.', intro: 'Choose pages, format and resolution. Each page is saved as its own image.', icon: 'M6 3h8l4 4v14H6zM14 3v4h4M9 17l2-3 2 2 2-3' },
]

export const toolHref = (tool: Tool) => tool.tab ? `#/${tool.id}` : '#/edit'
export const findTool = (id: string) => tools.find(tool => tool.id === id && tool.tab)
